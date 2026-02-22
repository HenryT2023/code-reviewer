// Task queue for managing evaluation jobs
import { v4 as uuidv4 } from 'uuid';
import { QUEUE_CONFIG } from './config';
import type { EvaluationType } from '../eval/types';
import type { LaunchContext } from '../ai/orchestrator';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface EvalJobConfig {
  projectPath: string;
  projectName: string;
  roles: string[];
  context: string;
  depth: 'quick' | 'deep';
  mode: 'standard' | 'launch-ready';
  evaluationType: EvaluationType;
  launchContext?: LaunchContext;
  rolePrompts?: Record<string, string>;
}

export interface EvalJob {
  id: string;
  evaluationId: string;
  config: EvalJobConfig;
  status: JobStatus;
  priority: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  workerId?: number;
  error?: string;
  progress?: {
    current: number;
    total: number;
    stage: string;
  };
}

export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  totalProcessed: number;
}

export class TaskQueue {
  private pending: EvalJob[] = [];
  private running: Map<string, EvalJob> = new Map();
  private completed: EvalJob[] = [];
  private totalProcessed: number = 0;

  enqueue(evaluationId: string, config: EvalJobConfig, priority: number = 1): EvalJob {
    if (this.pending.length >= QUEUE_CONFIG.maxQueueSize) {
      throw new Error(`Queue is full (max ${QUEUE_CONFIG.maxQueueSize} jobs)`);
    }

    const job: EvalJob = {
      id: uuidv4(),
      evaluationId,
      config,
      status: 'pending',
      priority: Math.min(Math.max(priority, 0), QUEUE_CONFIG.priorityLevels - 1),
      createdAt: new Date(),
    };

    // Insert by priority (higher priority first)
    const insertIndex = this.pending.findIndex(j => j.priority < priority);
    if (insertIndex === -1) {
      this.pending.push(job);
    } else {
      this.pending.splice(insertIndex, 0, job);
    }

    return job;
  }

  dequeue(): EvalJob | null {
    if (this.pending.length === 0) {
      return null;
    }
    if (this.running.size >= QUEUE_CONFIG.maxConcurrent) {
      return null;
    }

    const job = this.pending.shift()!;
    job.status = 'running';
    job.startedAt = new Date();
    this.running.set(job.id, job);
    return job;
  }

  complete(jobId: string, error?: string): boolean {
    const job = this.running.get(jobId);
    if (!job) return false;

    job.status = error ? 'failed' : 'completed';
    job.completedAt = new Date();
    if (error) job.error = error;

    this.running.delete(jobId);
    this.completed.unshift(job);
    this.totalProcessed++;

    // Keep only recent completed jobs
    if (this.completed.length > QUEUE_CONFIG.persistence.maxCompletedJobs) {
      this.completed = this.completed.slice(0, QUEUE_CONFIG.persistence.maxCompletedJobs);
    }

    return true;
  }

  cancel(jobId: string): boolean {
    // Check pending queue
    const pendingIndex = this.pending.findIndex(j => j.id === jobId);
    if (pendingIndex !== -1) {
      const job = this.pending.splice(pendingIndex, 1)[0];
      job.status = 'cancelled';
      job.completedAt = new Date();
      this.completed.unshift(job);
      return true;
    }

    // Check running queue (mark for cancellation, actual stop handled by worker)
    const runningJob = this.running.get(jobId);
    if (runningJob) {
      runningJob.status = 'cancelled';
      return true;
    }

    return false;
  }

  cancelByEvaluationId(evaluationId: string): boolean {
    // Check pending
    const pendingJob = this.pending.find(j => j.evaluationId === evaluationId);
    if (pendingJob) {
      return this.cancel(pendingJob.id);
    }

    // Check running
    for (const job of this.running.values()) {
      if (job.evaluationId === evaluationId) {
        return this.cancel(job.id);
      }
    }

    return false;
  }

  getJob(jobId: string): EvalJob | null {
    const pending = this.pending.find(j => j.id === jobId);
    if (pending) return pending;

    const running = this.running.get(jobId);
    if (running) return running;

    const completed = this.completed.find(j => j.id === jobId);
    if (completed) return completed;

    return null;
  }

  getJobByEvaluationId(evaluationId: string): EvalJob | null {
    const pending = this.pending.find(j => j.evaluationId === evaluationId);
    if (pending) return pending;

    for (const job of this.running.values()) {
      if (job.evaluationId === evaluationId) return job;
    }

    const completed = this.completed.find(j => j.evaluationId === evaluationId);
    if (completed) return completed;

    return null;
  }

  getQueuePosition(jobId: string): number {
    const index = this.pending.findIndex(j => j.id === jobId);
    return index === -1 ? -1 : index + 1;
  }

  updateProgress(jobId: string, current: number, total: number, stage: string): void {
    const job = this.running.get(jobId);
    if (job) {
      job.progress = { current, total, stage };
    }
  }

  getStats(): QueueStats {
    const statusCounts = {
      pending: this.pending.length,
      running: this.running.size,
      completed: this.completed.filter(j => j.status === 'completed').length,
      failed: this.completed.filter(j => j.status === 'failed').length,
      cancelled: this.completed.filter(j => j.status === 'cancelled').length,
    };

    return {
      ...statusCounts,
      totalProcessed: this.totalProcessed,
    };
  }

  getAllJobs(): { pending: EvalJob[]; running: EvalJob[]; completed: EvalJob[] } {
    return {
      pending: [...this.pending],
      running: Array.from(this.running.values()),
      completed: [...this.completed],
    };
  }

  getPendingCount(): number {
    return this.pending.length;
  }

  getRunningCount(): number {
    return this.running.size;
  }

  // For persistence
  getSnapshot(): { pending: EvalJob[]; running: EvalJob[]; completed: EvalJob[] } {
    return {
      pending: this.pending.map(j => ({ ...j })),
      running: Array.from(this.running.values()).map(j => ({ ...j })),
      completed: this.completed.map(j => ({ ...j })),
    };
  }

  // For restoration
  restore(snapshot: { pending: EvalJob[]; running: EvalJob[]; completed: EvalJob[] }): void {
    this.pending = snapshot.pending.map(j => ({
      ...j,
      createdAt: new Date(j.createdAt),
      startedAt: j.startedAt ? new Date(j.startedAt) : undefined,
      completedAt: j.completedAt ? new Date(j.completedAt) : undefined,
    }));

    // Running jobs are marked as failed on restore (server restart)
    for (const job of snapshot.running) {
      const failedJob: EvalJob = {
        ...job,
        status: 'failed',
        error: 'server_restart',
        createdAt: new Date(job.createdAt),
        startedAt: job.startedAt ? new Date(job.startedAt) : undefined,
        completedAt: new Date(),
      };
      this.completed.unshift(failedJob);
    }

    this.completed = [
      ...this.completed,
      ...snapshot.completed.map(j => ({
        ...j,
        createdAt: new Date(j.createdAt),
        startedAt: j.startedAt ? new Date(j.startedAt) : undefined,
        completedAt: j.completedAt ? new Date(j.completedAt) : undefined,
      })),
    ].slice(0, QUEUE_CONFIG.persistence.maxCompletedJobs);
  }
}

// Singleton instance
export const taskQueue = new TaskQueue();
