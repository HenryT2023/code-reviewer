/**
 * Gap Extractor
 * Extracts, classifies, and ranks gaps from role evaluation outputs.
 * Sources: recommendations, critical_gaps, low-scoring dimensions, MREP critical claims,
 * Coverage Intelligence high-priority action items.
 */

import type { Gap, GapCategory, GapPriority } from './types';

export interface RoleOutput {
  role: string;
  score: number;
  parsed: Record<string, any>;
}

interface RawGap {
  title: string;
  description: string;
  sourceRole: string;
  priority: number;
  category: GapCategory;
  evidence: string[];
  relatedFiles?: string[];
}

// ─── Category Classification ────────────────────────────────────────────

const DOMAIN_EXPERT_ROLES = ['trade_expert', 'supply_chain_expert'];

const DOMAIN_KEYWORDS = [
  'supply chain', 'procurement', 'warehouse', 'wms', 'inventory', 'delivery',
  'traceability', 'trade', 'logistics', 'cold chain', 'batch', 'fulfillment',
  '供应链', '采购', '仓储', '库存', '配送', '溯源', '贸易', '物流',
  '冷链', '批次', '履约', 'supplier', 'inbound', 'outbound', 'picking',
];

const VALIDATION_KEYWORDS = [
  'pmf', 'hypothesis', 'validate', 'interview', 'user research', 'market',
  'customer', 'retention', 'churn', 'nps', 'conversion', 'pricing model',
  '验证', '假设', '访谈', '用户研究', '市场', '客户', '留存', '付费意愿',
  '变现', '商业模式', '需求验证', 'demand', 'monetiz',
];

const INTEGRATION_KEYWORDS = [
  'payment', 'stripe', 'alipay', 'wechat pay', 'logistics', 'shipping api',
  'health check', 'monitor', 'deploy', 'ci/cd', 'docker', 'ssl', 'cdn',
  '支付', '物流', '监控', '部署', '对接', '集成', 'hardcoded', '硬编码',
  'third-party', 'external api', 'sentry', 'prometheus',
];

function classifyGap(text: string, sourceRole?: string): GapCategory {
  const lower = text.toLowerCase();
  // Domain expert gaps get domain category if role or content matches
  if (sourceRole && DOMAIN_EXPERT_ROLES.includes(sourceRole)) return 'domain';
  if (DOMAIN_KEYWORDS.some(k => lower.includes(k))) return 'domain';
  if (VALIDATION_KEYWORDS.some(k => lower.includes(k))) return 'validation';
  if (INTEGRATION_KEYWORDS.some(k => lower.includes(k))) return 'integration';
  return 'code_fix';
}

// ─── Gap Extraction from Role Outputs ───────────────────────────────────

function extractFromRecommendations(role: string, parsed: Record<string, any>): RawGap[] {
  const gaps: RawGap[] = [];
  const recs: any[] = parsed.recommendations || parsed.priority_actions || [];
  // Domain experts get boosted priority (75) so their recommendations aren't drowned by generic gaps
  const basePriority = DOMAIN_EXPERT_ROLES.includes(role) ? 75 : 50;

  for (const rec of recs) {
    const text = typeof rec === 'string' ? rec : (rec.action || rec.description || rec.title || JSON.stringify(rec));
    gaps.push({
      title: text.substring(0, 80),
      description: text,
      sourceRole: role,
      priority: basePriority,
      category: classifyGap(text, role),
      evidence: [text],
    });
  }
  return gaps;
}

function extractFromCriticalGaps(role: string, parsed: Record<string, any>): RawGap[] {
  const gaps: RawGap[] = [];
  const criticalGaps: string[] = parsed.critical_gaps || [];
  // Domain expert critical gaps get slightly higher priority (85 vs 80)
  const basePriority = DOMAIN_EXPERT_ROLES.includes(role) ? 85 : 80;

  for (const gap of criticalGaps) {
    gaps.push({
      title: gap.substring(0, 80),
      description: gap,
      sourceRole: role,
      priority: basePriority,
      category: classifyGap(gap, role),
      evidence: [gap],
    });
  }
  return gaps;
}

function extractFromLowDimensions(role: string, parsed: Record<string, any>): RawGap[] {
  const gaps: RawGap[] = [];
  const dimensions: Record<string, any> = parsed.dimensions || {};

  for (const [dimName, dim] of Object.entries(dimensions)) {
    if (dim && typeof dim === 'object' && typeof dim.score === 'number' && dim.score < 60) {
      const comment = dim.comment || dim.analysis || '';
      const text = `${dimName}: ${comment}`;
      gaps.push({
        title: `Low score in ${dimName} (${dim.score}/100)`,
        description: text,
        sourceRole: role,
        priority: 90 - dim.score, // lower score = higher priority
        category: classifyGap(text, role),
        evidence: [text],
      });
    }
  }
  return gaps;
}

