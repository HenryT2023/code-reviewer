// Evaluation scheduler - dispatches jobs from queue to workers
import { QUEUE_CONFIG } from './config';
import { taskQueue, EvalJob } from './task-queue';
import { workerPool } from './worker-pool';
import { saveQueueState } from './persistence';
import { emitQueued, emitDequeued, emitCancelled } from '../ws/progress';

export type JobExecutor = (job: EvalJob, workerId: number) => Promise<void>;

let schedulerInterval: NodeJS.Timeout | null = null;
let jobExecutor: JobExecutor | null = null;

export function setJobExecutor(executor: JobExecutor): void {
  jobExecutor = executor;
}

async function tick(): Promise<void> {
  // Check for stuck workers
  const stuckWorkers = workerPool.getStuckWorkers();
  for (const worker of stuckWorkers) {
    console.warn(`[Scheduler] Worker ${worker.id} is stuck, force releasing`);
    if (worker.currentJobId) {
      taskQueue.complete(worker.currentJobId, 'timeout');
    }
    workerPool.forceRelease(worker.id);
    saveQueueState();
  }

  // Try to dequeue and execute jobs
  while (workerPool.getAvailableCount() > 0 && taskQueue.getPendingCount() > 0) {
    const job = taskQueue.dequeue();
    if (!job) break;

    const worker = workerPool.acquire();
    if (!worker) {
      // Shouldn't happen, but put job back
      console.error('[Scheduler] No worker available after dequeue');
      break;
    }

    workerPool.assignJob(worker.id, job.id, job.evaluationId);
    job.workerId = worker.id;

    console.log(`[Scheduler] Dispatching job ${job.id} (eval: ${job.evaluationId}) to worker ${worker.id}`);
    emitDequeued(job.evaluationId, worker.id);

    // Execute job asynchronously
    if (jobExecutor) {
      executeJob(job, worker.id).catch(error => {
        console.error(`[Scheduler] Job ${job.id} failed:`, error);
      });
    } else {
      console.error('[Scheduler] No job executor set');
      taskQueue.complete(job.id, 'no_executor');
      workerPool.release(worker.id);
    }
  }
}

async function executeJob(job: EvalJob, workerId: number): Promise<void> {
  try {
    if (!jobExecutor) {
      throw new Error('No job executor set');
    }

    await jobExecutor(job, workerId);

    // Check if job was cancelled during execution
    const currentJob = taskQueue.getJob(job.id);
    if (currentJob?.status === 'cancelled') {
      console.log(`[Scheduler] Job ${job.id} was cancelled during execution`);
      emitCancelled(job.evaluationId, 'user_requested');
    } else {
      taskQueue.complete(job.id);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Scheduler] Job ${job.id} error:`, errorMessage);
    taskQueue.complete(job.id, errorMessage);
  } finally {
    workerPool.release(workerId);
    saveQueueState();
  }
}

export function startScheduler(): void {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(() => {
    tick().catch(error => {
      console.error('[Scheduler] Tick error:', error);
    });
  }, QUEUE_CONFIG.pollInterval);

  console.log(`[Scheduler] Started (poll interval: ${QUEUE_CONFIG.pollInterval}ms)`);
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Scheduler] Stopped');
  }
}

export function enqueueEvaluation(
  evaluationId: string,
  config: EvalJob['config'],
  priority: number = 1
): { jobId: string; queuePosition: number } {
  const job = taskQueue.enqueue(evaluationId, config, priority);
  const queuePosition = taskQueue.getQueuePosition(job.id);

  console.log(`[Scheduler] Enqueued job ${job.id} (eval: ${evaluationId}) at position ${queuePosition}`);
  emitQueued(evaluationId, queuePosition);
  saveQueueState();

  // Trigger immediate tick
  tick().catch(console.error);

  return { jobId: job.id, queuePosition };
}

export function cancelEvaluation(evaluationId: string): boolean {
  const cancelled = taskQueue.cancelByEvaluationId(evaluationId);
  if (cancelled) {
    emitCancelled(evaluationId, 'user_requested');
    saveQueueState();
  }
  return cancelled;
}

export function getQueueStatus(): {
  stats: ReturnType<typeof taskQueue.getStats>;
  workers: ReturnType<typeof workerPool.getStatus>;
} {
  return {
    stats: taskQueue.getStats(),
    workers: workerPool.getStatus(),
  };
}

export function getJobStatus(evaluationId: string): EvalJob | null {
  return taskQueue.getJobByEvaluationId(evaluationId);
}
