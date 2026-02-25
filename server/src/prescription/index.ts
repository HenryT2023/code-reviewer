/**
 * Prescription Engine — Public API
 * Diagnose → Community Search → Generate Windsurf Plans
 */

export { runPrescription } from './prescriber';
export { extractGaps, type RoleOutput } from './gap-extractor';
export { searchCommunity, getAllSources } from './community-searcher';
export { generatePlan, generateAllPlans } from './plan-generator';
export type {
  Gap,
  GapCategory,
  GapPriority,
  CommunitySource,
  SearchQuery,
  SearchResult,
  CommunityInsight,
  SourceStrategy,
  Prescription,
  PrescriptionReport,
  PrescriptionConfig,
} from './types';
export { loadConfig } from './types';
