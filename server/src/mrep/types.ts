// MREP: Machine-Readable Evaluation Protocol
// Structured evaluation artifacts for AI agents to consume, verify, and cross-reference.

export interface MrepClaim {
  id: string;                    // e.g. "C001"
  type: 'observation' | 'risk' | 'recommendation' | 'metric';
  severity: 'critical' | 'major' | 'minor' | 'info';
  confidence: number;            // 0.0 - 1.0
  statement: string;             // The actual claim text
  evidence: MrepEvidence[];
  verifiable: boolean;
  verification_method?: string;  // e.g. "grep_pattern:...", "file_exists:...", "metric_check:..."
  related_claims?: string[];     // IDs of related claims from same role
  tags: string[];
}

export interface MrepEvidence {
  type: 'code_ref' | 'metric_ref' | 'config_ref' | 'doc_ref';
  file?: string;                 // Relative file path
  lines?: [number, number];      // Start and end line numbers
  snippet?: string;              // Code snippet
  metric_key?: string;           // e.g. "metrics.quality.commentRatio"
  metric_value?: number | string;
  description?: string;
}

export interface MrepCrossReference {
  source_role: string;
  source_claim_id: string;
  target_role: string;
  target_claim_id: string;
  relation: 'supports' | 'contradicts' | 'extends' | 'depends_on';
  note?: string;
}

export interface MrepMetricsSnapshot {
  total_claims: number;
  verifiable_claims: number;
  evidence_coverage: number;     // ratio of claims with evidence
  avg_confidence: number;
}

export interface MrepRoleReport {
  mrep_version: '1.0';
  role_id: string;
  evaluation_id: string;
  timestamp: string;
  claims: MrepClaim[];
  metrics_snapshot: MrepMetricsSnapshot;
  cross_references: MrepCrossReference[];
}

// Verification results
export interface ClaimVerificationResult {
  claim_id: string;
  status: 'verified' | 'unverified' | 'failed' | 'skipped';
  method_used: string;
  details: string;
  checked_at: string;
}

export interface MrepVerificationReport {
  evaluation_id: string;
  role_id: string;
  verified_at: string;
  project_path: string;
  results: ClaimVerificationResult[];
  summary: {
    total: number;
    verified: number;
    unverified: number;
    failed: number;
    skipped: number;
    pass_rate: number;           // verified / (total - skipped)
  };
}

// Aggregated MREP stats across evaluations
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

// MREP-enabled roles (only technical roles output MREP claims)
export const MREP_ENABLED_ROLES = ['coder', 'architect', 'fact_checker'] as const;
export type MrepEnabledRole = typeof MREP_ENABLED_ROLES[number];

export function isMrepEnabledRole(roleId: string): boolean {
  return (MREP_ENABLED_ROLES as readonly string[]).includes(roleId);
}
