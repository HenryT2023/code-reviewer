// A/B Test API: trigger, monitor, and decide on prompt comparison tests
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  saveABTest,
  getABTest,
  updateABTest,
  listABTests,
  listSyntheses,
  getEvaluation,
  getJudgment,
  createEvaluation,
} from '../db/sqlite';
import type { ABTestRecord } from '../db/sqlite';
import { applyOverrides } from '../prompt-overrides/manager';

const router = Router();

function getProjectFilter(req: Request): string | undefined {
  const p = req.query.project;
  return typeof p === 'string' && p.length > 0 ? decodeURIComponent(p) : undefined;
}

// POST /api/ab-test/trigger - Start an A/B test comparing current vs synthesis prompts
router.post('/trigger', async (req: Request, res: Response) => {
  try {
    const { synthesisId, projectPath, projectName, roles, context, depth } = req.body;

    if (!synthesisId || !projectPath || !projectName || !roles?.length) {
      return res.status(400).json({
        error: 'Required: synthesisId, projectPath, projectName, roles',
      });
    }

    // Find the synthesis to get prompt diffs
    const allSyntheses = listSyntheses(100);
    const synthesis = allSyntheses.find(s => s.id === synthesisId);
    if (!synthesis) {
      return res.status(404).json({ error: 'Synthesis not found' });
    }

    // Create two evaluation records
    const evalIdA = createEvaluation(
      `${projectName} [A/B baseline]`,
      projectPath,
      context || '',
      'static'
    );
    const evalIdB = createEvaluation(
      `${projectName} [A/B variant]`,
      projectPath,
      context || '',
      'static'
    );

    const now = new Date().toISOString();
    const testId = uuidv4();
    const record: ABTestRecord = {
      id: testId,
      projectPath,
      synthesisId,
      evaluationA: evalIdA,
      evaluationB: evalIdB,
      status: 'running_a',
      createdAt: now,
      updatedAt: now,
    };
    saveABTest(record);

    // Build prompt overrides from synthesis diffs for variant B
    const promptOverrides: Record<string, string> = {};
    for (const diff of synthesis.promptDiffs) {
      if (diff.rewrittenPrompt && diff.rewrittenPrompt.trim().length > 50) {
        promptOverrides[diff.role] = diff.rewrittenPrompt;
      }
    }

    // Trigger both evaluations asynchronously
    // Import runEvaluation dynamically to avoid circular dependency
    runABEvaluations(testId, evalIdA, evalIdB, projectPath, projectName, roles, context || '', depth || 'quick', promptOverrides).catch(err => {
      console.error(`[A/B ${testId}] Failed:`, err);
      updateABTest(testId, { status: 'decided', result: {
        judgeScoreA: 0, judgeScoreB: 0, judgeDelta: 0,
        decision: 'inconclusive', reason: `Error: ${String(err)}`,
      }});
    });

    res.json({
      testId,
      evaluationA: evalIdA,
      evaluationB: evalIdB,
      status: 'running_a',
      promptOverrideRoles: Object.keys(promptOverrides),
    });
  } catch (error) {
    console.error('Trigger A/B test error:', error);
    res.status(500).json({ error: 'Failed to trigger A/B test' });
  }
});

// GET /api/ab-test/:id - Get A/B test status and result
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const test = getABTest(id);
    if (!test) {
      return res.status(404).json({ error: 'A/B test not found' });
    }

    // Enrich with evaluation and judgment details
    const evalA = getEvaluation(test.evaluationA);
    const evalB = getEvaluation(test.evaluationB);
    const judgmentA = getJudgment(test.evaluationA);
    const judgmentB = getJudgment(test.evaluationB);

    res.json({
      ...test,
      evaluations: {
        a: evalA ? { status: evalA.status, overallScore: evalA.overallScore } : null,
        b: evalB ? { status: evalB.status, overallScore: evalB.overallScore } : null,
      },
      judgments: {
        a: judgmentA ? { overallScore: judgmentA.overallScore, dimensions: judgmentA.dimensions } : null,
        b: judgmentB ? { overallScore: judgmentB.overallScore, dimensions: judgmentB.dimensions } : null,
      },
    });
  } catch (error) {
    console.error('Get A/B test error:', error);
    res.status(500).json({ error: 'Failed to get A/B test' });
  }
});

// GET /api/ab-test - List A/B tests (optionally filtered by ?project=)
router.get('/', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectFilter(req);
    const tests = listABTests(projectPath);
    res.json({ count: tests.length, projectPath: projectPath || null, tests });
  } catch (error) {
    console.error('List A/B tests error:', error);
    res.status(500).json({ error: 'Failed to list A/B tests' });
  }
});

