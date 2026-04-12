import { Router, Request, Response } from 'express';
import { analyzeProject } from '../analyzers';
import { evaluateWithRole } from '../ai/qwen';
import type { Provider } from '../ai/client';
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
  saveMrepReport,
  saveMrepVerification,
  saveJudgeReference,
  saveJudgment,
  getJudgment,
} from '../db/sqlite';
import { isMrepEnabledRole, extractMrepFromRoleOutput, verifyMrepReport } from '../mrep';
import { getOrBuildReference, runGroundedJudge, formatJudgmentSummary } from '../grounded-judge';
import { generateMarkdownReport, saveReportToProject } from '../reports';
import { getInterviewContextForEval } from '../interview-agent';
import { runPrescription } from '../prescription';
import { emitPrescribing } from '../ws/progress';

// Utility: truncate string to max length
function truncate(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// Max context size for coverage injection (2KB)
const MAX_COVERAGE_CONTEXT_SIZE = 2048;
const MAX_COMMENT_LENGTH = 80;
const MAX_MODULES = 5;
const MAX_DIMENSIONS = 6;
const MAX_ACTIONS = 3;

// Format coverage intelligence data for role context injection
function formatCoverageForRole(testCoverage: any): string | null {
  if (!testCoverage) return null;
  
  const ci = testCoverage.coverageIntelligence;
  const lines: string[] = [];
  
  lines.push('## Coverage Intelligence Data');
  lines.push('');
  
  if (ci) {
    lines.push(`- **Coverage Source**: ${ci.meta?.coverageSource || 'proxy'} (isProxy=${!ci.meta?.hasRealCoverage})`);
    lines.push(`- **Coverage Score**: ${ci.quality?.coverageScore ?? 'n/a'}/100`);
    lines.push(`- **Quality Score**: ${ci.quality?.testQualityScore ?? 'n/a'}/100`);
    lines.push(`- **Final Score**: ${ci.quality?.finalScore ?? 'n/a'}/100`);
    lines.push('');
    
    // Top uncovered modules (limited to MAX_MODULES)
    const modules = ci.modules || [];
    const topUncovered = modules
      .slice()
      .sort((a: any, b: any) => (a.metrics?.lineCoverage ?? 0) - (b.metrics?.lineCoverage ?? 0))
      .slice(0, MAX_MODULES);
    
    if (topUncovered.length > 0) {
      lines.push('### Top Uncovered Modules');
      for (const m of topUncovered) {
        const lineCov = m.metrics?.lineCoverage ?? 'n/a';
        lines.push(`- ${m.name}: ${lineCov}% line, ${m.status}`);
      }
      lines.push('');
    }
    
    // Quality dimensions (limited to MAX_DIMENSIONS, truncated comments)
    if (ci.quality?.dimensions) {
      const dims = ci.quality.dimensions;
      lines.push('### Quality Dimensions');
      const dimEntries = [
        ['Assert Density', dims.assertDensity],
        ['Naming', dims.naming],
        ['Flaky Risk', dims.flakyRisk],
        ['Isolation', dims.isolation],
        ['Duplication', dims.duplication],
        ['Dependency Smell', dims.dependencySmell],
      ].slice(0, MAX_DIMENSIONS);
      
      for (const [name, dim] of dimEntries) {
        if (dim) {
          const comment = truncate(dim.comment || '', MAX_COMMENT_LENGTH);
          lines.push(`- ${name}: ${dim.score}/100 — ${comment}`);
        }
      }
      lines.push('');
    }
    
    // Action items (limited to MAX_ACTIONS, truncated descriptions)
    if (ci.actionItems && ci.actionItems.length > 0) {
      lines.push('### Recommended Actions');
      for (const action of ci.actionItems.slice(0, MAX_ACTIONS)) {
        const priorityIcon = action.priority === 'high' ? '🔴' : action.priority === 'medium' ? '🟡' : '🟢';
        const desc = truncate(action.description || '', MAX_COMMENT_LENGTH);
        lines.push(`${priorityIcon} ${action.title} (${action.effort}) — ${desc}`);
      }
      lines.push('');
    }
  } else {
    // Fallback to legacy data
    lines.push(`- **Coverage Source**: proxy (no coverage artifact)`);
    lines.push(`- **Test Quality Score**: ${testCoverage.testQualityScore ?? 'n/a'}/100`);
    lines.push('');
    
    if (testCoverage.moduleTestCoverage && testCoverage.moduleTestCoverage.length > 0) {
      lines.push('### Module Test Coverage');
      for (const m of testCoverage.moduleTestCoverage.slice(0, MAX_MODULES)) {
        lines.push(`- ${m.module}: ${Math.round(m.ratio * 100)}% ratio, ${m.status}`);
      }
      lines.push('');
    }
    
    if (testCoverage.recommendations && testCoverage.recommendations.length > 0) {
      lines.push('### Recommendations');
      for (const r of testCoverage.recommendations.slice(0, MAX_ACTIONS)) {
        lines.push(`- ${truncate(r, MAX_COMMENT_LENGTH)}`);
      }
      lines.push('');
    }
  }
  
  const result = lines.join('\n');
  
  // Final size check - truncate if exceeds max
  if (result.length > MAX_COVERAGE_CONTEXT_SIZE) {
    return result.slice(0, MAX_COVERAGE_CONTEXT_SIZE - 50) + '\n\n[truncated for context limit]';
  }
  
  return result;
}
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
  /**
   * LLM provider override. If omitted, selectProvider() in ai/client.ts picks
   * one from env vars. Setting `provider: 'claude'` is the way to opt into
   * the prompt-caching path.
   */
  provider?: Provider;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { projectPath, projectName, roles, context, depth, mode, evaluationType, launchContext, rolePrompts, provider } = req.body as EvaluateRequest;

    if (!projectPath || !projectName) {
      return res.status(400).json({ error: 'projectPath and projectName are required' });
    }

    const selectedRoles = roles || ['boss', 'merchant', 'operator'];
    const selectedDepth = depth || 'quick';
    const selectedMode = mode || 'standard';
    const selectedEvalType = evaluationType || 'static';
    const evaluationId = createEvaluation(projectName, projectPath, context || '', selectedEvalType);

    res.json({ id: evaluationId, status: 'started', depth: selectedDepth, mode: selectedMode, evaluationType: selectedEvalType });

    runEvaluation(evaluationId, projectPath, projectName, selectedRoles, context || '', selectedDepth, selectedMode, selectedEvalType, launchContext, rolePrompts, provider).catch(console.error);
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
  rolePrompts?: Record<string, string>,
  provider?: Provider
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
    
    // Build Coverage Intelligence context for technical roles
    const coverageContext = formatCoverageForRole(analysis.quality?.testCoverage);

    // Build interview research context for user-facing roles
    const interviewContext = getInterviewContextForEval(projectPath);

    // Phase 1: Run all role evaluations
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i];
      try {
        console.log(`[${evaluationId}] Evaluating with role: ${role} (${depth} ${mode} mode)`);
        emitEvaluatingRole(evaluationId, role, i, roles.length);
        
        // Combine original context with runtime evaluation context
        let fullContext = runtimeContext ? `${context}\n${runtimeContext}` : context;
        
        // Inject coverage intelligence data for technical roles
        if (['architect', 'coder', 'trade_expert', 'supply_chain_expert', 'security'].includes(role) && coverageContext) {
          fullContext = `${fullContext}\n\n${coverageContext}`;
        }

        // Inject interview research data for user-facing roles
        if (['boss', 'user_interview', 'merchant', 'growth', 'pricing', 'operator'].includes(role) && interviewContext) {
          fullContext = `${fullContext}${interviewContext}`;
        }
        
        const result = await evaluateWithRole(
          role,
          analysis.summary,
          fullContext,
          depth,
          mode,
          rolePrompts?.[role],
          projectPath,
          evaluationId,
          provider
        );
        const { score, summary, parsed } = parseRoleResult(result);

        scores.push(score);
        emitRoleCompleted(evaluationId, role, score);

        saveRoleEvaluation(evaluationId, role, score, summary, JSON.stringify(parsed));
        console.log(`[${evaluationId}] Role ${role} scored: ${score}`);

        // MREP: Extract structured claims from technical roles
        if (isMrepEnabledRole(role)) {
          try {
            const mrepReport = extractMrepFromRoleOutput(role, evaluationId, parsed);
            if (mrepReport) {
              saveMrepReport(mrepReport);
              console.log(`[${evaluationId}] MREP: ${role} produced ${mrepReport.claims.length} claims (coverage: ${mrepReport.metrics_snapshot.evidence_coverage})`);

              // Verify claims against project files
              const verification = verifyMrepReport(mrepReport, projectPath);
              saveMrepVerification(verification);
              console.log(`[${evaluationId}] MREP verify: ${verification.summary.verified}/${verification.summary.total} claims verified (pass_rate: ${verification.summary.pass_rate})`);
            }
          } catch (mrepErr) {
            console.error(`[${evaluationId}] MREP extraction failed for ${role}:`, mrepErr);
          }
        }

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
        const debate = await runDebateRound(roleResults, evaluationId);
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
          analysis.summary, context, roleResults, debate, launchContext || {}, evaluationId
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

    // Generate and save Markdown report to project folder
    try {
      const reportData = {
        evaluationId,
        projectName,
        projectPath,
        overallScore,
        roleEvaluations: roleResults.map(r => ({
          role: r.role,
          score: r.score,
          summary: r.summary,
          details: r.details,
        })),
        analysisData: {
          structure: {
            totalFiles: analysis.structure?.totalFiles,
            totalLines: analysis.structure?.totalLines,
            languages: analysis.structure?.languages,
          },
          api: {
            totalEndpoints: analysis.api?.totalEndpoints,
          },
          database: {
            totalEntities: analysis.database?.totalEntities,
            totalColumns: analysis.database?.totalColumns,
            orms: analysis.database?.orms,
          },
          quality: {
            ...analysis.quality,
            hasDocker: analysis.quality?.hasDockerfile || analysis.quality?.hasDockerCompose,
            hasLinting: analysis.quality?.hasLinter,
          },
        },
        depth,
        mode,
        evaluationType,
        timestamp: new Date(),
      };
      const reportContent = generateMarkdownReport(reportData);
      await saveReportToProject(projectPath, reportContent, evaluationId);
    } catch (reportErr) {
      console.error(`[${evaluationId}] Failed to generate report:`, reportErr);
    }

    // Phase 3: Reflection + Grounded Judge + Prescription (non-blocking, parallel)
    if (roleResults.length > 0) {
      runReflectionPhase(evaluationId, projectPath, roleResults).catch(err => {
        console.error(`[${evaluationId}] Reflection failed:`, err);
      });
      runJudgePhase(evaluationId, projectPath, analysis, roleResults).catch(err => {
        console.error(`[${evaluationId}] Judge phase failed:`, err);
      });
      runPrescriptionPhase(evaluationId, projectPath, projectName, roleResults, {
        structure: {
          totalFiles: analysis.structure?.totalFiles,
          totalLines: analysis.structure?.totalLines,
          languages: analysis.structure?.languages,
        },
        api: { totalEndpoints: analysis.api?.totalEndpoints },
        database: {
          totalEntities: analysis.database?.totalEntities,
          totalColumns: analysis.database?.totalColumns,
          orms: analysis.database?.orms,
        },
        quality: {
          ...analysis.quality,
          hasDocker: analysis.quality?.hasDockerfile || analysis.quality?.hasDockerCompose,
          hasLinting: analysis.quality?.hasLinter,
        },
      }).catch((err: unknown) => {
        console.error(`[${evaluationId}] Prescription failed:`, err);
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
  projectPath: string,
  roleResults: RoleResult[],
  debateSummary?: string
) {
  try {
    console.log(`[${evaluationId}] Starting reflection phase...`);
    emitReflecting(evaluationId);

    // Gather MREP metrics for reflection
    const { getMrepReports: fetchMrepReports, getMrepVerifications: fetchMrepVerifications } = await import('../db/sqlite');
    const mrepReports = fetchMrepReports(evaluationId);
    const mrepVerifications = fetchMrepVerifications(evaluationId);
    const mrepMetrics = mrepReports.map(rr => {
      const vr = mrepVerifications.find(v => v.role_id === rr.role_id);
      return {
        role_id: rr.role_id,
        total_claims: rr.metrics_snapshot.total_claims,
        evidence_coverage: rr.metrics_snapshot.evidence_coverage,
        verification_pass_rate: vr?.summary.pass_rate ?? null,
        avg_confidence: rr.metrics_snapshot.avg_confidence,
      };
    });

    const reflection = await runReflection(evaluationId, roleResults, debateSummary, mrepMetrics.length > 0 ? mrepMetrics : undefined);

    // Convert to storage format
    saveReflection({
      evaluationId,
      projectPath,
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

async function runJudgePhase(
  evaluationId: string,
  projectPath: string,
  analysis: { summary: string; quality: import('../analyzers/quality').QualityAnalysis },
  roleResults: RoleResult[]
) {
  try {
    console.log(`[${evaluationId}] Starting grounded judge phase...`);

    // Build or retrieve cached reference (generated BEFORE seeing evaluation output)
    const reference = await getOrBuildReference(projectPath, analysis.summary, analysis.quality);
    saveJudgeReference(reference);

    // Gather MREP metrics for accuracy dimension
    const { getMrepReports, getMrepVerifications } = await import('../db/sqlite');
    const mrepReports = getMrepReports(evaluationId);
    const mrepVerifications = getMrepVerifications(evaluationId);
    const mrepMetrics = mrepReports.map(rr => {
      const vr = mrepVerifications.find((v: { role_id: string }) => v.role_id === rr.role_id);
      return {
        role_id: rr.role_id,
        total_claims: rr.metrics_snapshot.total_claims,
        evidence_coverage: rr.metrics_snapshot.evidence_coverage,
        verification_pass_rate: vr?.summary.pass_rate ?? null,
        avg_confidence: rr.metrics_snapshot.avg_confidence,
      };
    });

    // Run the grounded judge
    const judgment = await runGroundedJudge(
      evaluationId,
      projectPath,
      reference,
      roleResults,
      mrepMetrics.length > 0 ? mrepMetrics : undefined
    );

    saveJudgment(judgment);
    console.log(`[${evaluationId}] Judge complete: overall=${judgment.overallScore}, coverage=${judgment.dimensions.coverage.score}`);
  } catch (error) {
    console.error(`[${evaluationId}] Judge phase error:`, error);
  }
}

async function runPrescriptionPhase(
  evaluationId: string,
  projectPath: string,
  projectName: string,
  roleResults: RoleResult[],
  analysisData: Record<string, any> | null,
) {
  try {
    console.log(`[${evaluationId}] Starting prescription phase...`);
    emitPrescribing(evaluationId);

    // Convert RoleResult to the format expected by gap-extractor
    const roleOutputs = roleResults
      .filter(r => !r.role.startsWith('_'))
      .map(r => ({
        role: r.role,
        score: r.score,
        parsed: typeof r.details === 'string' ? JSON.parse(r.details) : (r.details || {}),
      }));

    const report = await runPrescription(
      evaluationId,
      projectPath,
      projectName,
      roleOutputs,
      analysisData,
    );

    if (report) {
      console.log(`[${evaluationId}] Prescription complete: ${report.prescriptions.length} plans generated`);
    }
  } catch (error) {
    console.error(`[${evaluationId}] Prescription phase error:`, error);
  }
}

// Re-run prescription phase for an already-completed evaluation
router.post('/:id/re-prescribe', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const evaluation = getEvaluation(id);
    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }
    if (evaluation.status !== 'completed') {
      return res.status(400).json({ error: `Evaluation status is '${evaluation.status}', must be 'completed'` });
    }

    const roleEvaluations = getRoleEvaluations(id);
    if (roleEvaluations.length === 0) {
      return res.status(400).json({ error: 'No role evaluations found' });
    }

    const analysisData = evaluation.analysisData ? JSON.parse(evaluation.analysisData) : null;
    const roleResults: RoleResult[] = roleEvaluations.map(re => ({
      role: re.role,
      score: re.score ?? 0,
      summary: re.summary || '',
      details: re.details ? JSON.parse(re.details) : {},
    }));

    res.json({ status: 'started', evaluationId: id, message: 'Prescription phase re-triggered' });

    // Run async — won't block the response
    runPrescriptionPhase(id, evaluation.projectPath, evaluation.projectName, roleResults, {
      structure: {
        totalFiles: analysisData?.structure?.totalFiles,
        totalLines: analysisData?.structure?.totalLines,
        languages: analysisData?.structure?.languages,
      },
      api: { totalEndpoints: analysisData?.api?.totalEndpoints },
      database: {
        totalEntities: analysisData?.database?.totalEntities,
        totalColumns: analysisData?.database?.totalColumns,
        orms: analysisData?.database?.orms,
      },
      quality: {
        ...analysisData?.quality,
        hasDocker: analysisData?.quality?.hasDockerfile || analysisData?.quality?.hasDockerCompose,
        hasLinting: analysisData?.quality?.hasLinter,
      },
    }).then(() => {
      console.log(`[${id}] Re-prescription completed`);
    }).catch((err: unknown) => {
      console.error(`[${id}] Re-prescription failed:`, err);
    });
  } catch (error) {
    console.error('Re-prescribe error:', error);
    res.status(500).json({ error: 'Failed to re-trigger prescription' });
  }
});

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
    config.rolePrompts,
    config.provider
  );
}

export default router;
