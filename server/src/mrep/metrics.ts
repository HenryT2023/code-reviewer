// MREP Metrics: Compute aggregate statistics across evaluations
import type { MrepRoleReport, MrepVerificationReport, MrepAggregateStats } from './types';

/**
 * Compute aggregate MREP stats from multiple reports and verification results.
 */
export function computeAggregateStats(
  reports: Array<{ evaluationId: string; timestamp: string; roleReports: MrepRoleReport[] }>,
  verifications: Map<string, MrepVerificationReport[]> // evaluationId -> verification reports
): MrepAggregateStats {
  const byRole: Record<string, { claims: number; evidenceCoverages: number[]; passRates: number[] }> = {};
  const trend: MrepAggregateStats['trend'] = [];

  let totalClaims = 0;
  const allEvidenceCoverages: number[] = [];
  const allPassRates: number[] = [];
  const allConfidences: number[] = [];

  for (const entry of reports) {
    let evalClaims = 0;
    let evalCoverage = 0;
    let evalPassRate = 0;
    let roleCount = 0;

    for (const rr of entry.roleReports) {
      totalClaims += rr.metrics_snapshot.total_claims;
      evalClaims += rr.metrics_snapshot.total_claims;
      allConfidences.push(rr.metrics_snapshot.avg_confidence);

      // Per-role stats
      if (!byRole[rr.role_id]) {
        byRole[rr.role_id] = { claims: 0, evidenceCoverages: [], passRates: [] };
      }
      byRole[rr.role_id].claims += rr.metrics_snapshot.total_claims;
      byRole[rr.role_id].evidenceCoverages.push(rr.metrics_snapshot.evidence_coverage);

      evalCoverage += rr.metrics_snapshot.evidence_coverage;
      roleCount++;
    }

    // Verification stats for this evaluation
    const evalVerifications = verifications.get(entry.evaluationId) || [];
    for (const vr of evalVerifications) {
      const passRate = vr.summary.pass_rate;
      allPassRates.push(passRate);
      evalPassRate += passRate;

      if (byRole[vr.role_id]) {
        byRole[vr.role_id].passRates.push(passRate);
      }
    }

    const avgCoverage = roleCount > 0 ? evalCoverage / roleCount : 0;
    const avgPassRate = evalVerifications.length > 0 ? evalPassRate / evalVerifications.length : 0;
    allEvidenceCoverages.push(avgCoverage);

    trend.push({
      evaluation_id: entry.evaluationId,
      timestamp: entry.timestamp,
      evidence_coverage: Math.round(avgCoverage * 100) / 100,
      verification_pass_rate: Math.round(avgPassRate * 100) / 100,
    });
  }

  // Build per-role summary
  const byRoleSummary: MrepAggregateStats['by_role'] = {};
  for (const [roleId, data] of Object.entries(byRole)) {
    byRoleSummary[roleId] = {
      total_claims: data.claims,
      avg_evidence_coverage: avg(data.evidenceCoverages),
      avg_verification_pass_rate: avg(data.passRates),
    };
  }

  return {
    total_evaluations: reports.length,
    total_claims: totalClaims,
    avg_evidence_coverage: avg(allEvidenceCoverages),
    avg_verification_pass_rate: avg(allPassRates),
    avg_confidence: avg(allConfidences),
    by_role: byRoleSummary,
    trend: trend.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}
