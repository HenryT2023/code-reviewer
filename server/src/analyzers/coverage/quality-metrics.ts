/**
 * Quality Metrics
 * 测试质量维度计算
 */

import type { 
  TestFile, 
  QualityMetrics, 
  QualityDimensions, 
  DuplicateCluster,
  CoverageConfig,
} from './types';
import { DEFAULT_CONFIG } from './types';

// ─── Main Quality Calculation ────────────────────────────────────────────────

export function calculateQualityMetrics(
  testFiles: TestFile[],
  coverageScore: number,
  config: CoverageConfig = DEFAULT_CONFIG
): QualityMetrics {
  if (testFiles.length === 0) {
    return {
      coverageScore,
      testQualityScore: 0,
      finalScore: Math.round(coverageScore * config.weights.coverage),
      dimensions: getEmptyDimensions(),
    };
  }

  const dimensions = calculateDimensions(testFiles);
  const testQualityScore = calculateTestQualityScore(dimensions, config);
  const finalScore = Math.round(
    coverageScore * config.weights.coverage + 
    testQualityScore * config.weights.quality
  );

  return {
    coverageScore,
    testQualityScore,
    finalScore,
    dimensions,
  };
}

// ─── Dimension Calculations ──────────────────────────────────────────────────

function calculateDimensions(testFiles: TestFile[]): QualityDimensions {
  return {
    assertDensity: calculateAssertDensityDimension(testFiles),
    naming: calculateNamingDimension(testFiles),
    flakyRisk: calculateFlakyRiskDimension(testFiles),
    isolation: calculateIsolationDimension(testFiles),
    duplication: calculateDuplicationDimension(testFiles),
    dependencySmell: calculateDependencySmellDimension(testFiles),
  };
}

function calculateAssertDensityDimension(testFiles: TestFile[]): QualityDimensions['assertDensity'] {
  const densities = testFiles.map(f => f.metrics.assertDensity).filter(d => d > 0);
  
  if (densities.length === 0) {
    return { score: 50, avg: 0, comment: '无法计算断言密度' };
  }
  
  const avg = densities.reduce((a, b) => a + b, 0) / densities.length;
  
  // Ideal assert density is 2-5 per test case
  let score: number;
  if (avg >= 2 && avg <= 5) {
    score = 100;
  } else if (avg >= 1 && avg < 2) {
    score = 70;
  } else if (avg > 5 && avg <= 10) {
    score = 80;
  } else if (avg < 1) {
    score = 40;
  } else {
    score = 60; // Too many asserts per test
  }
  
  let comment: string;
  if (avg < 1) {
    comment = `断言密度过低 (${avg.toFixed(1)})，每个测试用例应至少有 1-2 个断言`;
  } else if (avg > 10) {
    comment = `断言密度过高 (${avg.toFixed(1)})，考虑拆分测试用例`;
  } else {
    comment = `断言密度良好 (${avg.toFixed(1)})`;
  }
  
  return { score, avg: Math.round(avg * 100) / 100, comment };
}

function calculateNamingDimension(testFiles: TestFile[]): QualityDimensions['naming'] {
  const scores = testFiles.map(f => f.quality.namingScore);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  
  const allViolations = testFiles.flatMap(f => f.quality.namingViolations);
  const uniqueViolations = [...new Set(allViolations)];
  
  let comment: string;
  if (avgScore >= 80) {
    comment = '测试命名规范良好，清晰表达测试意图';
  } else if (avgScore >= 60) {
    comment = '部分测试命名不够清晰，建议使用 should_xxx_when_xxx 模式';
  } else {
    comment = '测试命名需要改进，难以理解测试意图';
  }
  
  return {
    score: Math.round(avgScore),
    violations: uniqueViolations.length,
    examples: uniqueViolations.slice(0, 5),
    comment,
  };
}

function calculateFlakyRiskDimension(testFiles: TestFile[]): QualityDimensions['flakyRisk'] {
  const risks = testFiles.map(f => f.quality.flakyRisk);
  const avgRisk = risks.length > 0 ? risks.reduce((a, b) => a + b, 0) / risks.length : 0;
  
  // Score is inverse of risk
  const score = Math.round(100 - avgRisk);
  
  // Find high-risk files
  const riskFiles = testFiles
    .filter(f => f.quality.flakyRisk >= 50)
    .map(f => f.relativePath)
    .slice(0, 5);
  
  let comment: string;
  if (avgRisk < 20) {
    comment = '测试稳定性良好，低 flaky 风险';
  } else if (avgRisk < 50) {
    comment = '存在一些 flaky 风险因素，建议检查时间依赖和网络调用';
  } else {
    comment = '高 flaky 风险，多个测试存在不稳定因素';
  }
  
  return { score, riskFiles, comment };
}

