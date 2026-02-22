// Judge API: endpoints for viewing grounded judgments and triggering re-evaluation
import { Router, Request, Response } from 'express';
import {
  getJudgment,
  listJudgments,
  getJudgeReference,
  getEvaluation,
  getRoleEvaluations,
  saveJudgeReference,
  saveJudgment,
  getMrepReports,
  getMrepVerifications,
} from '../db/sqlite';
import { getOrBuildReference, runGroundedJudge, formatJudgmentSummary } from '../grounded-judge';
import type { RoleResult } from '../ai/role-evolution';

const router = Router();

function getProjectFilter(req: Request): string | undefined {
  const p = req.query.project;
  return typeof p === 'string' && p.length > 0 ? decodeURIComponent(p) : undefined;
}

// GET /api/judge/stats - Judge statistics (optionally filtered by ?project=)
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectFilter(req);
    const judgments = listJudgments(projectPath, 100);

    if (judgments.length === 0) {
      return res.json({
        count: 0,
        averageScore: null,
        averageDimensions: null,
        projectPath: projectPath || null,
      });
    }

    const avgScore = Math.round(
      judgments.reduce((a, j) => a + j.overallScore, 0) / judgments.length
    );

    const avgDimensions = {
      coverage: Math.round(judgments.reduce((a, j) => a + j.dimensions.coverage.score, 0) / judgments.length),
      accuracy: Math.round(judgments.reduce((a, j) => a + j.dimensions.accuracy.score, 0) / judgments.length),
      calibration: Math.round(judgments.reduce((a, j) => a + j.dimensions.calibration.score, 0) / judgments.length),
      specificity: Math.round(judgments.reduce((a, j) => a + j.dimensions.specificity.score, 0) / judgments.length),
    };

    // Trend: last 10 judgments
    const trend = judgments.slice(0, 10).map(j => ({
      evaluationId: j.evaluationId,
      overallScore: j.overallScore,
      timestamp: j.timestamp,
    }));

    res.json({
      count: judgments.length,
      averageScore: avgScore,
      averageDimensions: avgDimensions,
      trend,
      projectPath: projectPath || null,
    });
  } catch (error) {
    console.error('Judge stats error:', error);
    res.status(500).json({ error: 'Failed to get judge stats' });
  }
});

// GET /api/judge/:evaluationId - Get judgment for a specific evaluation
router.get('/:evaluationId', async (req: Request, res: Response) => {
  try {
    const { evaluationId } = req.params;
    const judgment = getJudgment(evaluationId);

    if (!judgment) {
      return res.status(404).json({ error: 'No judgment found for this evaluation' });
    }

    const reference = getJudgeReference(judgment.referenceId);

    res.json({
      judgment,
      reference: reference ? {
        id: reference.id,
        techStack: reference.techStack,
        checklistSize: reference.staticChecklist.length + reference.aiChecklist.length,
        generatedAt: reference.generatedAt,
      } : null,
    });
  } catch (error) {
    console.error('Get judgment error:', error);
    res.status(500).json({ error: 'Failed to get judgment' });
  }
});

// POST /api/judge/:evaluationId/rerun - Rerun judgment for an evaluation
router.post('/:evaluationId/rerun', async (req: Request, res: Response) => {
  try {
    const { evaluationId } = req.params;

    const evaluation = getEvaluation(evaluationId);
    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }
    if (evaluation.status !== 'completed') {
      return res.status(400).json({ error: 'Evaluation is not completed yet' });
    }

    // Get role evaluations
    const roleEvals = getRoleEvaluations(evaluationId);
    const regularRoles = roleEvals.filter(re => !re.role.startsWith('_'));
    if (regularRoles.length === 0) {
      return res.status(400).json({ error: 'No role evaluations found' });
    }

    const roleResults: RoleResult[] = regularRoles.map(re => ({
      role: re.role,
      score: re.score || 0,
      summary: re.summary || '',
      details: re.details ? JSON.parse(re.details) : {},
    }));

    // Build reference from analysis data
    const analysisData = evaluation.analysisData ? JSON.parse(evaluation.analysisData) : null;
    const quality = analysisData?.quality || {};
    const summary = analysisData?.summary || '';

    const reference = await getOrBuildReference(evaluation.projectPath, summary, quality);
    saveJudgeReference(reference);

    // Get MREP metrics
    const mrepReports = getMrepReports(evaluationId);
    const mrepVerifications = getMrepVerifications(evaluationId);
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

    const judgment = await runGroundedJudge(
      evaluationId,
      evaluation.projectPath,
      reference,
      roleResults,
      mrepMetrics.length > 0 ? mrepMetrics : undefined
    );

    saveJudgment(judgment);

    res.json({
      success: true,
      judgment,
      summary: formatJudgmentSummary(judgment, reference.techStack),
    });
  } catch (error) {
    console.error('Rerun judgment error:', error);
    res.status(500).json({ error: 'Failed to rerun judgment' });
  }
});

export default router;
