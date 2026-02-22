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

export interface ProjectSummary {
  projectPath: string;
  projectName: string;
  evaluationCount: number;
  latestAt: string;
}

export const evaluationApi = {
  startEvaluation: (data: Record<string, unknown>) => api.post<{ id: string }>('/evaluate', data),
  getEvaluation: (id: string) => api.get<EvaluationRecord>(`/evaluate/${id}`),
  listHistory: (limit?: number, projectPath?: string) =>
    api.get<EvaluationRecord[]>('/history', {
      params: { limit, ...(projectPath ? { project: encodeURIComponent(projectPath) } : {}) },
    }),
  listProjects: () => api.get<ProjectSummary[]>('/history/projects'),
  getHistoryDetail: (id: string) => api.get<EvaluationRecord>(`/history/${id}`),
  deleteEvaluation: (id: string) => api.delete(`/history/${id}`),
};

// Evolution API types
export interface ReflectionRecord {
  id: string;
  evaluationId: string;
  projectPath: string;
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
  projectPath: string;
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
  projectPath: string | null;
  mrep: any;
}

function projectParam(projectPath?: string): Record<string, string> {
  return projectPath ? { project: encodeURIComponent(projectPath) } : {};
}

export const evolutionApi = {
  listReflections: (projectPath?: string) =>
    api.get<{ count: number; total: number; projectPath: string | null; reflections: ReflectionRecord[] }>(
      '/evolution/reflections', { params: projectParam(projectPath) }),
  getReflection: (evaluationId: string) => api.get<ReflectionRecord>(`/evolution/reflections/${evaluationId}`),
  triggerSynthesis: (projectPath?: string) =>
    api.post<SynthesisRecord>('/evolution/synthesize', null, { params: projectParam(projectPath) }),
  getLatestSynthesis: (projectPath?: string) =>
    api.get<SynthesisRecord>('/evolution/latest-synthesis', { params: projectParam(projectPath) }),
  listSyntheses: (projectPath?: string) =>
    api.get<{ count: number; projectPath: string | null; syntheses: SynthesisRecord[] }>(
      '/evolution/syntheses', { params: projectParam(projectPath) }),
  applySynthesis: (synthesisId: string) => api.post(`/evolution/apply/${synthesisId}`),
  getStats: (projectPath?: string) =>
    api.get<EvolutionStats>('/evolution/stats', { params: projectParam(projectPath) }),
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

// MREP API types
export interface MrepClaim {
  id: string;
  type: 'observation' | 'risk' | 'recommendation' | 'metric';
  severity: 'critical' | 'major' | 'minor' | 'info';
  confidence: number;
  statement: string;
  evidence: Array<{
    type: string;
    file?: string;
    lines?: [number, number];
    snippet?: string;
    description?: string;
  }>;
  verifiable: boolean;
  verification_method?: string;
  tags: string[];
}

export interface MrepRoleReport {
  mrep_version: string;
  role_id: string;
  evaluation_id: string;
  timestamp: string;
  claims: MrepClaim[];
  metrics_snapshot: {
    total_claims: number;
    verifiable_claims: number;
    evidence_coverage: number;
    avg_confidence: number;
  };
}

export interface MrepVerificationResult {
  claim_id: string;
  status: 'verified' | 'unverified' | 'failed' | 'skipped';
  method_used: string;
  details: string;
}

export interface MrepVerificationReport {
  evaluation_id: string;
  role_id: string;
  results: MrepVerificationResult[];
  summary: {
    total: number;
    verified: number;
    unverified: number;
    failed: number;
    skipped: number;
    pass_rate: number;
  };
}

export interface MrepEvaluationData {
  evaluation_id: string;
  reports: MrepRoleReport[];
  verifications: MrepVerificationReport[];
  summary: {
    total_roles: number;
    total_claims: number;
    avg_evidence_coverage: number;
    avg_confidence: number;
    verification_pass_rate: number | null;
  };
}

export interface MrepAggregateStats {
  total_evaluations: number;
  total_claims: number;
  avg_evidence_coverage: number;
  avg_verification_pass_rate: number;
  avg_confidence: number;
  by_role: Record<string, {
    total_claims: number;
    avg_evidence_coverage: number;
    avg_verification_pass_rate: number;
  }>;
  trend: Array<{
    evaluation_id: string;
    timestamp: string;
    evidence_coverage: number;
    verification_pass_rate: number;
  }>;
}

export const mrepApi = {
  getByEvaluation: (evaluationId: string) =>
    api.get<MrepEvaluationData>(`/mrep/${evaluationId}`),
  verify: (evaluationId: string) =>
    api.post<{ evaluation_id: string; verifications: MrepVerificationReport[]; summary: any }>(`/mrep/${evaluationId}/verify`),
  getAggregateStats: () =>
    api.get<MrepAggregateStats>('/mrep/stats/aggregate'),
};

// Judge API types
export interface GroundedJudgment {
  id: string;
  evaluationId: string;
  projectPath: string;
  referenceId: string;
  overallScore: number;
  dimensions: {
    coverage: { score: number; covered: string[]; missed: string[] };
    accuracy: { score: number; passRate: number };
    calibration: { score: number; details: string };
    specificity: { score: number; ratio: number };
  };
  roleScores: Record<string, number>;
  timestamp: string;
}

export interface JudgeStats {
  count: number;
  averageScore: number | null;
  averageDimensions: {
    coverage: number;
    accuracy: number;
    calibration: number;
    specificity: number;
  } | null;
  trend: Array<{ evaluationId: string; overallScore: number; timestamp: string }>;
  projectPath: string | null;
}

export const judgeApi = {
  getJudgment: (evaluationId: string) =>
    api.get<{ judgment: GroundedJudgment; reference: any }>(`/judge/${evaluationId}`),
  getStats: (projectPath?: string) =>
    api.get<JudgeStats>('/judge/stats', { params: projectParam(projectPath) }),
  rerunJudgment: (evaluationId: string) =>
    api.post<{ success: boolean; judgment: GroundedJudgment; summary: string }>(`/judge/${evaluationId}/rerun`),
};

// A/B Test API types
export interface ABTestRecord {
  id: string;
  projectPath: string;
  synthesisId: string;
  evaluationA: string;
  evaluationB: string;
  status: 'running_a' | 'running_b' | 'judging' | 'decided';
  result?: {
    judgeScoreA: number;
    judgeScoreB: number;
    judgeDelta: number;
    decision: 'apply' | 'discard' | 'inconclusive';
    reason: string;
  };
  createdAt: string;
  updatedAt: string;
}

export const abTestApi = {
  trigger: (data: {
    synthesisId: string;
    projectPath: string;
    projectName: string;
    roles: string[];
    context?: string;
    depth?: string;
  }) => api.post<{ testId: string; evaluationA: string; evaluationB: string; status: string }>('/ab-test/trigger', data),
  getTest: (id: string) => api.get<ABTestRecord & { evaluations: any; judgments: any }>(`/ab-test/${id}`),
  listTests: (projectPath?: string) =>
    api.get<{ count: number; projectPath: string | null; tests: ABTestRecord[] }>(
      '/ab-test', { params: projectParam(projectPath) }),
  applyTest: (id: string) => api.post<{ success: boolean; overrides: any }>(`/ab-test/${id}/apply`),
};

export default api;
