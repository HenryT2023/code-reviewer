// GET /api/trace/:evaluationId — return the persisted trace tree for an
// evaluation. See CLAUDE.md P1-3.
//
// The trace is saved by ai/observability/tracer.ts when withTrace() finishes.
// Response shape matches the Trace type exactly so a future web-UI trace
// viewer can render it without reshaping.

import { Router, Request, Response } from 'express';
import { readTrace } from '../observability/tracer';

const router = Router();

router.get('/:evaluationId', (req: Request, res: Response) => {
  const { evaluationId } = req.params;
  const trace = readTrace(evaluationId);
  if (!trace) {
    return res.status(404).json({ error: 'trace not found', evaluationId });
  }
  res.json(trace);
});

export default router;
