// MREP module exports
export type {
  MrepClaim,
  MrepEvidence,
  MrepCrossReference,
  MrepMetricsSnapshot,
  MrepRoleReport,
  ClaimVerificationResult,
  MrepVerificationReport,
  MrepAggregateStats,
  MrepEnabledRole,
} from './types';

export { MREP_ENABLED_ROLES, isMrepEnabledRole } from './types';
export { extractMrepFromRoleOutput } from './parser';
export { verifyMrepReport } from './evidence-verifier';
export { computeAggregateStats } from './metrics';
