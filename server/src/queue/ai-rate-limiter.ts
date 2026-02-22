// AI API rate limiter using token bucket algorithm
import { QUEUE_CONFIG } from './config';

interface PendingCall {
  resolve: () => void;
  reject: (error: Error) => void;
  priority: number;
  timestamp: number;
}

export class AiRateLimiter {
  private queue: PendingCall[] = [];
  private lastCallTime: number = 0;
  private activeCount: number = 0;
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private lastRefillTime: number;

  constructor() {
    const config = QUEUE_CONFIG.aiRateLimit;
    this.maxTokens = config.requestsPerMinute;
    this.tokens = this.maxTokens;
    this.refillRate = config.requestsPerMinute / 60000; // per ms
    this.lastRefillTime = Date.now();
  }

  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  async acquire(priority: number = 1): Promise<void> {
    this.refillTokens();

    // Check minimum interval
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;
    const minInterval = QUEUE_CONFIG.aiRateLimit.minIntervalMs;

    if (this.tokens >= 1 && timeSinceLastCall >= minInterval && this.activeCount < QUEUE_CONFIG.maxConcurrentAiCalls) {
      this.tokens -= 1;
      this.lastCallTime = now;
      this.activeCount++;
      return;
    }

    // Queue the request
    return new Promise((resolve, reject) => {
      const call: PendingCall = {
        resolve: () => {
          this.activeCount++;
          resolve();
        },
        reject,
        priority,
        timestamp: now,
      };

      // Insert by priority
      const insertIndex = this.queue.findIndex(c => c.priority < priority);
      if (insertIndex === -1) {
        this.queue.push(call);
      } else {
        this.queue.splice(insertIndex, 0, call);
      }

      // Schedule processing
      this.scheduleProcess();
    });
  }

  release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    this.processQueue();
  }

  private scheduleProcess(): void {
    const minInterval = QUEUE_CONFIG.aiRateLimit.minIntervalMs;
    const timeSinceLastCall = Date.now() - this.lastCallTime;
    const delay = Math.max(0, minInterval - timeSinceLastCall);
    setTimeout(() => this.processQueue(), delay);
  }

  private processQueue(): void {
    this.refillTokens();

    while (this.queue.length > 0) {
      const now = Date.now();
      const timeSinceLastCall = now - this.lastCallTime;
      const minInterval = QUEUE_CONFIG.aiRateLimit.minIntervalMs;

      if (this.tokens < 1 || timeSinceLastCall < minInterval || this.activeCount >= QUEUE_CONFIG.maxConcurrentAiCalls) {
        this.scheduleProcess();
        break;
      }

      const call = this.queue.shift()!;
      this.tokens -= 1;
      this.lastCallTime = now;
      call.resolve();
    }
  }

  async callWithRetry<T>(fn: () => Promise<T>, priority: number = 1): Promise<T> {
    const config = QUEUE_CONFIG.aiRateLimit;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < config.retryAttempts; attempt++) {
      try {
        await this.acquire(priority);
        try {
          const result = await fn();
          return result;
        } finally {
          this.release();
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if it's a rate limit error
        const isRateLimit = lastError.message.includes('rate') || 
                           lastError.message.includes('429') ||
                           lastError.message.includes('limit');

        if (!isRateLimit && attempt === config.retryAttempts - 1) {
          throw lastError;
        }

        // Exponential backoff
        const delay = config.retryDelayMs * Math.pow(config.backoffMultiplier, attempt);
        console.log(`[AiRateLimiter] Retry ${attempt + 1}/${config.retryAttempts} after ${delay}ms: ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  getStats(): { activeCount: number; queueLength: number; tokens: number } {
    this.refillTokens();
    return {
      activeCount: this.activeCount,
      queueLength: this.queue.length,
      tokens: Math.floor(this.tokens),
    };
  }
}

// Singleton instance
export const aiRateLimiter = new AiRateLimiter();
