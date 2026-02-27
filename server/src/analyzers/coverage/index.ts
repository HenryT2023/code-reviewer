/**
 * Coverage Intelligence
 * 测试覆盖智能分析主入口
 */

import * as fs from 'fs';
import * as path from 'path';

// Types
export * from './types';

// Module Key
import { normalizeModuleKey } from './module-key';
export { normalizeModuleKey, moduleKeyFromFilePath, moduleKeysMatch } from './module-key';

// PR Gate
export {
  readBaseline,
  writeBaseline,
  extractGateMetrics,
  computeGateResult,
  formatGateResultMarkdown,
} from './gate';

// Module Graph
export { 
  buildModuleGraph, 
  detectProjectType, 
  detectLanguage,
  detectPrimaryLanguage,
  calculateModuleMetrics,
} from './module-graph';

// Coverage Reader
export { 
  readCoverageReport, 
  mergeCoverageWithModules,
} from './coverage-reader';

// Test Taxonomy
export { 
  classifyTestFile, 
  analyzeTestFile, 
  analyzeTestFiles,
  extractImports,
  countTestCases,
  countAsserts,
  detectFlakyRisk,
} from './test-taxonomy';

// Quality Metrics
export { 
  calculateQualityMetrics,
  calculateDimensions,
  calculateTestQualityScore,
} from './quality-metrics';

// Scorer
export { 
  calculateCoverageScore, 
  generateCoverageOverview,
  updateModuleStatuses,
} from './scorer';

// Action Generator
export { 
  generateActionItems,
  calculateMinimumTestPath,
  generateArchitectRecommendations,
  generateCoderRecommendations,
} from './action-generator';

// Types re-export for convenience
import type { 
  CoverageIntelligence, 
  CoverageOverview,
  ModuleNode, 
  TestFile, 
  QualityMetrics,
  ActionItem,
  RealCoverage,
  CoverageConfig,
  CoverageMeta,
  ProjectType,
} from './types';
import { DEFAULT_CONFIG } from './types';

import { buildModuleGraph, detectProjectType } from './module-graph';
import { readCoverageReport, readCoverageReportSync, mergeCoverageWithModules } from './coverage-reader';
import { analyzeTestFiles } from './test-taxonomy';
import { calculateQualityMetrics } from './quality-metrics';
import { calculateCoverageScore, generateCoverageOverview, updateModuleStatuses } from './scorer';
import { generateActionItems } from './action-generator';

// ─── Main Analysis Function ──────────────────────────────────────────────────

export async function analyzeCoverageIntelligence(
  projectPath: string,
  testFilePaths: string[],
  config: CoverageConfig = DEFAULT_CONFIG
): Promise<CoverageIntelligence> {
  const startTime = Date.now();
  
  // 1. Detect project type
  const projectType = detectProjectType(projectPath);
  
  // 2. Build module graph
  let modules = await buildModuleGraph(projectPath, testFilePaths);
  
  // 3. Read real coverage report if available
  const realCoverage = await readCoverageReport(projectPath);
  
  // 4. Merge real coverage with modules
  if (realCoverage) {
    modules = modules.map(mod => {
      const coverage = mergeCoverageWithModules(realCoverage, mod.path, projectPath);
      return {
        ...mod,
        metrics: {
          ...mod.metrics,
          lineCoverage: coverage.lineCoverage,
          branchCoverage: coverage.branchCoverage,
          functionCoverage: coverage.functionCoverage,
          isProxy: coverage.lineCoverage === undefined,
        },
      };
    });
  }
  
  // 5. Update module statuses
  modules = updateModuleStatuses(modules, realCoverage, config);
  
  // 6. Analyze test files
  const tests = analyzeTestFiles(testFilePaths, projectPath);
  
  // 7. Calculate coverage score
  const coverageScore = calculateCoverageScore(modules, realCoverage, config);
  
  // 8. Calculate quality metrics
  const quality = calculateQualityMetrics(tests, coverageScore, config);
  
  // 9. Generate overview
  const overview = generateCoverageOverview(
    modules, 
    realCoverage, 
    coverageScore, 
    quality.testQualityScore, 
    quality.finalScore
  );
  
  // 10. Generate action items
  const actionItems = generateActionItems(modules, tests, quality);
  
  // 11. Build meta
  const meta: CoverageMeta = {
    hasRealCoverage: realCoverage !== null,
    coverageSource: realCoverage?.source || 'proxy',
    projectType,
    analyzedAt: new Date().toISOString(),
    analysisVersion: '2.0.0',
  };
  
  return {
    overview,
    modules,
    tests,
    quality,
    actionItems,
    meta,
  };
}

// ─── Legacy Compatibility ────────────────────────────────────────────────────

