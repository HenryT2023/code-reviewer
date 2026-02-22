// MREP Parser: Extract and validate MREP claims from role output JSON
import type { MrepClaim, MrepRoleReport, MrepMetricsSnapshot, MrepCrossReference } from './types';

/**
 * Extract MREP claims from a parsed role output.
 * The role output JSON may contain a `claims` array at the top level.
 * Returns null if no MREP data found (e.g. non-MREP-enabled roles).
 */
export function extractMrepFromRoleOutput(
  roleId: string,
  evaluationId: string,
  parsed: Record<string, unknown>
): MrepRoleReport | null {
  const rawClaims = parsed.claims;
  if (!Array.isArray(rawClaims) || rawClaims.length === 0) {
    return null;
  }

  const claims = rawClaims
    .map((raw, index) => normalizeClaim(raw, roleId, index))
    .filter((c): c is MrepClaim => c !== null);

  if (claims.length === 0) {
    return null;
  }

  const crossRefs = extractCrossReferences(parsed, roleId);
  const metrics = computeMetricsSnapshot(claims);

  return {
    mrep_version: '1.0',
    role_id: roleId,
    evaluation_id: evaluationId,
    timestamp: new Date().toISOString(),
    claims,
    metrics_snapshot: metrics,
    cross_references: crossRefs,
  };
}

/**
 * Normalize a raw claim object into a valid MrepClaim.
 * Fills in defaults for missing fields, assigns ID if missing.
 */
function normalizeClaim(
  raw: unknown,
  roleId: string,
  index: number
): MrepClaim | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === 'string' ? obj.id : `${roleId.toUpperCase()}-C${String(index + 1).padStart(3, '0')}`;
  const statement = typeof obj.statement === 'string' ? obj.statement : '';
  if (!statement) return null;

  const validTypes = ['observation', 'risk', 'recommendation', 'metric'] as const;
  const type = validTypes.includes(obj.type as any) ? (obj.type as MrepClaim['type']) : 'observation';

  const validSeverities = ['critical', 'major', 'minor', 'info'] as const;
  const severity = validSeverities.includes(obj.severity as any)
    ? (obj.severity as MrepClaim['severity'])
    : 'info';

  const confidence = typeof obj.confidence === 'number'
    ? Math.max(0, Math.min(1, obj.confidence))
    : 0.5;

  const evidence = Array.isArray(obj.evidence)
    ? obj.evidence.map(normalizeEvidence).filter(Boolean) as MrepClaim['evidence']
    : [];

  const verifiable = typeof obj.verifiable === 'boolean' ? obj.verifiable : evidence.length > 0;
  const verification_method = typeof obj.verification_method === 'string' ? obj.verification_method : undefined;
  const related_claims = Array.isArray(obj.related_claims) ? obj.related_claims.filter(r => typeof r === 'string') : undefined;
  const tags = Array.isArray(obj.tags) ? obj.tags.filter(t => typeof t === 'string') : [];

  return {
    id,
    type,
    severity,
    confidence,
    statement,
    evidence,
    verifiable,
    verification_method,
    related_claims,
    tags,
  };
}

function normalizeEvidence(raw: unknown): MrepClaim['evidence'][0] | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const validTypes = ['code_ref', 'metric_ref', 'config_ref', 'doc_ref'] as const;
  const type = validTypes.includes(obj.type as any) ? (obj.type as any) : 'code_ref';

  return {
    type,
    file: typeof obj.file === 'string' ? obj.file : undefined,
    lines: Array.isArray(obj.lines) && obj.lines.length === 2 ? obj.lines as [number, number] : undefined,
    snippet: typeof obj.snippet === 'string' ? obj.snippet : undefined,
    metric_key: typeof obj.metric_key === 'string' ? obj.metric_key : undefined,
    metric_value: (typeof obj.metric_value === 'number' || typeof obj.metric_value === 'string') ? obj.metric_value : undefined,
    description: typeof obj.description === 'string' ? obj.description : undefined,
  };
}

function extractCrossReferences(
  parsed: Record<string, unknown>,
  roleId: string
): MrepCrossReference[] {
  const rawRefs = parsed.cross_references;
  if (!Array.isArray(rawRefs)) return [];

  return rawRefs
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
    .map(r => ({
      source_role: roleId,
      source_claim_id: typeof r.source_claim_id === 'string' ? r.source_claim_id : '',
      target_role: typeof r.target_role === 'string' ? r.target_role : '',
      target_claim_id: typeof r.target_claim_id === 'string' ? r.target_claim_id : '',
      relation: (['supports', 'contradicts', 'extends', 'depends_on'] as const).includes(r.relation as any)
        ? (r.relation as MrepCrossReference['relation'])
        : 'supports',
      note: typeof r.note === 'string' ? r.note : undefined,
    }))
    .filter(r => r.target_role && r.target_claim_id);
}

function computeMetricsSnapshot(claims: MrepClaim[]): MrepMetricsSnapshot {
  const total = claims.length;
  const verifiable = claims.filter(c => c.verifiable).length;
  const withEvidence = claims.filter(c => c.evidence.length > 0).length;
  const avgConfidence = total > 0
    ? claims.reduce((sum, c) => sum + c.confidence, 0) / total
    : 0;

  return {
    total_claims: total,
    verifiable_claims: verifiable,
    evidence_coverage: total > 0 ? Math.round((withEvidence / total) * 100) / 100 : 0,
    avg_confidence: Math.round(avgConfidence * 100) / 100,
  };
}
