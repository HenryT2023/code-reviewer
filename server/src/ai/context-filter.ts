// Per-role analysis context filter.
//
// P1-2 deliverable from CLAUDE.md. The full project analysis is a long
// markdown document with ~15 sections (overview, language breakdown, API
// endpoints, database, metrics, quality, test coverage, deep spec summaries,
// code samples, etc.). Today every role gets the whole thing — Boss reads
// database entities, Artist reads API endpoints, Growth reads code samples —
// and most of it is wasted context tokens.
//
// This module takes the full analysis string and returns a role-specific
// slice. It's intentionally section-aware but not semantic: we split the
// markdown by `## ` headers, classify each section with a tag set, and pick
// which tags a role cares about. No role-specific prose rewriting, no
// LLM-based filtering. Simple, deterministic, cheap.
//
// Safety: any role not listed in ROLE_TAG_SETS gets the full analysis back
// (no surprise pruning). When in doubt, we'd rather over-include than
// silently hide information from a role that needs it.

// ─── Section tags ───────────────────────────────────────────────────

/**
 * Every analysis section is classified with at least one tag. A role's tag
 * set determines which sections it sees.
 *
 * Tag conventions:
 *   - `core`:      overview, sub-services, tech stack. Everyone needs these.
 *   - `api`:       API endpoint breakdown.
 *   - `database`:  ORM, entities, relations, migrations.
 *   - `metrics`:   file counts, complexity, largest files.
 *   - `engineering`: CI/CD, linters, formatters, Docker, Python quality.
 *   - `testing`:   test coverage analysis section.
 *   - `docs`:      project docs inventory, doc completeness.
 *   - `architecture`: architecture patterns, cross-service deps (deep mode).
 *   - `specs`:     spec summaries (deep mode).
 *   - `samples`:   code samples (deep mode).
 */
export type SectionTag =
  | 'core'
  | 'api'
  | 'database'
  | 'metrics'
  | 'engineering'
  | 'testing'
  | 'docs'
  | 'architecture'
  | 'specs'
  | 'samples';

/**
 * Map a section title (the text after the `## `) to its tag(s). Matching is
 * a substring check so slight heading variations still classify correctly.
 *
 * Order matters: the first entry whose key matches wins. The last entry is
 * a wildcard that tags unknown sections as `core` so nothing accidentally
 * disappears on a role whose tag set excludes an unclassified section.
 */
const SECTION_TAG_RULES: Array<{ match: string; tags: SectionTag[] }> = [
  { match: '项目概览', tags: ['core'] },
  { match: '子服务', tags: ['core'] },
  { match: '语言分布', tags: ['core'] },
  { match: '技术栈', tags: ['core'] },
  { match: '后端模块', tags: ['core', 'api'] },
  { match: 'API 端点', tags: ['api'] },
  { match: '数据库', tags: ['database'] },
  { match: '代码质量指标', tags: ['metrics'] },
  { match: '最大文件', tags: ['metrics'] },
  { match: '工程化配置', tags: ['engineering'] },
  { match: '项目文档', tags: ['docs'] },
  { match: '测试覆盖分析', tags: ['testing'] },
  { match: 'Python 工程化', tags: ['engineering'] },
  { match: '文档完整性', tags: ['docs'] },
  { match: '架构模式', tags: ['architecture'] },
  { match: '服务间依赖', tags: ['architecture'] },
  { match: 'Spec 摘要', tags: ['specs'] },
  { match: '代码样本', tags: ['samples'] },
];

function tagsForSection(heading: string): SectionTag[] {
  for (const rule of SECTION_TAG_RULES) {
    if (heading.includes(rule.match)) return rule.tags;
  }
  // Unknown section → treat as core so filters don't accidentally drop it.
  return ['core'];
}

// ─── Role tag sets ──────────────────────────────────────────────────

/**
 * What sections each role cares about. Unlisted roles get the full analysis.
 *
 * Principles behind the choices:
 *   - Technical roles (architect, coder, security, trade_expert,
 *     supply_chain_expert) read almost everything.
 *   - Product/growth roles (boss, merchant, growth, pricing, user_interview,
 *     skeptic) read the high-level sections but don't need code samples or
 *     low-level metrics.
 *   - Artist / UserInterview care about the product surface, not internals.
 *   - Data focuses on data model and metrics.
 *   - FactChecker sees everything — that's its job.
 *   - Delivery cares about engineering + testing + docs (shipping discipline).
 */
