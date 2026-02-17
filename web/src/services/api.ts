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
  analysisData: any;
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

export default api;
