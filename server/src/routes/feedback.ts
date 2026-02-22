// Feedback API: endpoints for submitting optimization plans and tracking results
import { Router, Request, Response } from 'express';
import {
  saveFeedbackPlan,
  getFeedbackPlan,
  getFeedbackPlanByEvaluation,
  listFeedbackPlans,
  updateFeedbackTask,
  completeFeedbackPlan,
  getProjectFeedbackStats,
  getEvaluation,
  type FeedbackTask,
} from '../db/sqlite';

const router = Router();

function getProjectFilter(req: Request): string | undefined {
  const p = req.query.project;
  return typeof p === 'string' && p.length > 0 ? decodeURIComponent(p) : undefined;
}

// POST /api/feedback/plan - Submit an optimization plan
router.post('/plan', async (req: Request, res: Response) => {
  try {
    const {
      evaluationId,
      projectPath,
      projectName,
      baselineScore,
      expectedScore,
      tasks,
    } = req.body;

    // Validate required fields
    if (!evaluationId || !projectPath || !tasks || !Array.isArray(tasks)) {
      return res.status(400).json({
        error: 'Missing required fields: evaluationId, projectPath, tasks',
      });
    }

    // Validate evaluation exists
    const evaluation = getEvaluation(evaluationId);
    if (!evaluation) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }

    // Normalize tasks
    const normalizedTasks: FeedbackTask[] = tasks.map((t: any, index: number) => ({
      id: t.id || `task-${index + 1}`,
      priority: t.priority || 'medium',
      description: t.description || '',
      expectedImprovement: t.expectedImprovement || '',
      estimatedTime: t.estimatedTime || '',
      status: 'pending' as const,
    }));

    const planId = saveFeedbackPlan({
      evaluationId,
      projectPath,
      projectName: projectName || evaluation.projectName,
      baselineScore: baselineScore ?? evaluation.overallScore ?? 0,
      expectedScore: expectedScore ?? 0,
      tasks: normalizedTasks,
    });

    console.log(`[Feedback] Plan ${planId} created for ${projectPath} with ${normalizedTasks.length} tasks`);

    res.json({
      success: true,
      planId,
      taskCount: normalizedTasks.length,
      message: `Optimization plan created with ${normalizedTasks.length} tasks`,
    });
  } catch (error) {
    console.error('Create feedback plan error:', error);
    res.status(500).json({ error: 'Failed to create feedback plan' });
  }
});

// GET /api/feedback/plan/:planId - Get a specific plan
router.get('/plan/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const plan = getFeedbackPlan(planId);

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    res.json(plan);
  } catch (error) {
    console.error('Get feedback plan error:', error);
    res.status(500).json({ error: 'Failed to get feedback plan' });
  }
});

// GET /api/feedback/plans - List plans (optionally filtered by ?project=)
router.get('/plans', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectFilter(req);
    const plans = listFeedbackPlans(projectPath);

    res.json({
      count: plans.length,
      projectPath: projectPath || null,
      plans,
    });
  } catch (error) {
    console.error('List feedback plans error:', error);
    res.status(500).json({ error: 'Failed to list feedback plans' });
  }
});

// POST /api/feedback/task/:planId/:taskId - Update task status
router.post('/task/:planId/:taskId', async (req: Request, res: Response) => {
  try {
    const { planId, taskId } = req.params;
    const { status, actualChanges } = req.body;

    if (!status || !['completed', 'partial', 'skipped'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status. Must be: completed, partial, or skipped',
      });
    }

    const success = updateFeedbackTask(planId, taskId, { status, actualChanges });

    if (!success) {
      return res.status(404).json({ error: 'Plan or task not found' });
    }

    console.log(`[Feedback] Task ${taskId} in plan ${planId} marked as ${status}`);

    res.json({
      success: true,
      message: `Task ${taskId} marked as ${status}`,
    });
  } catch (error) {
    console.error('Update feedback task error:', error);
    res.status(500).json({ error: 'Failed to update feedback task' });
  }
});

// POST /api/feedback/complete/:planId - Complete a plan with new evaluation results
router.post('/complete/:planId', async (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const { newEvaluationId, actualScore } = req.body;

    if (!newEvaluationId || actualScore === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: newEvaluationId, actualScore',
      });
    }

    const plan = getFeedbackPlan(planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const success = completeFeedbackPlan(planId, newEvaluationId, actualScore);

    if (!success) {
      return res.status(500).json({ error: 'Failed to complete plan' });
    }

    const improvement = actualScore - plan.baselineScore;
    const expectedMet = actualScore >= plan.expectedScore;

    console.log(`[Feedback] Plan ${planId} completed: ${plan.baselineScore} → ${actualScore} (${improvement >= 0 ? '+' : ''}${improvement})`);

    res.json({
      success: true,
      planId,
      baselineScore: plan.baselineScore,
      expectedScore: plan.expectedScore,
      actualScore,
      improvement,
      expectedMet,
      message: expectedMet
        ? `✅ Goal achieved! Score improved by ${improvement} points`
        : `⚠️ Partial improvement: +${improvement} points (expected ${plan.expectedScore})`,
    });
  } catch (error) {
    console.error('Complete feedback plan error:', error);
    res.status(500).json({ error: 'Failed to complete feedback plan' });
  }
});

// GET /api/feedback/stats - Get feedback statistics for a project
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const projectPath = getProjectFilter(req);
    if (!projectPath) {
      return res.status(400).json({ error: 'project query parameter is required' });
    }

    const stats = getProjectFeedbackStats(projectPath);

    res.json({
      projectPath,
      ...stats,
    });
  } catch (error) {
    console.error('Get feedback stats error:', error);
    res.status(500).json({ error: 'Failed to get feedback stats' });
  }
});

// GET /api/feedback/by-evaluation/:evaluationId - Get plan by evaluation ID
router.get('/by-evaluation/:evaluationId', async (req: Request, res: Response) => {
  try {
    const { evaluationId } = req.params;
    const plan = getFeedbackPlanByEvaluation(evaluationId);

    if (!plan) {
      return res.status(404).json({ error: 'No plan found for this evaluation' });
    }

    res.json(plan);
  } catch (error) {
    console.error('Get feedback by evaluation error:', error);
    res.status(500).json({ error: 'Failed to get feedback plan' });
  }
});

export default router;
