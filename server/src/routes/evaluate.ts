import { Router, Request, Response } from 'express';
import { analyzeProject } from '../analyzers';
import { evaluateWithRole } from '../ai/qwen';
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
} from '../ws/progress';

const router = Router();

interface EvaluateRequest {
  projectPath: string;
  projectName: string;
  roles: ('boss' | 'merchant' | 'operator' | 'architect')[];
  context: string;
  depth: 'quick' | 'deep';
  rolePrompts?: Record<string, string>;
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { projectPath, projectName, roles, context, depth, rolePrompts } = req.body as EvaluateRequest;

    if (!projectPath || !projectName) {
      return res.status(400).json({ error: 'projectPath and projectName are required' });
    }

    const selectedRoles = roles || ['boss', 'merchant', 'operator'];
    const selectedDepth = depth || 'quick';
    const evaluationId = createEvaluation(projectName, projectPath, context || '');

    res.json({ id: evaluationId, status: 'started', depth: selectedDepth });

    runEvaluation(evaluationId, projectPath, projectName, selectedRoles, context || '', selectedDepth, rolePrompts).catch(console.error);
  } catch (error) {
    console.error('Evaluation error:', error);
    res.status(500).json({ error: 'Failed to start evaluation' });
  }
});

async function runEvaluation(
  evaluationId: string,
  projectPath: string,
  projectName: string,
  roles: ('boss' | 'merchant' | 'operator' | 'architect')[],
  context: string,
  depth: 'quick' | 'deep',
  rolePrompts?: Record<string, string>
) {
  try {
    emitStarted(evaluationId, projectName);
    updateEvaluationStatus(evaluationId, 'analyzing');
    emitAnalyzing(evaluationId);

    console.log(`[${evaluationId}] Starting ${depth} analysis of ${projectName}...`);
    const analysis = await analyzeProject(projectPath, depth);
    console.log(`[${evaluationId}] Analysis complete: ${analysis.api.totalEndpoints} endpoints, ${analysis.database.totalEntities} entities, ${analysis.metrics.totalFiles} files`);
    
    updateEvaluationStatus(evaluationId, 'evaluating', JSON.stringify(analysis));

    const scores: number[] = [];

    for (let i = 0; i < roles.length; i++) {
      const role = roles[i];
      try {
        console.log(`[${evaluationId}] Evaluating with role: ${role} (${depth} mode)`);
        emitEvaluatingRole(evaluationId, role, i, roles.length);
        
        const result = await evaluateWithRole(role, analysis.summary, context, depth, rolePrompts?.[role]);
        
        let parsed: any;
        try {
          const jsonMatch = result.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          } else {
            parsed = { score: 70, summary: result, dimensions: {} };
          }
        } catch {
          parsed = { score: 70, summary: result, dimensions: {} };
        }

        const score = parsed.score || 70;
        scores.push(score);
        emitRoleCompleted(evaluationId, role, score);

        saveRoleEvaluation(
          evaluationId,
          role,
          score,
          parsed.summary || '',
          JSON.stringify(parsed)
        );
        console.log(`[${evaluationId}] Role ${role} scored: ${score}`);
      } catch (error) {
        console.error(`Error evaluating role ${role}:`, error);
        saveRoleEvaluation(evaluationId, role, 0, 'Evaluation failed', JSON.stringify({ error: String(error) }));
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
