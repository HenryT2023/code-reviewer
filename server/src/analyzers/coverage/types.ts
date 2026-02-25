/**
 * Coverage Intelligence Types
 * 测试覆盖智能分析的核心类型定义
 */

// ─── Main Output Structure ───────────────────────────────────────────────────

export interface CoverageIntelligence {
  overview: CoverageOverview;
  modules: ModuleNode[];
  tests: TestFile[];
  quality: QualityMetrics;
  actionItems: ActionItem[];
  meta: CoverageMeta;
}

export interface CoverageOverview {
  totalSourceFiles: number;
  totalSourceLines: number;
  totalTestFiles: number;
  totalTestLines: number;
  totalTestCases: number;
  testFileRatio: number;
  testLineRatio: number;
  hasRealCoverage: boolean;
  lineCoverage?: number;
  branchCoverage?: number;
  functionCoverage?: number;
  coverageScore: number;
  testQualityScore: number;
  finalScore: number;
}

export interface CoverageMeta {
  hasRealCoverage: boolean;
  coverageSource: 'lcov' | 'cobertura' | 'jacoco' | 'proxy';
  projectType: ProjectType;
  analyzedAt: string;
  analysisVersion: string;
}

// ─── Module Graph ────────────────────────────────────────────────────────────

export interface ModuleNode {
  name: string;
  key: string;  // Normalized key for stable alignment across legacy/intelligence
  path: string;
  relativePath: string;
  depth: number;
  parent: string | null;
  language: Language;
  metrics: ModuleMetrics;
  criticality: 'high' | 'medium' | 'low';
  status: 'good' | 'warning' | 'critical';
  children: ModuleNode[];
}

export interface ModuleMetrics {
  sourceFiles: number;
  sourceLines: number;
  testFiles: number;
  testLines: number;
  testCaseCount: number;
  // Real coverage (if available)
  lineCoverage?: number;
  branchCoverage?: number;
  functionCoverage?: number;
  // Proxy metrics (always calculated)
  testFileRatio: number;
  testToSrcLocRatio: number;
  isProxy: boolean;
}

// ─── Test Files ──────────────────────────────────────────────────────────────

export interface TestFile {
  path: string;
  relativePath: string;
  module: string;
  type: TestType;
  evidence: string[];
  language: Language;
  metrics: TestFileMetrics;
  quality: TestFileQuality;
  imports: string[];
}

export interface TestFileMetrics {
  lines: number;
  testCaseCount: number;
  assertCount: number;
  assertDensity: number;
}

export interface TestFileQuality {
  namingScore: number;
  namingViolations: string[];
  flakyRisk: number;
  flakyReasons: string[];
  isolationScore: number;
  duplicateRatio: number;
}

export type TestType = 'unit' | 'integration' | 'e2e' | 'contract' | 'property' | 'unknown';

// ─── Quality Metrics ─────────────────────────────────────────────────────────

export interface QualityMetrics {
  coverageScore: number;
  testQualityScore: number;
  finalScore: number;
  dimensions: QualityDimensions;
}

export interface QualityDimensions {
  assertDensity: DimensionScore & { avg: number };
  naming: DimensionScore & { violations: number; examples: string[] };
  flakyRisk: DimensionScore & { riskFiles: string[] };
  isolation: DimensionScore;
  duplication: DimensionScore & { clusters: DuplicateCluster[] };
  dependencySmell: DimensionScore & { hotspots: string[] };
}

export interface DimensionScore {
  score: number;
  comment: string;
}

export interface DuplicateCluster {
  files: string[];
  similarity: number;
  sharedTokens?: number;
}

// ─── Action Items ────────────────────────────────────────────────────────────

export interface ActionItem {
  id: string;
  priority: 'high' | 'medium' | 'low';
  type: ActionType;
  title: string;
  description: string;
  targetModule: string;
  targetFile?: string;
  targetFunction?: string;
  expectedImpact: string;
  effort: 'small' | 'medium' | 'large';
  testType?: TestType;
  labels: string[];
}

export type ActionType = 
  | 'add_test'
  | 'add_integration_test'
  | 'add_e2e_test'
  | 'improve_quality'
  | 'fix_flaky'
  | 'reduce_duplication'
  | 'add_mock'
  | 'improve_naming';

// ─── Coverage Report Parsing ─────────────────────────────────────────────────

export interface RealCoverage {
  source: 'lcov' | 'cobertura' | 'jacoco';
  timestamp?: string;
  overall: CoverageStats;
  files: FileCoverage[];
}

export interface CoverageStats {
  lines: { covered: number; total: number; percentage: number };
  branches?: { covered: number; total: number; percentage: number };
  functions?: { covered: number; total: number; percentage: number };
}

