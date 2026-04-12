// GET /api/usage/:evaluationId — read token usage aggregated by ai/client.ts
// in-memory log. See CLAUDE.md P0-3.
//
// Note: the log is in-memory only, so a server restart wipes prior
// evaluations' usage. P3-2 (SQLite store) will persist these later. For now
// this endpoint is useful for live debugging of ongoing evaluations and for
// verifying that the P0-4 prompt-caching path actually produces cache hits on
// Claude.

import { Router, Request, Response } from 'express';
import { getGlobalUsage, getUsageForEvaluation } from '../ai/client';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ summary: getGlobalUsage() });
});

router.get('/:evaluationId', (req: Request, res: Response) => {
  const { evaluationId } = req.params;
  const summary = getUsageForEvaluation(evaluationId);
  res.json({ evaluationId, summary });
});

export default router;
