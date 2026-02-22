// Worker pool for managing concurrent evaluation workers
import { QUEUE_CONFIG } from './config';

export interface Worker {
  id: number;
  busy: boolean;
  currentJobId?: string;
  currentEvaluationId?: string;
  portStart: number;
  portEnd: number;
  startedAt?: Date;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private portBase: number;
  private portRange: number;

  constructor(size: number = QUEUE_CONFIG.maxConcurrent) {
    this.portBase = QUEUE_CONFIG.portBase;
    this.portRange = QUEUE_CONFIG.portRange;

    for (let i = 0; i < size; i++) {
      this.workers.push({
        id: i,
        busy: false,
        portStart: this.portBase + i * this.portRange,
        portEnd: this.portBase + (i + 1) * this.portRange - 1,
      });
    }
  }

  acquire(): Worker | null {
    const available = this.workers.find(w => !w.busy);
    if (!available) return null;

    available.busy = true;
    available.startedAt = new Date();
    return available;
  }

  release(workerId: number): void {
    const worker = this.workers.find(w => w.id === workerId);
    if (worker) {
      worker.busy = false;
      worker.currentJobId = undefined;
      worker.currentEvaluationId = undefined;
      worker.startedAt = undefined;
    }
  }

  assignJob(workerId: number, jobId: string, evaluationId: string): void {
    const worker = this.workers.find(w => w.id === workerId);
    if (worker) {
      worker.currentJobId = jobId;
      worker.currentEvaluationId = evaluationId;
    }
  }

  getWorker(workerId: number): Worker | undefined {
    return this.workers.find(w => w.id === workerId);
  }

  getWorkerByJobId(jobId: string): Worker | undefined {
    return this.workers.find(w => w.currentJobId === jobId);
  }

  getWorkerByEvaluationId(evaluationId: string): Worker | undefined {
    return this.workers.find(w => w.currentEvaluationId === evaluationId);
  }

  getAvailablePort(workerId: number): number {
    const worker = this.workers.find(w => w.id === workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }
    // Return the start port for this worker's range
    return worker.portStart;
  }

  getAvailableCount(): number {
    return this.workers.filter(w => !w.busy).length;
  }

  getBusyCount(): number {
    return this.workers.filter(w => w.busy).length;
  }

  getStatus(): { workers: Worker[]; available: number; busy: number } {
    return {
      workers: this.workers.map(w => ({ ...w })),
      available: this.getAvailableCount(),
      busy: this.getBusyCount(),
    };
  }

  // Check for stuck workers (running longer than timeout)
  getStuckWorkers(timeoutMs: number = QUEUE_CONFIG.jobTimeout): Worker[] {
    const now = Date.now();
    return this.workers.filter(w => {
      if (!w.busy || !w.startedAt) return false;
      return now - w.startedAt.getTime() > timeoutMs;
    });
  }

  forceRelease(workerId: number): void {
    const worker = this.workers.find(w => w.id === workerId);
    if (worker) {
      console.warn(`[WorkerPool] Force releasing stuck worker ${workerId}`);
      this.release(workerId);
    }
  }
}

// Singleton instance
export const workerPool = new WorkerPool();