function calculateIsolationDimension(testFiles: TestFile[]): QualityDimensions['isolation'] {
  const scores = testFiles.map(f => f.quality.isolationScore);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  
  let comment: string;
  if (avgScore >= 80) {
    comment = '测试隔离性良好，使用了适当的 mock 和 fixture';
  } else if (avgScore >= 60) {
    comment = '测试隔离性一般，建议增加 mock 使用';
  } else {
    comment = '测试隔离性差，存在共享状态和未隔离的外部依赖';
  }
  
  return { score: Math.round(avgScore), comment };
}

function calculateDuplicationDimension(testFiles: TestFile[]): QualityDimensions['duplication'] {
  const ratios = testFiles.map(f => f.quality.duplicateRatio);
  const avgRatio = ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  
  // Score is inverse of duplication
  const score = Math.round(100 - avgRatio);
  
  // Find files with high duplication
  const highDupFiles = testFiles
    .filter(f => f.quality.duplicateRatio > 30)
    .sort((a, b) => b.quality.duplicateRatio - a.quality.duplicateRatio);
  
  const clusters: DuplicateCluster[] = highDupFiles.slice(0, 3).map(f => ({
    files: [f.relativePath],
    similarity: f.quality.duplicateRatio / 100,
  }));
  
  let comment: string;
  if (avgRatio < 15) {
    comment = '测试代码重复度低，DRY 原则执行良好';
  } else if (avgRatio < 30) {
    comment = '存在一些重复代码，考虑提取共用 fixture';
  } else {
    comment = '测试代码重复度高，建议重构提取公共逻辑';
  }
  
  return { score, clusters, comment };
}

function calculateDependencySmellDimension(testFiles: TestFile[]): QualityDimensions['dependencySmell'] {
  // Analyze cross-module dependencies
  const moduleImportCounts: Record<string, number> = {};
  
  for (const tf of testFiles) {
    for (const imp of tf.imports) {
      moduleImportCounts[imp] = (moduleImportCounts[imp] || 0) + 1;
    }
  }
  
  // Find hotspots (modules imported by many tests)
  const hotspots = Object.entries(moduleImportCounts)
    .filter(([_, count]) => count > testFiles.length * 0.5)
    .map(([module]) => module)
    .slice(0, 5);
  
  // Calculate score based on import diversity
  const avgImports = testFiles.length > 0 
    ? testFiles.reduce((sum, f) => sum + f.imports.length, 0) / testFiles.length 
    : 0;
  
  let score: number;
  if (avgImports <= 3) {
    score = 100;
  } else if (avgImports <= 5) {
    score = 80;
  } else if (avgImports <= 8) {
    score = 60;
  } else {
    score = 40;
  }
  
  let comment: string;
  if (hotspots.length === 0) {
    comment = '测试依赖分布合理，无明显耦合热点';
  } else {
    comment = `存在依赖热点: ${hotspots.join(', ')}`;
  }
  
  return { score, hotspots, comment };
}

// ─── Score Calculation ───────────────────────────────────────────────────────

function calculateTestQualityScore(
  dimensions: QualityDimensions,
  config: CoverageConfig
): number {
  const weights = config.weights.qualityDimensions;
  
  const score = 
    dimensions.assertDensity.score * weights.assertDensity +
    dimensions.naming.score * weights.naming +
    dimensions.flakyRisk.score * weights.flakyRisk +
    dimensions.isolation.score * weights.isolation +
    dimensions.duplication.score * weights.duplication +
    dimensions.dependencySmell.score * weights.dependencySmell;
  
  return Math.round(score);
}

function getEmptyDimensions(): QualityDimensions {
  return {
    assertDensity: { score: 0, avg: 0, comment: '无测试文件' },
    naming: { score: 0, violations: 0, examples: [], comment: '无测试文件' },
    flakyRisk: { score: 100, riskFiles: [], comment: '无测试文件' },
    isolation: { score: 0, comment: '无测试文件' },
    duplication: { score: 100, clusters: [], comment: '无测试文件' },
    dependencySmell: { score: 100, hotspots: [], comment: '无测试文件' },
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { calculateDimensions, calculateTestQualityScore };
