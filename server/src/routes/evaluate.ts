import { Router, Request, Response } from 'express';
import { analyzeProject } from '../analyzers';
import { evaluateWithRole } from '../ai/qwen';
import { runDebateRound, runOrchestrator } from '../ai/orchestrator';
import type { RoleResult, LaunchContext } from '../ai/orchestrator';
import {
  createEvaluation,
  updateEvaluationStatus,
  completeEvaluation,
  saveRoleEvaluation,
  getEvaluation,
  getRoleEvaluations,
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
} from '../ws/progress';

const router = Router();

interface EvaluateRequest {
  projectPath: string;
  projectName: string;
  roles: string[];
  context: string;
  depth: 'quick' | 'deep';
  mode?: 'standard' | 'launch-ready';
  launchContext?: LaunchContext;
  rolePrompts?: Record<string, string>;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { projectPath, projectName, roles, context, depth, mode, launchContext, rolePrompts } = req.body as EvaluateRequest;

    if (!projectPath || !projectName) {
      return res.status(400).json({ error: 'projectPath and projectName are required' });
    }

    const selectedRoles = roles || ['boss', 'merchant', 'operator'];
    const selectedDepth = depth || 'quick';
    const selectedMode = mode || 'standard';
    const evaluationId = createEvaluation(projectName, projectPath, context || '');

    res.json({ id: evaluationId, status: 'started', depth: selectedDepth, mode: selectedMode });

    runEvaluation(evaluationId, projectPath, projectName, selectedRoles, context || '', selectedDepth, selectedMode, launchContext, rolePrompts).catch(console.error);
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

async function runEvaluation(
  evaluationId: string,
  projectPath: string,
  projectName: string,
  roles: string[],
  context: string,
  depth: 'quick' | 'deep',
  mode: 'standard' | 'launch-ready' = 'standard',
  launchContext?: LaunchContext,
  rolePrompts?: Record<string, string>
) {
  try {
    emitStarted(evaluationId, projectName);
    updateEvaluationStatus(evaluationId, 'analyzing');
    emitAnalyzing(evaluationId);

    console.log(`[${evaluationId}] Starting ${depth} ${mode} analysis of ${projectName}...`);
    const analysis = await analyzeProject(projectPath, depth);
    console.log(`[${evaluationId}] Analysis complete: ${analysis.api.totalEndpoints} endpoints, ${analysis.database.totalEntities} entities, ${analysis.metrics.totalFiles} files`);
    
    updateEvaluationStatus(evaluationId, 'evaluating', JSON.stringify(analysis));

    const scores: number[] = [];
    const roleResults: RoleResult[] = [];

    // Phase 1: Run all role evaluations
    for (let i = 0; i < roles.length; i++) {
      const role = roles[i];
      try {
        console.log(`[${evaluationId}] Evaluating with role: ${role} (${depth} ${mode} mode)`);
        emitEvaluatingRole(evaluationId, role, i, roles.length);
        
        const result = await evaluateWithRole(role, analysis.summary, context, depth, mode, rolePrompts?.[role]);
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
  } catch (error) {
    console.error('Evaluation failed:', error);
    updateEvaluationStatus(evaluationId, 'failed');
    emitFailed(evaluationId, String(error));
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

export default router;
