/**
 * Coverage Scorer
 * 覆盖率评分计算
 */

import type { 
  ModuleNode, 
  RealCoverage, 
  CoverageConfig,
  CoverageOverview,
} from './types';
import { DEFAULT_CONFIG } from './types';

// ─── Coverage Score Calculation ──────────────────────────────────────────────

export function calculateCoverageScore(
  modules: ModuleNode[],
  realCoverage: RealCoverage | null,
  config: CoverageConfig = DEFAULT_CONFIG
): number {
  if (realCoverage) {
    return calculateRealCoverageScore(realCoverage);
  }
  return calculateProxyCoverageScore(modules, config);
}

function calculateRealCoverageScore(coverage: RealCoverage): number {
  const lineWeight = 0.5;
  const branchWeight = 0.3;
  const functionWeight = 0.2;
  
  let score = coverage.overall.lines.percentage * lineWeight;
  
  if (coverage.overall.branches) {
    score += coverage.overall.branches.percentage * branchWeight;
  } else {
    // Redistribute weight to lines if no branch coverage
    score += coverage.overall.lines.percentage * branchWeight;
  }
  
  if (coverage.overall.functions) {
    score += coverage.overall.functions.percentage * functionWeight;
  } else {
    // Redistribute weight to lines if no function coverage
    score += coverage.overall.lines.percentage * functionWeight;
  }
  
  return Math.round(score);
}

function calculateProxyCoverageScore(
  modules: ModuleNode[],
  config: CoverageConfig
): number {
  if (modules.length === 0) return 0;
  
  let totalWeight = 0;
  let weightedScore = 0;
  
  for (const mod of modules) {
    // Weight by criticality
    const criticalityWeight = mod.criticality === 'high' ? 3 : mod.criticality === 'medium' ? 2 : 1;
    // Weight by size (source files)
    const sizeWeight = Math.log2(mod.metrics.sourceFiles + 1);
    const weight = criticalityWeight * sizeWeight;
    
    // Calculate module score from proxy metrics
    const testFileRatioScore = Math.min(mod.metrics.testFileRatio / 0.2, 1) * 40;
    const testLocRatioScore = Math.min(mod.metrics.testToSrcLocRatio / 0.3, 1) * 30;
    const testCaseScore = Math.min(mod.metrics.testCaseCount / (mod.metrics.sourceFiles * 2), 1) * 30;
    
    const moduleScore = testFileRatioScore + testLocRatioScore + testCaseScore;
    
    weightedScore += moduleScore * weight;
    totalWeight += weight;
  }
  
  return totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 0;
}

// ─── Overview Generation ─────────────────────────────────────────────────────

export function generateCoverageOverview(
  modules: ModuleNode[],
  realCoverage: RealCoverage | null,
  coverageScore: number,
  testQualityScore: number,
  finalScore: number
): CoverageOverview {
  // Aggregate module metrics
  let totalSourceFiles = 0;
  let totalSourceLines = 0;
  let totalTestFiles = 0;
  let totalTestLines = 0;
  let totalTestCases = 0;
  
  for (const mod of modules) {
    totalSourceFiles += mod.metrics.sourceFiles;
    totalSourceLines += mod.metrics.sourceLines;
    totalTestFiles += mod.metrics.testFiles;
    totalTestLines += mod.metrics.testLines;
    totalTestCases += mod.metrics.testCaseCount;
  }
  
  const testFileRatio = totalSourceFiles > 0 ? totalTestFiles / totalSourceFiles : 0;
  const testLineRatio = totalSourceLines > 0 ? totalTestLines / totalSourceLines : 0;
  
  const overview: CoverageOverview = {
    totalSourceFiles,
    totalSourceLines,
    totalTestFiles,
    totalTestLines,
    totalTestCases,
    testFileRatio: Math.round(testFileRatio * 100) / 100,
    testLineRatio: Math.round(testLineRatio * 100) / 100,
    hasRealCoverage: realCoverage !== null,
    coverageScore,
    testQualityScore,
    finalScore,
  };
  
  // Add real coverage data if available
  if (realCoverage) {
    overview.lineCoverage = realCoverage.overall.lines.percentage;
    if (realCoverage.overall.branches) {
      overview.branchCoverage = realCoverage.overall.branches.percentage;
    }
    if (realCoverage.overall.functions) {
      overview.functionCoverage = realCoverage.overall.functions.percentage;
    }
  }
  
  return overview;
}

// ─── Module Status Update ────────────────────────────────────────────────────

export function updateModuleStatuses(
  modules: ModuleNode[],
  realCoverage: RealCoverage | null,
  config: CoverageConfig = DEFAULT_CONFIG
): ModuleNode[] {
  return modules.map(mod => {
    let status: 'good' | 'warning' | 'critical';
    
    if (realCoverage && mod.metrics.lineCoverage !== undefined) {
      // Use real coverage
      if (mod.metrics.lineCoverage >= 80) {
        status = 'good';
      } else if (mod.metrics.lineCoverage >= 50) {
        status = 'warning';
      } else {
        status = 'critical';
      }
    } else {
      // Use proxy metrics
      if (mod.metrics.testFileRatio >= config.thresholds.good) {
        status = 'good';
      } else if (mod.metrics.testFileRatio >= config.thresholds.warning) {
        status = 'warning';
      } else {
        status = 'critical';
      }
    }
    
    return { ...mod, status };
  });
}

export { calculateRealCoverageScore, calculateProxyCoverageScore };
