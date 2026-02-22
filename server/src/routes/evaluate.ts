import { Router, Request, Response } from 'express';
import { analyzeProject } from '../analyzers';
import { evaluateWithRole } from '../ai/qwen';
import { runDebateRound, runOrchestrator } from '../ai/orchestrator';
import { runReflection } from '../ai/role-evolution';
import type { RoleResult, LaunchContext } from '../ai/orchestrator';
import { runRuntimeEvaluation } from '../eval/runtime';
import { runUiEvaluation } from '../eval/ui';
import { detectMonorepoPorts } from '../eval/detectors/project';
import type { EvaluationType, StageResult, EvalConfig } from '../eval/types';
import { DEFAULT_TIMEOUT } from '../eval/types';
import {
  createEvaluation,
  updateEvaluationStatus,
  completeEvaluation,
  saveRoleEvaluation,
  getEvaluation,
  getRoleEvaluations,
  saveReflection,
  getReflection,
  updateRuntimeStages,
} from '../db/sqlite';
import {
  emitStarted,
  emitAnalyzing,
  emitEvaluatingRole,
  emitRoleCompleted,
  emitCompleted,
  emitFailed,
  emitDebating,
  emitOrchestrating,
  emitReflecting,
  emitRuntimeTesting,
  emitUiTesting,
} from '../ws/progress';

const router = Router();

interface EvaluateRequest {
  projectPath: string;
  projectName: string;
  roles: string[];
  context: string;
  depth: 'quick' | 'deep';
  mode?: 'standard' | 'launch-ready';
  evaluationType?: EvaluationType;
  launchContext?: LaunchContext;
  rolePrompts?: Record<string, string>;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { projectPath, projectName, roles, context, depth, mode, evaluationType, launchContext, rolePrompts } = req.body as EvaluateRequest;

    if (!projectPath || !projectName) {
      return res.status(400).json({ error: 'projectPath and projectName are required' });
    }

    const selectedRoles = roles || ['boss', 'merchant', 'operator'];
    const selectedDepth = depth || 'quick';
    const selectedMode = mode || 'standard';
    const selectedEvalType = evaluationType || 'static';
    const evaluationId = createEvaluation(projectName, projectPath, context || '', selectedEvalType);

    res.json({ id: evaluationId, status: 'started', depth: selectedDepth, mode: selectedMode, evaluationType: selectedEvalType });

    runEvaluation(evaluationId, projectPath, projectName, selectedRoles, context || '', selectedDepth, selectedMode, selectedEvalType, launchContext, rolePrompts).catch(console.error);
  } catch (error) {
    console.error('Evaluation error:', error);
    res.status(500).json({ error: 'Failed to start evaluation' });
  }
});

function parseRoleResult(raw: string): { score: number; summary: string; parsed: any } {
  let parsed: any;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      parsed = { score: 70, summary: raw, dimensions: {} };
    }
  } catch {
    parsed = { score: 70, summary: raw, dimensions: {} };
  }
  return { score: parsed.score || 70, summary: parsed.summary || '', parsed };
}

interface DynamicUiEvalResult {
  context: string;
  process?: { kill: () => Promise<void> };
  stages: StageResult[];
}

async function runDynamicUiEvaluation(
  evaluationId: string,
  projectPath: string,
  evaluationType: EvaluationType
): Promise<DynamicUiEvalResult> {
  const config: EvalConfig = {
    projectPath,
    evaluationType,
    timeout: DEFAULT_TIMEOUT,
  };

  const stages: StageResult[] = [];
  let runtimeProcess: { kill: () => Promise<void> } | undefined;
  let runtimeContext = '';

  try {
    // Run runtime evaluation for dynamic, ui, or full
    if (evaluationType === 'dynamic' || evaluationType === 'full' || evaluationType === 'ui') {
      console.log(`[${evaluationId}] Running runtime evaluation...`);
      emitRuntimeTesting(evaluationId, 'startup');
      
      const runtimeResult = await runRuntimeEvaluation(config);
      stages.push(...runtimeResult.stages);
      runtimeProcess = runtimeResult.process;

      // Format runtime context for role evaluation
      runtimeContext = formatRuntimeContext(runtimeResult);

      // Run UI evaluation for ui or full
      if ((evaluationType === 'ui' || evaluationType === 'full') && runtimeResult.success) {
        console.log(`[${evaluationId}] Running UI evaluation...`);
        emitUiTesting(evaluationId, 'generic-flow');

        // Detect frontend port for monorepo
        const ports = detectMonorepoPorts(projectPath);
        const uiBaseUrl = ports.frontend 
          ? `http://localhost:${ports.frontend}` 
          : runtimeResult.baseUrl;

        // Wait for frontend if different from backend
        if (ports.frontend && ports.frontend !== ports.backend) {
          const { waitForHealthy } = await import('../eval/runtime/health');
          await waitForHealthy(uiBaseUrl, 10000);
        }

        const uiResult = await runUiEvaluation(config, uiBaseUrl);
        stages.push(uiResult.stage);

        // Append UI context
        runtimeContext += formatUiContext(uiResult);
      }
    }
  } catch (error) {
    console.error(`[${evaluationId}] Dynamic/UI evaluation error:`, error);
    runtimeContext = `\n## 运行时评测\n评测失败: ${String(error)}`;
  }

  // Save runtime stages to database
  if (stages.length > 0) {
    updateRuntimeStages(evaluationId, JSON.stringify(stages));
  }

  return { context: runtimeContext, process: runtimeProcess, stages };
}