function extractFromMrepClaims(role: string, parsed: Record<string, any>): RawGap[] {
  const gaps: RawGap[] = [];
  const claims: any[] = parsed.claims || [];

  for (const claim of claims) {
    if (claim.severity === 'critical' || claim.severity === 'major') {
      const text = claim.statement || claim.description || '';
      gaps.push({
        title: text.substring(0, 80),
        description: text,
        sourceRole: role,
        priority: claim.severity === 'critical' ? 90 : 70,
        category: classifyGap(text, role),
        evidence: [`[${claim.type}] ${text}`],
        relatedFiles: claim.file ? [claim.file] : undefined,
      });
    }
  }
  return gaps;
}

function extractFromSkeptic(role: string, parsed: Record<string, any>): RawGap[] {
  const gaps: RawGap[] = [];

  const fatalAssumptions: string[] = parsed.fatal_assumptions || parsed.fatalAssumptions || [];
  for (const fa of fatalAssumptions) {
    gaps.push({
      title: fa.substring(0, 80),
      description: fa,
      sourceRole: role,
      priority: 85,
      category: 'validation',
      evidence: [`[fatal_assumption] ${fa}`],
    });
  }

  const fakeDemand: string[] = parsed.fake_demand_indicators || parsed.fakeDemandIndicators || [];
  for (const fd of fakeDemand) {
    gaps.push({
      title: fd.substring(0, 80),
      description: fd,
      sourceRole: role,
      priority: 80,
      category: 'validation',
      evidence: [`[fake_demand] ${fd}`],
    });
  }

  return gaps;
}

// ─── Deduplication & Ranking ────────────────────────────────────────────

function deduplicateGaps(gaps: RawGap[]): RawGap[] {
  const seen = new Map<string, RawGap>();

  for (const gap of gaps) {
    // Simple dedup by normalized title prefix
    const key = gap.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '').substring(0, 40);

    if (seen.has(key)) {
      const existing = seen.get(key)!;
      existing.priority = Math.max(existing.priority, gap.priority);
      existing.evidence.push(...gap.evidence);
      if (!existing.sourceRole.includes(gap.sourceRole)) {
        existing.sourceRole += `, ${gap.sourceRole}`;
      }
      // Prefer 'domain' category when merging — domain expert classification is more specific
      if (gap.category === 'domain' && existing.category !== 'domain') {
        existing.category = 'domain';
      }
    } else {
      seen.set(key, { ...gap });
    }
  }

  return Array.from(seen.values());
}

function mapPriority(numericPriority: number): GapPriority {
  if (numericPriority >= 80) return 'critical';
  if (numericPriority >= 60) return 'high';
  if (numericPriority >= 40) return 'medium';
  return 'low';
}

// ─── Main Export ────────────────────────────────────────────────────────

export function extractGaps(roleOutputs: RoleOutput[], maxGaps: number = 6): Gap[] {
  const allRawGaps: RawGap[] = [];

  for (const { role, parsed } of roleOutputs) {
    allRawGaps.push(...extractFromRecommendations(role, parsed));
    allRawGaps.push(...extractFromCriticalGaps(role, parsed));
    allRawGaps.push(...extractFromLowDimensions(role, parsed));
    allRawGaps.push(...extractFromMrepClaims(role, parsed));

    if (role === 'skeptic') {
      allRawGaps.push(...extractFromSkeptic(role, parsed));
    }
  }

  // Deduplicate, sort by priority descending
  const deduped = deduplicateGaps(allRawGaps);
  deduped.sort((a, b) => b.priority - a.priority);

  // Ensure at least 1 gap per category if available
  const byCategory: Record<GapCategory, RawGap[]> = { code_fix: [], validation: [], integration: [], domain: [] };
  for (const gap of deduped) {
    byCategory[gap.category].push(gap);
  }

  const selected: RawGap[] = [];
  // Pick top 1 from each category first
  for (const cat of ['code_fix', 'validation', 'integration', 'domain'] as GapCategory[]) {
    if (byCategory[cat].length > 0) {
      selected.push(byCategory[cat].shift()!);
    }
  }
  // Fill remaining slots from overall priority
  const remaining = deduped.filter(g => !selected.includes(g));
  for (const gap of remaining) {
    if (selected.length >= maxGaps) break;
    selected.push(gap);
  }

  // Convert to Gap type
  return selected.map((raw, idx) => ({
    id: `gap-${String(idx + 1).padStart(3, '0')}`,
    title: raw.title,
    description: raw.description,
    category: raw.category,
    priority: mapPriority(raw.priority),
    sourceRoles: raw.sourceRole.split(', '),
    evidence: raw.evidence.slice(0, 5),
    relatedFiles: raw.relatedFiles,
  }));
}
