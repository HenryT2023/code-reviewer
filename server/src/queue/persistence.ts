// Queue state persistence
import * as fs from 'fs';
import * as path from 'path';
import { QUEUE_CONFIG } from './config';
import { taskQueue, EvalJob } from './task-queue';

interface QueueSnapshot {
  timestamp: string;
  pending: EvalJob[];
  running: EvalJob[];
  completed: EvalJob[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const QUEUE_FILE = path.join(DATA_DIR, QUEUE_CONFIG.persistence.filePath.replace('data/', ''));

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function saveQueueState(): void {
  if (!QUEUE_CONFIG.persistence.enabled) return;

  try {
    ensureDataDir();
    const snapshot = taskQueue.getSnapshot();
    const data: QueueSnapshot = {
      timestamp: new Date().toISOString(),
      ...snapshot,
    };
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[QueuePersistence] Failed to save queue state:', error);
  }
}

export function loadQueueState(): boolean {
  if (!QUEUE_CONFIG.persistence.enabled) return false;

  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      return false;
    }

    const content = fs.readFileSync(QUEUE_FILE, 'utf-8');
    const snapshot: QueueSnapshot = JSON.parse(content);

    console.log(`[QueuePersistence] Restoring queue state from ${snapshot.timestamp}`);
    console.log(`[QueuePersistence] Pending: ${snapshot.pending.length}, Running: ${snapshot.running.length}, Completed: ${snapshot.completed.length}`);

    taskQueue.restore(snapshot);

    // Log any jobs that were running (now marked as failed)
    if (snapshot.running.length > 0) {
      console.warn(`[QueuePersistence] ${snapshot.running.length} running jobs marked as failed due to server restart`);
    }

    return true;
  } catch (error) {
    console.error('[QueuePersistence] Failed to load queue state:', error);
    return false;
  }
}

let autoSaveInterval: NodeJS.Timeout | null = null;

export function startAutoSave(): void {
  if (!QUEUE_CONFIG.persistence.enabled) return;
  if (autoSaveInterval) return;

  autoSaveInterval = setInterval(() => {
    saveQueueState();
  }, QUEUE_CONFIG.persistence.autoSaveInterval);

  console.log(`[QueuePersistence] Auto-save enabled (every ${QUEUE_CONFIG.persistence.autoSaveInterval / 1000}s)`);
}

export function stopAutoSave(): void {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }
}

// Save on process exit
process.on('beforeExit', () => {
  saveQueueState();
});

process.on('SIGINT', () => {
  saveQueueState();
  process.exit(0);
});

process.on('SIGTERM', () => {
  saveQueueState();
  process.exit(0);
});
