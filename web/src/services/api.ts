import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 300000, // 5 min for deep evaluations
});

export interface EvaluationRequest {
  projectPath: string;
  projectName: string;
  roles: string[];
  context: string;
  depth: string;
  mode?: string;
  evaluationType?: 'static' | 'dynamic' | 'ui' | 'full';
  launchContext?: {
    launchWindow?: string;
    channels?: string[];
    constraints?: string;
    pricingExpectation?: string;
  };
  rolePrompts?: Record<string, string>;
}

export interface EvaluationRecord {
  id: string;
  projectName: string;
  projectPath: string;
  context: string;
  overallScore: number | null;
  status: string;
  evaluationType?: 'static' | 'dynamic' | 'ui' | 'full';
  analysisData: any;
  runtimeStages?: Array<{
    stage: string;
    status: string;
    duration_ms: number;
    score?: number;
    errors?: string[];
    details?: Record<string, unknown>;
  }>;
  createdAt: string;
  completedAt: string | null;
  roleEvaluations?: RoleEvaluation[];
}

export interface RoleEvaluation {
  id: string;
  evaluationId: string;
  role: string;
  score: number | null;
  summary: string | null;
  details: any;
  createdAt: string;
}

export const evaluationApi = {
  startEvaluation: (data: Record<string, unknown>) => api.post<{ id: string }>('/evaluate', data),
  getEvaluation: (id: string) => api.get<EvaluationRecord>(`/evaluate/${id}`),
  listHistory: (limit?: number) => api.get<EvaluationRecord[]>('/history', { params: { limit } }),
  getHistoryDetail: (id: string) => api.get<EvaluationRecord>(`/history/${id}`),
  deleteEvaluation: (id: string) => api.delete(`/history/${id}`),
};

// Evolution API types
export interface ReflectionRecord {
  id: string;
  evaluationId: string;
  timestamp: string;
  roleAssessments: Array<{
    role: string;
    qualityScore: number;
    strengths: string[];
    weaknesses: string[];
    promptSuggestions: string[];
    redundancyWith: string[];
  }>;
  blindSpots: string[];
  newRoleProposals: Array<{
    id: string;
    label: string;
    emoji: string;
    rationale: string;
    draftPromptSketch: string;
  }>;
  metaObservations: string;
}

export interface SynthesisRecord {
  id: string;
  version: string;
  generatedAt: string;
  promptDiffs: Array<{
    role: string;
    suggestedAdditions: string[];
    suggestedRemovals: string[];
    rewrittenPrompt: string;
    confidence: number;
    evidenceCount: number;
  }>;
  newRoles: Array<{
    id: string;
    label: string;
    emoji: string;
    category: string;
    standardPrompt: string;
    launchReadyPrompt: string;
    proposalCount: number;
    confidence: number;
  }>;
  retireCandidates: Array<{
    role: string;
    reason: string;
  }>;
  appliedAt?: string;
}

export interface EvolutionStats {
  reflectionCount: number;
  synthesisCount: number;
  averageRoleQuality: Record<string, number>;
  topBlindSpots: Array<{ spot: string; count: number }>;
  topNewRoleProposals: Array<{ id: string; count: number }>;
  needsSynthesis: boolean;
}

export const evolutionApi = {
  listReflections: () => api.get<{ count: number; total: number; reflections: ReflectionRecord[] }>('/evolution/reflections'),
  getReflection: (evaluationId: string) => api.get<ReflectionRecord>(`/evolution/reflections/${evaluationId}`),
  triggerSynthesis: () => api.post<SynthesisRecord>('/evolution/synthesize'),
  getLatestSynthesis: () => api.get<SynthesisRecord>('/evolution/latest-synthesis'),
  listSyntheses: () => api.get<{ count: number; syntheses: SynthesisRecord[] }>('/evolution/syntheses'),
  applySynthesis: (synthesisId: string) => api.post(`/evolution/apply/${synthesisId}`),
  getStats: () => api.get<EvolutionStats>('/evolution/stats'),
};

// Queue API types
export interface QueueJob {
  id: string;
  evaluationId: string;
  projectName: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  workerId?: number;
  queuePosition?: number;
  progress?: {
    current: number;
    total: number;
    stage: string;
  };
  error?: string;
}

export interface QueueStatus {
  stats: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    totalProcessed: number;
  };
  workers: {
    workers: Array<{
      id: number;
      busy: boolean;
      currentJobId?: string;
      currentEvaluationId?: string;
    }>;
    available: number;
    busy: number;
  };
}

export const queueApi = {
  getStatus: () => api.get<QueueStatus>('/queue/status'),
  getJobs: () => api.get<{ pending: QueueJob[]; running: QueueJob[]; completed: QueueJob[] }>('/queue/jobs'),
  getJobByEvaluationId: (evaluationId: string) => api.get<QueueJob>(`/queue/job/${evaluationId}`),
  cancelJob: (evaluationId: string) => api.delete(`/queue/job/${evaluationId}`),
};

export default api;