export interface FileCoverage {
  path: string;
  lines: { covered: number; total: number; percentage: number };
  branches?: { covered: number; total: number; percentage: number };
  functions?: { covered: number; total: number; percentage: number };
  uncoveredLines?: number[];
}

// ─── Project Detection ───────────────────────────────────────────────────────

export type ProjectType = 
  | 'python'
  | 'python-fastapi'
  | 'python-django'
  | 'node'
  | 'node-react'
  | 'node-nextjs'
  | 'node-express'
  | 'typescript'
  | 'java'
  | 'java-spring'
  | 'monorepo-pnpm'
  | 'monorepo-yarn'
  | 'monorepo-npm'
  | 'monorepo-nx'
  | 'monorepo-turbo'
  | 'unknown';

export type Language = 'python' | 'typescript' | 'javascript' | 'java' | 'go' | 'rust' | 'unknown';

// ─── Configuration ───────────────────────────────────────────────────────────

export interface CoverageConfig {
  weights: {
    coverage: number;
    quality: number;
    qualityDimensions: {
      assertDensity: number;
      naming: number;
      flakyRisk: number;
      isolation: number;
      duplication: number;
      dependencySmell: number;
    };
  };
  thresholds: {
    good: number;
    warning: number;
  };
  ignore: string[];
  criticalModules: string[];
}

export const DEFAULT_CONFIG: CoverageConfig = {
  weights: {
    coverage: 0.55,
    quality: 0.45,
    qualityDimensions: {
      assertDensity: 0.20,
      naming: 0.15,
      flakyRisk: 0.20,
      isolation: 0.20,
      duplication: 0.15,
      dependencySmell: 0.10,
    },
  },
  thresholds: {
    good: 0.15,
    warning: 0.05,
  },
  ignore: ['node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.git'],
  criticalModules: ['src', 'app', 'lib', 'core', 'api', 'services', 'agents'],
};

// ─── Test Classification Rules ───────────────────────────────────────────────

export interface ClassificationRule {
  type: TestType;
  patterns: {
    imports?: string[];
    decorators?: string[];
    filePatterns?: RegExp[];
    contentPatterns?: RegExp[];
  };
  priority: number;
}

export const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    type: 'e2e',
    patterns: {
      imports: ['playwright', '@playwright/test', 'selenium', 'cypress', 'puppeteer'],
      filePatterns: [/e2e/, /\.e2e\./, /_e2e\./],
    },
    priority: 100,
  },
  {
    type: 'contract',
    patterns: {
      imports: ['pact', '@pact-foundation/pact', 'schemathesis', 'dredd'],
      filePatterns: [/contract/, /\.contract\./, /_contract\./],
    },
    priority: 90,
  },
  {
    type: 'property',
    patterns: {
      imports: ['hypothesis', 'fast-check', '@fast-check/jest'],
      contentPatterns: [/@given\s*\(/, /fc\.property\s*\(/],
    },
    priority: 85,
  },
  {
    type: 'integration',
    patterns: {
      imports: ['supertest', 'requests', 'httpx', 'axios'],
      decorators: ['pytest.mark.integration'],
      filePatterns: [/integration/, /\.integration\./, /_integration\./, /api_test/, /api\.test/],
      contentPatterns: [/TestClient\s*\(/, /client\.get\s*\(/, /client\.post\s*\(/],
    },
    priority: 70,
  },
  {
    type: 'unit',
    patterns: {
      imports: ['pytest', 'unittest', 'jest', 'vitest', 'mocha'],
      filePatterns: [/test_/, /\.test\./, /\.spec\./, /_test\./],
    },
    priority: 10,
  },
];

// ─── PR Gate Types ──────────────────────────────────────────────────────────

export interface GateResult {
  mode: 'warn' | 'fail';
  status: 'pass' | 'warn' | 'fail' | 'skipped';
  baselinePath?: string;
  baselineSource: 'file' | 'none';
  metrics: GateMetrics;
  baseline?: GateMetrics;
  delta?: GateMetrics;
  reasons: string[];
}

export interface GateMetrics {
  lineCoverage?: number;
  branchCoverage?: number;
  testFileRatio?: number;
  testQualityScore?: number;
}

export interface BaselineCoverage {
  version: number;
  timestamp: string;
  metrics: GateMetrics;
}

export const DEFAULT_GATE_THRESHOLDS = {
  lineCoverageMaxDrop: 0.5,      // -0.5%
  branchCoverageMaxDrop: 1.0,   // -1.0%
  testFileRatioMaxDrop: 0,      // no drop allowed
  testQualityScoreMaxDrop: 5,   // -5 points
};
