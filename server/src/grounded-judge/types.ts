// Grounded Judge: types for the search-grounded evaluation quality assessor

export type ChecklistCategory = 'security' | 'architecture' | 'quality' | 'performance' | 'ops';
export type ChecklistSeverity = 'critical' | 'important' | 'nice-to-have';

export interface ChecklistItem {
  category: ChecklistCategory;
  item: string;
  severity: ChecklistSeverity;
  source: string;
}

export interface ReviewReference {
  id: string;
  projectPath: string;
  techStack: string[];
  generatedAt: string;
  cachedUntil: string;
  staticChecklist: ChecklistItem[];
  aiChecklist: ChecklistItem[];
}

export interface JudgeDimensions {
  coverage: {
    score: number;
    covered: string[];
    missed: string[];
  };
  accuracy: {
    score: number;
    passRate: number;
  };
  calibration: {
    score: number;
    details: string;
  };
  specificity: {
    score: number;
    ratio: number;
  };
}

export interface GroundedJudgment {
  id: string;
  evaluationId: string;
  projectPath: string;
  referenceId: string;
  overallScore: number;
  dimensions: JudgeDimensions;
  roleScores: Record<string, number>;
  timestamp: string;
}

// Weights for dimension aggregation
export const DIMENSION_WEIGHTS = {
  coverage: 0.40,
  accuracy: 0.25,
  calibration: 0.20,
  specificity: 0.15,
} as const;

export interface JudgeData {
  references: ReviewReference[];
  judgments: GroundedJudgment[];
}
