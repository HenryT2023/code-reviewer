// MREP API routes: query MREP reports, trigger verification, view stats
import { Router, Request, Response } from 'express';
import {
  getMrepReports,
  getMrepVerifications,
  getAllMrepReports,
  getAllMrepVerifications,
  getEvaluation,
  saveMrepVerification,
} from '../db/sqlite';
import { verifyMrepReport } from '../mrep';
import { computeAggregateStats } from '../mrep/metrics';

const router = Router();

// GET /api/mrep/stats/aggregate - Get aggregate MREP stats (optionally filtered by ?project=)
// (Must be defined before /:evaluationId to avoid path param matching "stats")
router.get('/stats/aggregate', (req: Request, res: Response) => {
  try {
    const project = req.query.project;
    const projectPath = typeof project === 'string' && project.length > 0 ? decodeURIComponent(project) : undefined;
    const allReports = getAllMrepReports(projectPath);
    const allVerifications = getAllMrepVerifications(projectPath);
    const stats = computeAggregateStats(allReports, allVerifications);
    res.json({ ...stats, projectPath: projectPath || null });
  } catch (error) {
    console.error('MREP stats error:', error);
    res.status(500).json({ error: 'Failed to compute MREP stats' });
  }
});

// GET /api/mrep/:evaluationId - Get MREP reports for an evaluation
router.get('/:evaluationId', (req: Request, res: Response) => {
  try {
    const { evaluationId } = req.params;
    const reports = getMrepReports(evaluationId);
    const verifications = getMrepVerifications(evaluationId);

    if (reports.length === 0) {
      return res.status(404).json({ error: 'No MREP data for this evaluation' });
    }

    res.json({
      evaluation_id: evaluationId,
      reports,
      verifications,
      summary: {
        total_roles: reports.length,
        total_claims: reports.reduce((sum, r) => sum + r.claims.length, 0),
        avg_evidence_coverage: reports.length > 0
          ? Math.round(reports.reduce((sum, r) => sum + r.metrics_snapshot.evidence_coverage, 0) / reports.length * 100) / 100
          : 0,
        avg_confidence: reports.length > 0
          ? Math.round(reports.reduce((sum, r) => sum + r.metrics_snapshot.avg_confidence, 0) / reports.length * 100) / 100
          : 0,
        verification_pass_rate: verifications.length > 0
          ? Math.round(verifications.reduce((sum, v) => sum + v.summary.pass_rate, 0) / verifications.length * 100) / 100
          : null,
      },
    });
  } catch (error) {
    console.error('Get MREP error:', error);
    res.status(500).json({ error: 'Failed to get MREP data' });
  }
});

// POST /api/mrep/:evaluationId/verify - Re-run verification for an evaluation
router.post('/:evaluationId/verify', (req: Request, res: Response) => {
  try {
    const { evaluationId } = req.params;
    const evaluation = getEvaluation(evaluationId);
    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }

    const reports = getMrepReports(evaluationId);
    if (reports.length === 0) {
      return res.status(404).json({ error: 'No MREP reports to verify' });
    }

    const results = reports.map(report => {
      const verification = verifyMrepReport(report, evaluation.projectPath);
      saveMrepVerification(verification);
      return verification;
    });

    res.json({
      evaluation_id: evaluationId,
      verifications: results,
      summary: {
        total_verified: results.reduce((sum, v) => sum + v.summary.verified, 0),
        total_claims: results.reduce((sum, v) => sum + v.summary.total, 0),
        avg_pass_rate: results.length > 0
          ? Math.round(results.reduce((sum, v) => sum + v.summary.pass_rate, 0) / results.length * 100) / 100
          : 0,
      },
    });
  } catch (error) {
    console.error('MREP verify error:', error);
    res.status(500).json({ error: 'Failed to verify MREP claims' });
  }
});

export default router;