export interface LegacyTestCoverageAnalysis {
  testFileCount: number;
  testFileRatio: number;
  testLineCount: number;
  testLineRatio: number;
  testFrameworks: string[];
  testTypes: { unit: number; integration: number; e2e: number };
  coverageConfigured: boolean;
  coverageTools: string[];
  moduleTestCoverage: Array<{
    module: string;
    sourceFiles: number;
    testFiles: number;
    ratio: number;
    status: 'good' | 'warning' | 'critical';
  }>;
  testPatterns: { fixtures: number; mocks: number; factories: number; snapshots: number };
  testQualityScore: number;
  recommendations: string[];
  // New fields
  coverageIntelligence?: CoverageIntelligence;
}

export function convertToLegacyFormat(
  intelligence: CoverageIntelligence,
  testFrameworks: string[]
): LegacyTestCoverageAnalysis {
  // Count test types
  const testTypes = { unit: 0, integration: 0, e2e: 0 };
  for (const test of intelligence.tests) {
    if (test.type === 'unit') testTypes.unit++;
    else if (test.type === 'integration') testTypes.integration++;
    else if (test.type === 'e2e') testTypes.e2e++;
  }
  
  // Count test patterns
  const testPatterns = { fixtures: 0, mocks: 0, factories: 0, snapshots: 0 };
  for (const test of intelligence.tests) {
    if (test.quality.isolationScore > 70) testPatterns.fixtures++;
    if (test.imports.some(i => i.includes('mock'))) testPatterns.mocks++;
    if (test.imports.some(i => i.includes('factory') || i.includes('faker'))) testPatterns.factories++;
  }
  
  // Convert module coverage
  const moduleTestCoverage = intelligence.modules.map(m => ({
    module: m.name,
    sourceFiles: m.metrics.sourceFiles,
    testFiles: m.metrics.testFiles,
    ratio: m.metrics.testFileRatio,
    status: m.status,
  }));
  
  // Generate recommendations from action items
  const recommendations = intelligence.actionItems
    .slice(0, 6)
    .map(a => a.description);
  
  // Detect coverage tools
  const coverageTools: string[] = [];
  if (intelligence.meta.hasRealCoverage) {
    if (intelligence.meta.coverageSource === 'lcov') coverageTools.push('lcov');
    if (intelligence.meta.coverageSource === 'cobertura') coverageTools.push('cobertura');
    if (intelligence.meta.coverageSource === 'jacoco') coverageTools.push('jacoco');
  }
  
  // Also detect coverage tools from config files (pyproject.toml, package.json)
  // even if no real coverage report was found
  if (coverageTools.length === 0 && intelligence.meta.projectType?.startsWith('python')) {
    try {
      const fs = require('fs');
      const path = require('path');
      // Search for pyproject.toml files up to 3 levels deep
      const findPyprojects = (dir: string, depth = 0): string[] => {
        if (depth > 3) return [];
        const results: string[] = [];
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name === 'pyproject.toml' && e.isFile()) results.push(path.join(dir, e.name));
            if (e.isDirectory() && !e.name.startsWith('.') && !['node_modules', '__pycache__', '.venv', 'venv'].includes(e.name)) {
              results.push(...findPyprojects(path.join(dir, e.name), depth + 1));
            }
          }
        } catch { /* ignore */ }
        return results;
      };
      // Extract projectPath from module paths
      const projectPath = intelligence.modules.length > 0 
        ? path.dirname(intelligence.modules[0].path.replace(/\/[^/]+$/, ''))
        : '';
      if (projectPath) {
        for (const f of findPyprojects(projectPath)) {
          const content = fs.readFileSync(f, 'utf-8');
          if (content.includes('pytest-cov') || content.includes('[tool.coverage]') || content.includes('--cov')) {
            coverageTools.push('pytest-cov');
            break;
          }
        }
      }
    } catch { /* ignore */ }
  }
  
  return {
    testFileCount: intelligence.overview.totalTestFiles,
    testFileRatio: intelligence.overview.testFileRatio,
    testLineCount: intelligence.overview.totalTestLines,
    testLineRatio: intelligence.overview.testLineRatio,
    testFrameworks,
    testTypes,
    coverageConfigured: intelligence.meta.hasRealCoverage || coverageTools.length > 0,
    coverageTools,
    moduleTestCoverage,
    testPatterns,
    testQualityScore: intelligence.quality.finalScore,
    recommendations,
    coverageIntelligence: intelligence,
  };
}

// ─── Sync Version ────────────────────────────────────────────────────────────

