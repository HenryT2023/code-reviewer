/**
 * Prescription Engine — Type Definitions
 * Covers gaps, community search results, and generated prescriptions.
 */

// ─── Gap Types ──────────────────────────────────────────────────────────

export type GapCategory = 'code_fix' | 'validation' | 'integration' | 'domain';
export type GapPriority = 'critical' | 'high' | 'medium' | 'low';

export interface Gap {
  id: string;
  title: string;
  description: string;
  category: GapCategory;
  priority: GapPriority;
  sourceRoles: string[];
  /** Raw evidence from role outputs (dimension comments, MREP claims, etc.) */
  evidence: string[];
  /** Related file paths in the target project, if known */
  relatedFiles?: string[];
}

// ─── Community Search Types ─────────────────────────────────────────────

export type CommunityLanguage = 'en' | 'cn';
export type CommunityDomain = 'general' | 'trade' | 'saas' | 'startup' | 'supply_chain';

export interface CommunitySource {
  id: string;
  name: string;
  siteFilter: string;
  language: CommunityLanguage;
  domain: CommunityDomain;
}

export interface SearchQuery {
  gapId: string;
  query: string;
  language: CommunityLanguage;
  targetSources: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedDate?: string;
}

export type SourceStrategy = 'web_only' | 'llm_only' | 'hybrid';

export interface CommunityInsight {
  gapId: string;
  results: SearchResult[];
  /** Channel B: LLM Expert direct advice (independent of web search) */
  llmAdvice: string;
  /** Cross-validated synthesis merging web search + LLM expert */
  synthesis: string;
  queriesUsed: string[];
  /** Which channels contributed to this insight */
  sourceStrategy: SourceStrategy;
}

// ─── Prescription Types ─────────────────────────────────────────────────

export interface Prescription {
  id: string;
  gapId: string;
  gap: Gap;
  community: CommunityInsight;
  /** Generated Windsurf plan-mode .md content */
  planContent: string;
  /** Relative filename, e.g. "rx-001-e2e-trade-flow.md" */
  filename: string;
}

export interface PrescriptionReport {
  evaluationId: string;
  projectPath: string;
  projectName: string;
  generatedAt: string;
  gaps: Gap[];
  prescriptions: Prescription[];
  /** Total Brave Search queries used */
  searchQueriesUsed: number;
  /** Total AI calls used */
  aiCallsUsed: number;
}

// ─── Configuration ──────────────────────────────────────────────────────

export interface PrescriptionConfig {
  enabled: boolean;
  maxGaps: number;
  maxSearchResultsPerQuery: number;
  cacheTtlDays: number;
  braveApiKey: string;
}

export const DEFAULT_CONFIG: PrescriptionConfig = {
  enabled: true,
  maxGaps: 6,
  maxSearchResultsPerQuery: 5,
  cacheTtlDays: 7,
  braveApiKey: '',
};

export function loadConfig(): PrescriptionConfig {
  return {
    enabled: process.env.PRESCRIPTION_ENABLED !== 'false',
    maxGaps: parseInt(process.env.PRESCRIPTION_MAX_GAPS || '6', 10),
    maxSearchResultsPerQuery: 5,
    cacheTtlDays: 7,
    braveApiKey: process.env.BRAVE_SEARCH_API_KEY || '',
  };
}