function formatRuntimeContext(runtimeResult: {
  success: boolean;
  stages: StageResult[];
  baseUrl: string;
}): string {
  const startupStage = runtimeResult.stages.find(s => s.stage === 'startup');
  const healthStage = runtimeResult.stages.find(s => s.stage === 'health');
  const apiStage = runtimeResult.stages.find(s => s.stage === 'api');

  let context = `\n## 运行时评测结果\n`;
  context += `- 启动状态: ${startupStage?.status || 'N/A'} (${startupStage?.duration_ms || 0}ms)\n`;
  context += `- 健康检查: ${healthStage?.status || 'N/A'}\n`;
  
  if (apiStage) {
    const apiDetails = apiStage.details as { passed?: number; total?: number };
    context += `- API 测试: ${apiDetails.passed || 0}/${apiDetails.total || 0} 通过\n`;
  }

  if (runtimeResult.stages.some(s => s.errors.length > 0)) {
    context += `- 错误: ${runtimeResult.stages.flatMap(s => s.errors).join('; ')}\n`;
  }

  return context;
}

function formatUiContext(uiResult: { stage: StageResult }): string {
  const stage = uiResult.stage;
  const details = stage.details as {
    flows?: Array<{ name: string; passed: boolean; console_errors?: string[]; network_errors?: string[] }>;
  };

  let context = `\n## UI 评测结果\n`;
  context += `- 状态: ${stage.status} (${stage.duration_ms}ms)\n`;
  
  if (details.flows) {
    for (const flow of details.flows) {
      context += `- ${flow.name}: ${flow.passed ? '通过' : '失败'}\n`;
      if (flow.console_errors?.length) {
        context += `  - 控制台错误: ${flow.console_errors.length}\n`;
      }
      if (flow.network_errors?.length) {
        context += `  - 网络错误: ${flow.network_errors.length}\n`;
      }
    }
  }

  if (stage.errors.length > 0) {
    context += `- 错误: ${stage.errors.join('; ')}\n`;
  }

  return context;
}

async function runEvaluation(
  evaluationId: string,
  projectPath: string,
  projectName: string,
  roles: string[],
  context: string,
  depth: 'quick' | 'deep',
  mode: 'standard' | 'launch-ready' = 'standard',
  evaluationType: EvaluationType = 'static',
  launchContext?: LaunchContext,
  rolePrompts?: Record<string, string>
) {
  let runtimeProcess: { kill: () => Promise<void> } | undefined;
  let runtimeContext = '';

  try {
    emitStarted(evaluationId, projectName);
    updateEvaluationStatus(evaluationId, 'analyzing');
    emitAnalyzing(evaluationId);

    console.log(`[${evaluationId}] Starting ${depth} ${mode} analysis of ${projectName} (evalType: ${evaluationType})...`);
    const analysis = await analyzeProject(projectPath, depth);
    console.log(`[${evaluationId}] Analysis complete: ${analysis.api.totalEndpoints} endpoints, ${analysis.database.totalEntities} entities, ${analysis.metrics.totalFiles} files`);
    
    updateEvaluationStatus(evaluationId, 'evaluating', JSON.stringify(analysis));

    // Run dynamic/UI evaluation if requested
    if (evaluationType !== 'static') {
      const evalResult = await runDynamicUiEvaluation(evaluationId, projectPath, evaluationType);
      runtimeContext = evalResult.context;
      runtimeProcess = evalResult.process;
    }

    const scores: number[] = [];
    const roleResults: RoleResult[] = [];

    // Phase 1: Run all role evaluations
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i];
      try {
        console.log(`[${evaluationId}] Evaluating with role: ${role} (${depth} ${mode} mode)`);
        emitEvaluatingRole(evaluationId, role, i, roles.length);
        
        // Combine original context with runtime evaluation context
        const fullContext = runtimeContext ? `${context}\n${runtimeContext}` : context;
        const result = await evaluateWithRole(role, analysis.summary, fullContext, depth, mode, rolePrompts?.[role]);
        const { score, summary, parsed } = parseRoleResult(result);

        scores.push(score);
        emitRoleCompleted(evaluationId, role, score);

        saveRoleEvaluation(evaluationId, role, score, summary, JSON.stringify(parsed));
        console.log(`[${evaluationId}] Role ${role} scored: ${score}`);

        roleResults.push({ role, score, summary, details: parsed });
      } catch (error) {
        console.error(`Error evaluating role ${role}:`, error);
        saveRoleEvaluation(evaluationId, role, 0, 'Evaluation failed', JSON.stringify({ error: String(error) }));
      }
    }

    // Phase 2: Launch-Ready — Debate + Orchestrator synthesis
    if (mode === 'launch-ready' && roleResults.length > 0) {
      try {
        // Debate round
        console.log(`[${evaluationId}] Starting debate round...`);
        emitDebating(evaluationId);
        const debate = await runDebateRound(roleResults);
        saveRoleEvaluation(
          evaluationId, '_debate', 0,
          debate.summary,
          JSON.stringify(debate)
        );
        console.log(`[${evaluationId}] Debate complete: ${debate.consensus.length} consensus, ${debate.disputes.length} disputes`);

        // Orchestrator synthesis
        console.log(`[${evaluationId}] Starting orchestrator synthesis...`);
        emitOrchestrating(evaluationId);
        const orchestrated = await runOrchestrator(
          analysis.summary, context, roleResults, debate, launchContext || {}
        );
        const orchScore = (orchestrated.structured_json as any).overall_score || 0;
        saveRoleEvaluation(
          evaluationId, '_orchestrator', orchScore,
          orchestrated.summary,
          JSON.stringify(orchestrated.structured_json)
        );
        console.log(`[${evaluationId}] Orchestrator complete: ${orchestrated.summary}`);
      } catch (error) {
        console.error(`[${evaluationId}] Launch-ready synthesis failed:`, error);
        saveRoleEvaluation(evaluationId, '_orchestrator', 0, 'Synthesis failed', JSON.stringify({ error: String(error) }));
      }
    }

    const overallScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    completeEvaluation(evaluationId, overallScore);
    emitCompleted(evaluationId, overallScore);
    console.log(`[${evaluationId}] Evaluation completed with score: ${overallScore}`);

    // Phase 3: Reflection (non-blocking, runs after completion)
    if (roleResults.length > 0) {
      runReflectionPhase(evaluationId, roleResults).catch(err => {
        console.error(`[${evaluationId}] Reflection failed:`, err);
      });
    }
  } catch (error) {
    console.error('Evaluation failed:', error);
    updateEvaluationStatus(evaluationId, 'failed');
    emitFailed(evaluationId, String(error));
  } finally {
    // Cleanup runtime process if started
    if (runtimeProcess) {
      console.log(`[${evaluationId}] Cleaning up runtime process...`);
      try {
        await runtimeProcess.kill();
      } catch (err) {
        console.error(`[${evaluationId}] Failed to kill runtime process:`, err);
      }
    }
  }
}