export function analyzeCoverageIntelligenceSync(
  projectPath: string,
  testFilePaths: string[],
  config: CoverageConfig = DEFAULT_CONFIG
): CoverageIntelligence {
  // 1. Detect project type
  const projectType = detectProjectType(projectPath);
  
  // 2. Build module graph (sync - the function is already sync internally)
  // Note: buildModuleGraph returns Promise but internally uses sync fs operations
  // We need to handle this synchronously
  let modules: ModuleNode[] = [];
  try {
    // The buildModuleGraph function uses async but all internal operations are sync
    // For true sync, we'll build a simplified version
    modules = buildModuleGraphSync(projectPath, testFilePaths);
  } catch {
    modules = [];
  }
  
  // 3. Read real coverage report if available (sync)
  const realCoverage = readCoverageReportSync(projectPath);
  
  // 4. Merge real coverage with modules
  if (realCoverage) {
    modules = modules.map(mod => {
      const coverage = mergeCoverageWithModules(realCoverage, mod.path, projectPath);
      return {
        ...mod,
        metrics: {
          ...mod.metrics,
          lineCoverage: coverage.lineCoverage,
          branchCoverage: coverage.branchCoverage,
          functionCoverage: coverage.functionCoverage,
          isProxy: coverage.lineCoverage === undefined,
        },
      };
    });
  }
  
  // 5. Update module statuses
  modules = updateModuleStatuses(modules, realCoverage, config);
  
  // 6. Analyze test files
  const tests = analyzeTestFiles(testFilePaths, projectPath);
  
  // 7. Calculate coverage score
  const coverageScore = calculateCoverageScore(modules, realCoverage, config);
  
  // 8. Calculate quality metrics
  const quality = calculateQualityMetrics(tests, coverageScore, config);
  
  // 9. Generate overview
  const overview = generateCoverageOverview(
    modules, 
    realCoverage, 
    coverageScore, 
    quality.testQualityScore, 
    quality.finalScore
  );
  
  // 10. Generate action items
  const actionItems = generateActionItems(modules, tests, quality);
  
  // 11. Build meta
  const meta: CoverageMeta = {
    hasRealCoverage: realCoverage !== null,
    coverageSource: realCoverage?.source || 'proxy',
    projectType,
    analyzedAt: new Date().toISOString(),
    analysisVersion: '2.0.0',
  };
  
  return {
    overview,
    modules,
    tests,
    quality,
    actionItems,
    meta,
  };
}

// Simplified sync version of buildModuleGraph
// Supports monorepo structures by recursing into subdirectories
function buildModuleGraphSync(projectPath: string, testFiles: string[]): ModuleNode[] {
  const { detectPrimaryLanguage, calculateModuleMetrics, determineStatus, determineCriticality } = require('./module-graph');
  const fs = require('fs');
  const path = require('path');
  
  const modules: ModuleNode[] = [];
  const ignoreDirs = ['node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.git', 'test', 'tests', '__tests__'];
  const codeExtensions = ['.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.go', '.rs'];
  
  // Check if a directory directly contains source code files (non-recursive)
  function hasDirSourceFiles(dirPath: string): boolean {
    try {
      return fs.readdirSync(dirPath).some((f: string) =>
        codeExtensions.some(ext => f.endsWith(ext))
      );
    } catch { return false; }
  }
  
  // Add a directory as a module
  function addModule(fullPath: string, name: string, relativePath: string) {
    const metrics = calculateModuleMetrics(fullPath, testFiles, projectPath);
    // Only add if the module has meaningful content (source files or test files)
    if (metrics.sourceFiles > 0 || metrics.testFiles > 0) {
      modules.push({
        name,
        key: normalizeModuleKey(name),
        path: fullPath,
        relativePath,
        depth: 0,
        parent: null,
        language: detectPrimaryLanguage(fullPath),
        metrics,
        criticality: determineCriticality(name, relativePath),
        status: determineStatus(metrics),
        children: [],
      });
    }
  }
  
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoreDirs.includes(entry.name) || entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(projectPath, entry.name);
      
      if (hasDirSourceFiles(fullPath)) {
        // Directory has direct source files — add as module
        addModule(fullPath, entry.name, entry.name);
      } else {
        // No direct source files — check subdirectories (monorepo / services pattern)
        // e.g. services/wms/, services/tradeos/
        try {
          const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
          let addedSubModules = false;
          
          for (const subEntry of subEntries) {
            if (!subEntry.isDirectory() || ignoreDirs.includes(subEntry.name) || subEntry.name.startsWith('.')) continue;
            
            const subFullPath = path.join(fullPath, subEntry.name);
            const subRelativePath = `${entry.name}/${subEntry.name}`;
            
            // Check if this subdir or any of its children contain source files
            const hasDirectSource = hasDirSourceFiles(subFullPath);
            let hasNestedSource = false;
            
            if (!hasDirectSource) {
              // Check one more level (e.g. services/wms/app/ or services/tradeos/src/)
              try {
                const deepEntries = fs.readdirSync(subFullPath, { withFileTypes: true });
                hasNestedSource = deepEntries.some((de: any) => {
                  if (!de.isDirectory() || ignoreDirs.includes(de.name)) return false;
                  return hasDirSourceFiles(path.join(subFullPath, de.name));
                });
              } catch { /* ignore */ }
            }
            
            if (hasDirectSource || hasNestedSource) {
              addModule(subFullPath, subEntry.name, subRelativePath);
              addedSubModules = true;
            }
          }
          
          // If no sub-modules were found, try adding the parent anyway
          // (calculateModuleMetrics recursively scans so it may still find files)
          if (!addedSubModules) {
            addModule(fullPath, entry.name, entry.name);
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  
  return modules;
}
