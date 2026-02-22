// Queue status API routes
import { Router, Request, Response } from 'express';
import {
  getQueueStatus,
  getJobStatus,
  cancelEvaluation,
  taskQueue,
} from '../queue';

const router = Router();

// GET /api/queue/status - Get overall queue status
router.get('/status', (_req: Request, res: Response) => {
  try {
    const status = getQueueStatus();
    res.json(status);
  } catch (error) {
    console.error('Queue status error:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

// GET /api/queue/jobs - List all jobs
router.get('/jobs', (_req: Request, res: Response) => {
  try {
    const jobs = taskQueue.getAllJobs();
    res.json({
      pending: jobs.pending.map(j => ({
        id: j.id,
        evaluationId: j.evaluationId,
        projectName: j.config.projectName,
        status: j.status,
        priority: j.priority,
        createdAt: j.createdAt,
        queuePosition: taskQueue.getQueuePosition(j.id),
      })),
      running: jobs.running.map(j => ({
        id: j.id,
        evaluationId: j.evaluationId,
        projectName: j.config.projectName,
        status: j.status,
        workerId: j.workerId,
        startedAt: j.startedAt,
        progress: j.progress,
      })),
      completed: jobs.completed.slice(0, 20).map(j => ({
        id: j.id,
        evaluationId: j.evaluationId,
        projectName: j.config.projectName,
        status: j.status,
        completedAt: j.completedAt,
        error: j.error,
      })),
    });
  } catch (error) {
    console.error('Queue jobs error:', error);
    res.status(500).json({ error: 'Failed to get queue jobs' });
  }
});

// GET /api/queue/job/:evaluationId - Get job status by evaluation ID
router.get('/job/:evaluationId', (req: Request, res: Response) => {
  try {
    const { evaluationId } = req.params;
    const job = getJobStatus(evaluationId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      id: job.id,
      evaluationId: job.evaluationId,
      projectName: job.config.projectName,
      status: job.status,
      priority: job.priority,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      workerId: job.workerId,
      progress: job.progress,
      error: job.error,
      queuePosition: job.status === 'pending' ? taskQueue.getQueuePosition(job.id) : undefined,
    });
  } catch (error) {
    console.error('Queue job status error:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

// DELETE /api/queue/job/:evaluationId - Cancel a job
router.delete('/job/:evaluationId', (req: Request, res: Response) => {
  try {
    const { evaluationId } = req.params;
    const cancelled = cancelEvaluation(evaluationId);

    if (!cancelled) {
      return res.status(404).json({ error: 'Job not found or already completed' });
    }

    res.json({ success: true, evaluationId, message: 'Job cancelled' });
  } catch (error) {
    console.error('Queue cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

export default router;