async function runReflectionPhase(
  evaluationId: string,
  roleResults: RoleResult[],
  debateSummary?: string
) {
  try {
    console.log(`[${evaluationId}] Starting reflection phase...`);
    emitReflecting(evaluationId);

    const reflection = await runReflection(evaluationId, roleResults, debateSummary);

    // Convert to storage format
    saveReflection({
      evaluationId,
      timestamp: reflection.timestamp,
      roleAssessments: reflection.role_assessments.map(a => ({
        role: a.role,
        qualityScore: a.quality_score,
        strengths: a.strengths,
        weaknesses: a.weaknesses,
        promptSuggestions: a.prompt_suggestions,
        redundancyWith: a.redundancy_with,
      })),
      blindSpots: reflection.blind_spots,
      newRoleProposals: reflection.new_role_proposals.map(p => ({
        id: p.id,
        label: p.label,
        emoji: p.emoji,
        rationale: p.rationale,
        draftPromptSketch: p.draft_prompt_sketch,
      })),
      metaObservations: reflection.meta_observations,
    });

    console.log(`[${evaluationId}] Reflection complete: ${reflection.role_assessments.length} assessments, ${reflection.blind_spots.length} blind spots, ${reflection.new_role_proposals.length} new role proposals`);
  } catch (error) {
    console.error(`[${evaluationId}] Reflection error:`, error);
  }
}

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const evaluation = getEvaluation(id);

    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }

    const roleEvaluations = getRoleEvaluations(id);

    const result = {
      ...evaluation,
      analysisData: evaluation.analysisData ? JSON.parse(evaluation.analysisData) : null,
      runtimeStages: evaluation.runtimeStages ? JSON.parse(evaluation.runtimeStages) : null,
      roleEvaluations: roleEvaluations.map(re => ({
        ...re,
        details: re.details ? JSON.parse(re.details) : null,
      })),
    };

    res.json(result);
  } catch (error) {
    console.error('Get evaluation error:', error);
    res.status(500).json({ error: 'Failed to get evaluation' });
  }
});

// Export for queue scheduler
export async function runEvaluationJob(
  job: { evaluationId: string; config: any },
  workerId: number
): Promise<void> {
  const { evaluationId, config } = job;
  console.log(`[Worker ${workerId}] Starting evaluation job: ${evaluationId}`);

  await runEvaluation(
    evaluationId,
    config.projectPath,
    config.projectName,
    config.roles,
    config.context,
    config.depth,
    config.mode,
    config.evaluationType,
    config.launchContext,
    config.rolePrompts
  );
}

export default router;
