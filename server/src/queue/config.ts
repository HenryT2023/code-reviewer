// Queue system configuration
// All values support environment variable overrides

export const QUEUE_CONFIG = {
  // Concurrent evaluation control
  maxConcurrent: parseInt(process.env.MAX_CONCURRENT_EVALS || '3'),
  maxConcurrentAiCalls: parseInt(process.env.MAX_CONCURRENT_AI || '5'),

  // Port management for dynamic evaluation
  portBase: parseInt(process.env.EVAL_PORT_BASE || '9100'),
  portRange: parseInt(process.env.EVAL_PORT_RANGE || '100'),

  // Scheduling
  pollInterval: parseInt(process.env.QUEUE_POLL_INTERVAL || '1000'),
  jobTimeout: parseInt(process.env.EVAL_TIMEOUT_MS || '900000'), // 15 minutes for 12 roles
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE || '50'),
  priorityLevels: 3,

  // AI rate limiting
  aiRateLimit: {
    requestsPerMinute: parseInt(process.env.AI_RPM || '60'),
    minIntervalMs: parseInt(process.env.AI_MIN_INTERVAL || '1000'),
    retryAttempts: parseInt(process.env.AI_RETRY_ATTEMPTS || '3'),
    retryDelayMs: parseInt(process.env.AI_RETRY_DELAY || '2000'),
    backoffMultiplier: parseFloat(process.env.AI_BACKOFF_MULTIPLIER || '2'),
  },

  // Role evaluation config
  roleConfig: {
    defaultRoles: ['boss', 'merchant', 'operator', 'architect'],
    maxRolesPerEval: 12,
    parallelRoleEval: false, // Sequential to avoid rate limiting
  },

  // Persistence
  persistence: {
    enabled: true,
    filePath: 'data/queue-state.json',
    autoSaveInterval: parseInt(process.env.QUEUE_SAVE_INTERVAL || '30000'), // 30 seconds
    maxCompletedJobs: 100,
  },
};

export type QueueConfig = typeof QUEUE_CONFIG;