const ROLE_TAG_SETS: Record<string, Set<SectionTag>> = {
  // Technical — read almost everything including deep context.
  architect: new Set([
    'core',
    'api',
    'database',
    'metrics',
    'engineering',
    'testing',
    'docs',
    'architecture',
    'specs',
    'samples',
  ]),
  coder: new Set([
    'core',
    'api',
    'database',
    'metrics',
    'engineering',
    'testing',
    'samples',
  ]),
  security: new Set([
    'core',
    'api',
    'database',
    'engineering',
    'testing',
    'samples',
  ]),

  // Domain experts — need data model, API contracts, specs.
  trade_expert: new Set([
    'core',
    'api',
    'database',
    'architecture',
    'specs',
    'docs',
  ]),
  supply_chain_expert: new Set([
    'core',
    'api',
    'database',
    'architecture',
    'specs',
    'docs',
  ]),

  // Data focus.
  data: new Set(['core', 'database', 'metrics', 'testing', 'architecture']),

  // Delivery — shipping discipline.
  delivery: new Set(['core', 'engineering', 'testing', 'docs']),

  // Product / market — high-level only.
  boss: new Set(['core', 'docs']),
  merchant: new Set(['core', 'docs']),
  growth: new Set(['core', 'docs']),
  pricing: new Set(['core', 'docs']),
  operator: new Set(['core', 'engineering', 'docs']),

  // Research-style roles.
  user_interview: new Set(['core', 'docs', 'specs']),
  artist: new Set(['core', 'docs']),

  // Skeptic — needs enough context to doubt, not drown in detail.
  skeptic: new Set(['core', 'architecture', 'metrics', 'docs']),

  // FactChecker sees everything to cross-check other roles.
  fact_checker: new Set([
    'core',
    'api',
    'database',
    'metrics',
    'engineering',
    'testing',
    'docs',
    'architecture',
    'specs',
    'samples',
  ]),
};

// ─── Section-splitting ──────────────────────────────────────────────

interface Section {
  heading: string;
  /** The full block including the heading line, up to (but not including) the next heading. */
  block: string;
  tags: SectionTag[];
}

/**
 * Split a markdown document on `## ` headers. Content before the first `## `
 * heading (project title, etc.) is kept as a "preamble" that always survives
 * filtering.
 */
export function splitAnalysisSections(analysis: string): {
  preamble: string;
  sections: Section[];
} {
  const lines = analysis.split('\n');
  const preambleLines: string[] = [];
  const sections: Section[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    // Section headings are `## <title>`. `### ` and deeper are NOT treated
    // as section boundaries — they live inside their parent `## ` section.
    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      if (current) {
        const heading = current.heading;
        sections.push({
          heading,
          block: current.lines.join('\n'),
          tags: tagsForSection(heading),
        });
      }
      current = { heading: line.replace(/^##\s+/, '').trim(), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current) {
    sections.push({
      heading: current.heading,
      block: current.lines.join('\n'),
      tags: tagsForSection(current.heading),
    });
  }
  return {
    preamble: preambleLines.join('\n'),
    sections,
  };
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Filter the full analysis string down to the sections relevant for `role`.
 *
 * For unknown roles (not in ROLE_TAG_SETS) this returns the original input
 * unchanged — we'd rather over-include than silently hide data from a role
 * that hasn't been classified yet.
 */
export function filterAnalysisForRole(role: string, analysis: string): string {
  const tagSet = ROLE_TAG_SETS[role];
  if (!tagSet) return analysis;

  const { preamble, sections } = splitAnalysisSections(analysis);
  const kept = sections.filter(s => s.tags.some(t => tagSet.has(t)));

  const parts: string[] = [];
  if (preamble.trim().length > 0) parts.push(preamble);
  for (const s of kept) parts.push(s.block);
  return parts.join('\n');
}

/** Exposed for tests. */
export const __test = {
  tagsForSection,
  ROLE_TAG_SETS,
};