// POST /api/ab-test/:id/apply - Manually apply A/B test result (for inconclusive tests)
router.post('/:id/apply', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const test = getABTest(id);
    if (!test) {
      return res.status(404).json({ error: 'A/B test not found' });
    }
    if (test.status !== 'decided') {
      return res.status(400).json({ error: 'A/B test has not been decided yet' });
    }

    // Find synthesis and apply its overrides
    const allSyntheses = listSyntheses(100);
    const synthesis = allSyntheses.find(s => s.id === test.synthesisId);
    if (!synthesis) {
      return res.status(404).json({ error: 'Original synthesis not found' });
    }

    const diffs = synthesis.promptDiffs
      .filter(d => d.rewrittenPrompt && d.rewrittenPrompt.trim().length > 0)
      .map(d => ({
        role: d.role,
        rewrittenPrompt: d.rewrittenPrompt,
        confidence: d.confidence,
      }));

    const result = applyOverrides(test.synthesisId, test.projectPath, diffs);
    updateABTest(id, {
      result: {
        ...test.result!,
        decision: 'apply',
        reason: `Manually applied. ${test.result?.reason || ''}`,
      },
    });

    res.json({ success: true, overrides: result });
  } catch (error) {
    console.error('Apply A/B test error:', error);
    res.status(500).json({ error: 'Failed to apply A/B test result' });
  }
});

// ─── Background A/B evaluation runner ───────────────────────────────

const AB_APPLY_THRESHOLD = 5; // B must score > A + threshold to auto-apply

async function runABEvaluations(
  testId: string,
  evalIdA: string,
  evalIdB: string,
  projectPath: string,
  projectName: string,
  roles: string[],
  context: string,
  depth: 'quick' | 'deep',
  promptOverrides: Record<string, string>
) {
  // Dynamic import to avoid circular dependency
  const { runEvaluationJob } = await import('./evaluate');

  console.log(`[A/B ${testId}] Starting baseline evaluation (A)...`);
  updateABTest(testId, { status: 'running_a' });

  // Run evaluation A (baseline — current prompts)
  await runEvaluationJob(
    {
      evaluationId: evalIdA,
      config: { projectPath, projectName, roles, context, depth, mode: 'standard' },
    },
    -1 // special worker ID for A/B
  );

  console.log(`[A/B ${testId}] Starting variant evaluation (B)...`);
  updateABTest(testId, { status: 'running_b' });

  // Run evaluation B (variant — with synthesis prompt overrides)
  await runEvaluationJob(
    {
      evaluationId: evalIdB,
      config: { projectPath, projectName, roles, context, depth, mode: 'standard', rolePrompts: promptOverrides },
    },
    -2 // special worker ID for A/B
  );

  console.log(`[A/B ${testId}] Both evaluations complete. Waiting for judge phases...`);
  updateABTest(testId, { status: 'judging' });

  // Poll for judge results (they run async after evaluation)
  const maxWaitMs = 120000; // 2 minutes max
  const pollIntervalMs = 3000; // check every 3 seconds
  let waited = 0;
  let judgmentA = null;
  let judgmentB = null;

  while (waited < maxWaitMs) {
    judgmentA = getJudgment(evalIdA);
    judgmentB = getJudgment(evalIdB);
    if (judgmentA && judgmentB) {
      console.log(`[A/B ${testId}] Both judgments ready after ${waited}ms`);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    waited += pollIntervalMs;
  }

  // Final check
  if (!judgmentA) judgmentA = getJudgment(evalIdA);
  if (!judgmentB) judgmentB = getJudgment(evalIdB);

  const scoreA = judgmentA?.overallScore ?? 0;
  const scoreB = judgmentB?.overallScore ?? 0;
  const delta = scoreB - scoreA;

  let decision: 'apply' | 'discard' | 'inconclusive';
  let reason: string;

  if (!judgmentA || !judgmentB) {
    decision = 'inconclusive';
    reason = `Judge results incomplete: A=${judgmentA ? 'ok' : 'missing'}, B=${judgmentB ? 'ok' : 'missing'}`;
  } else if (delta > AB_APPLY_THRESHOLD) {
    decision = 'apply';
    reason = `Variant B scores ${delta} points higher (${scoreB} vs ${scoreA}), exceeds threshold of ${AB_APPLY_THRESHOLD}`;
  } else if (delta < -AB_APPLY_THRESHOLD) {
    decision = 'discard';
    reason = `Variant B scores ${Math.abs(delta)} points lower (${scoreB} vs ${scoreA}), discarding`;
  } else {
    decision = 'inconclusive';
    reason = `Delta ${delta} within threshold (${scoreB} vs ${scoreA}), manual review recommended`;
  }

  updateABTest(testId, {
    status: 'decided',
    result: { judgeScoreA: scoreA, judgeScoreB: scoreB, judgeDelta: delta, decision, reason },
  });

  console.log(`[A/B ${testId}] Decision: ${decision} (A=${scoreA}, B=${scoreB}, delta=${delta})`);

  // Auto-apply if decision is 'apply'
  if (decision === 'apply') {
    const { listSyntheses: fetchSyntheses } = await import('../db/sqlite');
    const allSynth = fetchSyntheses(100);
    const test = getABTest(testId);
    const synthesis = allSynth.find(s => s.id === test?.synthesisId);
    if (synthesis) {
      const diffs = synthesis.promptDiffs
        .filter(d => d.rewrittenPrompt && d.rewrittenPrompt.trim().length > 0)
        .map(d => ({
          role: d.role,
          rewrittenPrompt: d.rewrittenPrompt,
          confidence: d.confidence,
        }));
      const { applyOverrides: doApply } = await import('../prompt-overrides/manager');
      doApply(synthesis.id, synthesis.projectPath, diffs);
      console.log(`[A/B ${testId}] Auto-applied synthesis overrides`);
    }
  }
}

export default router;
