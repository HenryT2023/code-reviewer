import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { glob } from 'glob';
import { 
  analyzeCoverageIntelligenceSync, 
  convertToLegacyFormat,
  type CoverageIntelligence,
} from './coverage';

export interface TestCoverageAnalysis {
  testFileCount: number;
  testFileRatio: number;
  testLineCount: number;
  testLineRatio: number;
  testFrameworks: string[];
  testTypes: {
    unit: number;
    integration: number;
    e2e: number;
  };
  coverageConfigured: boolean;
  coverageTools: string[];
  moduleTestCoverage: ModuleTestCoverage[];
  testPatterns: {
    fixtures: number;
    mocks: number;
    factories: number;
    snapshots: number;
  };
  testQualityScore: number;
  recommendations: string[];
  coverageIntelligence?: CoverageIntelligence;
}

export interface ModuleTestCoverage {
  module: string;
  sourceFiles: number;
  testFiles: number;
  ratio: number;
  status: 'good' | 'warning' | 'critical';
}

export interface QualityAnalysis {
  hasTests: boolean;
  testFiles: string[];
  testFramework: string | null;
  testFrameworks: string[];
  testCoverage: TestCoverageAnalysis;
  hasLinter: boolean;
  linterType: string | null;
  linters: string[];
  hasTypeScript: boolean;
  hasTypeChecking: boolean;
  hasPrettier: boolean;
  hasFormatter: boolean;
  formatters: string[];
  hasCI: boolean;
  ciPlatform: string | null;
  hasDocumentation: boolean;
  readmeExists: boolean;
  changelogExists: boolean;
  licenseExists: boolean;
  hasSpecs: boolean;
  specFiles: string[];
  hasContracts: boolean;
  hasDockerfile: boolean;
  hasDockerCompose: boolean;
  dependencyCount: number;
  devDependencyCount: number;
  outdatedDependencies: number;
  vulnerabilities: VulnerabilityInfo | null;
  codeMetrics: CodeMetrics;
  pythonQuality: PythonQuality | null;
}

export interface VulnerabilityInfo {
  total: number;
  critical: number;
  high: number;
  moderate: number;
  low: number;
}

export interface CodeMetrics {
  totalFiles: number;
  totalLines: number;
  avgFileSize: number;
  largestFile: { path: string; lines: number } | null;
  commentRatio: number;
}

export interface PythonQuality {
  hasPyproject: boolean;
  hasRequirements: boolean;
  hasRuff: boolean;
  hasBlack: boolean;
  hasMypy: boolean;
  hasPytest: boolean;
  hasAlembic: boolean;
  pythonVersion: string | null;
  dependencies: string[];
}

export function analyzeCodeQuality(projectPath: string): QualityAnalysis {
  // Scan all package.json files (root + sub-services)
  const allDeps = collectAllDependencies(projectPath);

  const testFiles = findTestFiles(projectPath);
  const testFrameworks = detectAllTestFrameworks(allDeps, projectPath);
  const linters = detectAllLinters(allDeps, projectPath);
  const formatters = detectAllFormatters(allDeps, projectPath);
  const ciPlatform = detectCI(projectPath);
  const codeMetrics = calculateCodeMetrics(projectPath);
  const vulnerabilities = checkVulnerabilities(projectPath);
  const pythonQuality = analyzePythonQuality(projectPath);
  const specFiles = findSpecFiles(projectPath);
  
  // Use new Coverage Intelligence module
  const testCoverage = analyzeTestCoverageWithIntelligence(projectPath, testFiles, testFrameworks, codeMetrics);

  return {
    hasTests: testFiles.length > 0,
    testFiles: testFiles.slice(0, 30),
    testFramework: testFrameworks[0] || null,
    testFrameworks,
    testCoverage,
    hasLinter: linters.length > 0,
    linterType: linters[0] || null,
    linters,
    hasTypeScript: allDeps.has('typescript') || hasFileAnywhere(projectPath, 'tsconfig.json'),
    hasTypeChecking: allDeps.has('typescript') || (pythonQuality?.hasMypy ?? false),
    hasPrettier: allDeps.has('prettier') || hasFileAnywhere(projectPath, '.prettierrc'),
    hasFormatter: formatters.length > 0,
    formatters,
    hasCI: ciPlatform !== null,
    ciPlatform,
    hasDocumentation: fs.existsSync(path.join(projectPath, 'docs')) || fs.existsSync(path.join(projectPath, 'documentation')),
    readmeExists: fs.existsSync(path.join(projectPath, 'README.md')) || fs.existsSync(path.join(projectPath, 'readme.md')),
    changelogExists: fs.existsSync(path.join(projectPath, 'CHANGELOG.md')),
    licenseExists: fs.existsSync(path.join(projectPath, 'LICENSE')) || fs.existsSync(path.join(projectPath, 'LICENSE.md')),
    hasSpecs: specFiles.length > 0,
    specFiles,
    hasContracts: fs.existsSync(path.join(projectPath, 'contracts')) || fs.existsSync(path.join(projectPath, 'schemas')),
    hasDockerfile: hasFileAnywhere(projectPath, 'Dockerfile'),
    hasDockerCompose: fs.existsSync(path.join(projectPath, 'docker-compose.yml')) || fs.existsSync(path.join(projectPath, 'docker-compose.yaml')),
    dependencyCount: 0, // aggregated below
    devDependencyCount: 0,
    outdatedDependencies: 0,
    vulnerabilities,
    codeMetrics,
    pythonQuality,
  };
}

function collectAllDependencies(projectPath: string): Set<string> {
  const allDeps = new Set<string>();
  const pkgFiles = findFilesRecursive(projectPath, 'package.json', 3);
  for (const pkgFile of pkgFiles) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
      for (const dep of Object.keys(pkg.dependencies || {})) allDeps.add(dep);
      for (const dep of Object.keys(pkg.devDependencies || {})) allDeps.add(dep);
    } catch { /* ignore */ }
  }
  // Also check pyproject.toml
  const pyprojectFiles = findFilesRecursive(projectPath, 'pyproject.toml', 3);
  for (const f of pyprojectFiles) {
    try {
      const content = fs.readFileSync(f, 'utf-8').toLowerCase();
      if (content.includes('ruff')) allDeps.add('ruff');
      if (content.includes('black')) allDeps.add('black');
      if (content.includes('mypy')) allDeps.add('mypy');
      if (content.includes('pytest')) allDeps.add('pytest');
      if (content.includes('fastapi')) allDeps.add('fastapi');
    } catch { /* ignore */ }
  }
  return allDeps;
}

function findFilesRecursive(dir: string, filename: string, maxDepth: number, depth = 0): string[] {
  const results: string[] = [];
  if (depth > maxDepth || !fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', '.git', '.venv', 'venv', 'dist', 'build', '__pycache__'].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === filename) {
        results.push(fullPath);
      } else if (entry.isDirectory()) {
        results.push(...findFilesRecursive(fullPath, filename, maxDepth, depth + 1));
      }
    }
  } catch { /* ignore */ }
  return results;
}

function hasFileAnywhere(projectPath: string, filename: string): boolean {
  return findFilesRecursive(projectPath, filename, 3).length > 0;
}

function findTestFiles(projectPath: string): string[] {
  const testFiles: string[] = [];

  function scanDir(dir: string, depth = 0) {
    if (depth > 6) return;
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || ['node_modules', '.venv', 'venv', '__pycache__'].includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (['test', 'tests', 'spec', 'specs', '__tests__'].includes(entry.name.toLowerCase())) {
            testFiles.push(fullPath);
          }
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const name = entry.name.toLowerCase();
          if (name.includes('.test.') || name.includes('.spec.') ||
              name.endsWith('_test.ts') || name.endsWith('_test.js') ||
              name.endsWith('_test.py') || name.startsWith('test_') ||
              name.includes('.test.') || name.includes('_spec.') ||
              name === 'conftest.py' || name === 'factories.py') {
            testFiles.push(fullPath);
          }
        }
      }
    } catch { /* ignore */ }
  }
  scanDir(projectPath);
  return testFiles;
}

function detectAllTestFrameworks(deps: Set<string>, projectPath: string): string[] {
  const frameworks: string[] = [];
  if (deps.has('jest') || deps.has('@jest/core')) frameworks.push('Jest');
  if (deps.has('mocha')) frameworks.push('Mocha');
  if (deps.has('vitest')) frameworks.push('Vitest');
  if (deps.has('ava')) frameworks.push('AVA');
  if (deps.has('@testing-library/react')) frameworks.push('React Testing Library');
  if (deps.has('cypress')) frameworks.push('Cypress');
  if (deps.has('playwright') || deps.has('@playwright/test')) frameworks.push('Playwright');
  if (deps.has('pytest')) frameworks.push('pytest');
  // Also check for conftest.py
  if (hasFileAnywhere(projectPath, 'conftest.py')) {
    if (!frameworks.includes('pytest')) frameworks.push('pytest');
  }
  return frameworks;
}

function detectAllLinters(deps: Set<string>, projectPath: string): string[] {
  const linters: string[] = [];
  if (deps.has('eslint') || hasFileAnywhere(projectPath, '.eslintrc.js') || hasFileAnywhere(projectPath, '.eslintrc.json') || hasFileAnywhere(projectPath, 'eslint.config.js')) linters.push('ESLint');
  if (deps.has('biome') || deps.has('@biomejs/biome')) linters.push('Biome');
  if (deps.has('ruff') || hasFileAnywhere(projectPath, 'ruff.toml')) linters.push('Ruff');
  if (deps.has('pylint')) linters.push('Pylint');
  if (deps.has('flake8')) linters.push('Flake8');
  return linters;
}

function detectAllFormatters(deps: Set<string>, projectPath: string): string[] {
  const formatters: string[] = [];
  if (deps.has('prettier') || hasFileAnywhere(projectPath, '.prettierrc')) formatters.push('Prettier');
  if (deps.has('black')) formatters.push('Black');
  if (deps.has('ruff')) formatters.push('Ruff'); // ruff can also format
  return formatters;
}

function findSpecFiles(projectPath: string): string[] {
  const specFiles: string[] = [];
  const specsDir = path.join(projectPath, 'specs');
  const docsDir = path.join(projectPath, 'docs');
  for (const dir of [specsDir, docsDir]) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      specFiles.push(...files.map(f => path.join(dir, f)));
    } catch { /* ignore */ }
  }
  return specFiles;
}

function detectCI(projectPath: string): string | null {
  if (fs.existsSync(path.join(projectPath, '.github/workflows'))) return 'GitHub Actions';
  if (fs.existsSync(path.join(projectPath, '.gitlab-ci.yml'))) return 'GitLab CI';
  if (fs.existsSync(path.join(projectPath, 'Jenkinsfile'))) return 'Jenkins';
  if (fs.existsSync(path.join(projectPath, '.circleci'))) return 'CircleCI';
  if (fs.existsSync(path.join(projectPath, '.travis.yml'))) return 'Travis CI';
  if (fs.existsSync(path.join(projectPath, 'azure-pipelines.yml'))) return 'Azure Pipelines';
  if (fs.existsSync(path.join(projectPath, 'cloudbuild.yaml')) || fs.existsSync(path.join(projectPath, 'cloudbuild.json'))) return 'Google Cloud Build';
  return null;
}

function calculateCodeMetrics(projectPath: string): CodeMetrics {
  let totalFiles = 0;
  let totalLines = 0;
  let totalComments = 0;
  let largestFile: { path: string; lines: number } | null = null;
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.java', '.go', '.rs'];

  function scanDir(dir: string, depth = 0) {
    if (depth > 10 || !fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', '.venv', 'venv', '__pycache__'].includes(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { scanDir(fullPath, depth + 1); continue; }
        const ext = path.extname(entry.name).toLowerCase();
        if (!extensions.includes(ext)) continue;
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 500000) continue;
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n').length;
          totalFiles++;
          totalLines += lines;
          const commentLines = (content.match(/\/\/.*|\/\*[\s\S]*?\*\/|#.*/g) || []).length;
          totalComments += commentLines;
          if (!largestFile || lines > largestFile.lines) {
            largestFile = { path: fullPath.replace(projectPath, ''), lines };
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  scanDir(projectPath);
  return {
    totalFiles, totalLines,
    avgFileSize: totalFiles > 0 ? Math.round(totalLines / totalFiles) : 0,
    largestFile,
    commentRatio: totalLines > 0 ? Math.round((totalComments / totalLines) * 100) : 0,
  };
}

function analyzePythonQuality(projectPath: string): PythonQuality | null {
  const pyprojectFiles = findFilesRecursive(projectPath, 'pyproject.toml', 3);
  const requirementsFiles = findFilesRecursive(projectPath, 'requirements.txt', 3);
  if (pyprojectFiles.length === 0 && requirementsFiles.length === 0) return null;

  let hasRuff = false, hasBlack = false, hasMypy = false, hasPytest = false, hasAlembic = false;
  let pythonVersion: string | null = null;
  const dependencies: string[] = [];

  for (const f of pyprojectFiles) {
    try {
      const content = fs.readFileSync(f, 'utf-8');
      if (content.includes('[tool.ruff]') || content.includes('ruff')) hasRuff = true;
      if (content.includes('black')) hasBlack = true;
      if (content.includes('mypy')) hasMypy = true;
      if (content.includes('pytest')) hasPytest = true;
      const pvMatch = content.match(/python_requires\s*=\s*['"](.*?)['"]/);
      if (pvMatch) pythonVersion = pvMatch[1];
      // Extract dependencies
      const depsMatch = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depsMatch) {
        const deps = depsMatch[1].match(/["']([^"']+)["']/g);
        if (deps) dependencies.push(...deps.map(d => d.replace(/["']/g, '').split(/[><=]/)[0].trim()));
      }
    } catch { /* ignore */ }
  }

  for (const f of requirementsFiles) {
    try {
      const content = fs.readFileSync(f, 'utf-8');
      if (content.includes('ruff')) hasRuff = true;
      if (content.includes('black')) hasBlack = true;
      if (content.includes('mypy')) hasMypy = true;
      if (content.includes('pytest')) hasPytest = true;
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      dependencies.push(...lines.map(l => l.split(/[><=]/)[0].trim()));
    } catch { /* ignore */ }
  }

  hasAlembic = hasFileAnywhere(projectPath, 'alembic.ini');

  return {
    hasPyproject: pyprojectFiles.length > 0,
    hasRequirements: requirementsFiles.length > 0,
    hasRuff, hasBlack, hasMypy, hasPytest, hasAlembic,
    pythonVersion,
    dependencies: [...new Set(dependencies)],
  };
}

function checkVulnerabilities(projectPath: string): VulnerabilityInfo | null {
  const packageLockPath = path.join(projectPath, 'package-lock.json');
  if (!fs.existsSync(packageLockPath)) return null;
  try {
    const result = execSync('npm audit --json 2>/dev/null', { cwd: projectPath, encoding: 'utf-8', timeout: 30000 });
    const audit = JSON.parse(result);
    const metadata = audit.metadata?.vulnerabilities || {};
    return { total: metadata.total || 0, critical: metadata.critical || 0, high: metadata.high || 0, moderate: metadata.moderate || 0, low: metadata.low || 0 };
  } catch { return null; }
}

// Async version kept for future use but not currently called
// async function analyzeTestCoverageWithIntelligenceAsync(
//   projectPath: string,
//   testFiles: string[],
//   testFrameworks: string[],
//   codeMetrics: CodeMetrics
// ): Promise<TestCoverageAnalysis> {
//   try {
//     const intelligence = await analyzeCoverageIntelligenceSync(projectPath, testFiles);
//     return convertToLegacyFormat(intelligence, testFrameworks);
//   } catch (err) {
//     console.error('Coverage Intelligence failed, falling back to legacy:', err);
//     return analyzeTestCoverageLegacy(projectPath, testFiles, testFrameworks, codeMetrics);
//   }
// }

function analyzeTestCoverageWithIntelligence(
  projectPath: string,
  testFiles: string[],
  testFrameworks: string[],
  codeMetrics: CodeMetrics
): TestCoverageAnalysis {
  // Try sync Coverage Intelligence first
  try {
    const intelligence = analyzeCoverageIntelligenceSync(projectPath, testFiles);
    const result = convertToLegacyFormat(intelligence, testFrameworks);
    return result;
  } catch (err) {
    console.error('Coverage Intelligence sync failed, falling back to legacy:', err);
  }
  
  // Fallback to legacy analysis
  const legacy = analyzeTestCoverageLegacy(projectPath, testFiles, testFrameworks, codeMetrics);
  
  // Mark as proxy since we couldn't use intelligence
  legacy.coverageIntelligence = undefined;
  
  return legacy;
}

function analyzeTestCoverageLegacy(
  projectPath: string,
  testFiles: string[],
  testFrameworks: string[],
  codeMetrics: CodeMetrics
): TestCoverageAnalysis {
  const recommendations: string[] = [];
  
  // Calculate test file ratio
  const testFileCount = testFiles.length;
  const testFileRatio = codeMetrics.totalFiles > 0 
    ? Math.round((testFileCount / codeMetrics.totalFiles) * 100) / 100 
    : 0;

  // Calculate test line count
  let testLineCount = 0;
  for (const tf of testFiles) {
    try {
      if (fs.statSync(tf).isFile()) {
        const content = fs.readFileSync(tf, 'utf-8');
        testLineCount += content.split('\n').length;
      }
    } catch { /* ignore */ }
  }
  const testLineRatio = codeMetrics.totalLines > 0 
    ? Math.round((testLineCount / codeMetrics.totalLines) * 100) / 100 
    : 0;

  // Classify test types
  const testTypes = { unit: 0, integration: 0, e2e: 0 };
  for (const tf of testFiles) {
    const name = tf.toLowerCase();
    if (name.includes('e2e') || name.includes('playwright') || name.includes('cypress') || name.includes('selenium')) {
      testTypes.e2e++;
    } else if (name.includes('integration') || name.includes('api_test') || name.includes('api.test')) {
      testTypes.integration++;
    } else {
      testTypes.unit++;
    }
  }

  // Detect coverage tools
  const coverageTools: string[] = [];
  const allDeps = collectAllDependencies(projectPath);
  if (allDeps.has('pytest-cov') || hasFileAnywhere(projectPath, '.coveragerc') || hasFileAnywhere(projectPath, 'coverage.py')) {
    coverageTools.push('pytest-cov');
  }
  if (allDeps.has('nyc') || allDeps.has('c8')) coverageTools.push('nyc/c8');
  if (allDeps.has('@vitest/coverage-v8') || allDeps.has('@vitest/coverage-istanbul')) coverageTools.push('vitest-coverage');
  if (hasFileAnywhere(projectPath, 'jest.config.js') || hasFileAnywhere(projectPath, 'jest.config.ts')) {
    try {
      const jestConfigs = findFilesRecursive(projectPath, 'jest.config.js', 3);
      for (const jc of jestConfigs) {
        const content = fs.readFileSync(jc, 'utf-8');
        if (content.includes('coverage') || content.includes('collectCoverage')) {
          coverageTools.push('jest-coverage');
          break;
        }
      }
    } catch { /* ignore */ }
  }
  // Check pyproject.toml for coverage config
  const pyprojectFiles = findFilesRecursive(projectPath, 'pyproject.toml', 3);
  for (const f of pyprojectFiles) {
    try {
      const content = fs.readFileSync(f, 'utf-8');
      if (content.includes('pytest-cov') || content.includes('[tool.coverage]')) {
        if (!coverageTools.includes('pytest-cov')) coverageTools.push('pytest-cov');
      }
    } catch { /* ignore */ }
  }

  // Analyze module-level test coverage
  const moduleTestCoverage = analyzeModuleTestCoverage(projectPath, testFiles);

  // Detect test patterns (fixtures, mocks, factories, snapshots)
  const testPatterns = { fixtures: 0, mocks: 0, factories: 0, snapshots: 0 };
  for (const tf of testFiles) {
    try {
      if (!fs.statSync(tf).isFile()) continue;
      const content = fs.readFileSync(tf, 'utf-8').toLowerCase();
      if (content.includes('fixture') || content.includes('conftest') || content.includes('beforeeach') || content.includes('beforeall')) {
        testPatterns.fixtures++;
      }
      if (content.includes('mock') || content.includes('jest.fn') || content.includes('patch') || content.includes('mocker')) {
        testPatterns.mocks++;
      }
      if (content.includes('factory') || content.includes('faker') || content.includes('factoryboy')) {
        testPatterns.factories++;
      }
      if (content.includes('snapshot') || content.includes('tomatchsnapshot') || content.includes('tomatchinlinesnapshot')) {
        testPatterns.snapshots++;
      }
    } catch { /* ignore */ }
  }

  // Calculate test quality score (0-100)
  let testQualityScore = 0;
  // Test file ratio (max 25 points)
  testQualityScore += Math.min(testFileRatio * 100, 25);
  // Test frameworks (max 15 points)
  testQualityScore += Math.min(testFrameworks.length * 5, 15);
  // Coverage tools (max 15 points)
  testQualityScore += coverageTools.length > 0 ? 15 : 0;
  // Test types diversity (max 15 points)
  const typesUsed = [testTypes.unit, testTypes.integration, testTypes.e2e].filter(t => t > 0).length;
  testQualityScore += typesUsed * 5;
  // Test patterns (max 20 points)
  const patternsUsed = [testPatterns.fixtures, testPatterns.mocks, testPatterns.factories].filter(p => p > 0).length;
  testQualityScore += patternsUsed * 6 + (testPatterns.snapshots > 0 ? 2 : 0);
  // Module coverage (max 10 points)
  const goodModules = moduleTestCoverage.filter(m => m.status === 'good').length;
  const totalModules = moduleTestCoverage.length;
  testQualityScore += totalModules > 0 ? Math.round((goodModules / totalModules) * 10) : 0;

  testQualityScore = Math.min(Math.round(testQualityScore), 100);

  // Generate recommendations
  if (testFileRatio < 0.1) {
    recommendations.push(`测试文件比例过低 (${Math.round(testFileRatio * 100)}%)，建议达到 15-20%`);
  }
  if (coverageTools.length === 0) {
    recommendations.push('未配置覆盖率工具，建议添加 pytest-cov 或 jest --coverage');
  }
  if (testTypes.integration === 0 && testTypes.e2e === 0) {
    recommendations.push('缺少集成测试和 E2E 测试，建议补充 API 级别测试');
  }
  if (testPatterns.mocks === 0) {
    recommendations.push('未检测到 Mock 使用，建议为外部依赖添加 Mock');
  }
  if (testPatterns.factories === 0 && testFileCount > 5) {
    recommendations.push('未检测到测试数据工厂，建议使用 Factory Boy 或 Faker');
  }
  const criticalModules = moduleTestCoverage.filter(m => m.status === 'critical');
  if (criticalModules.length > 0) {
    recommendations.push(`${criticalModules.length} 个核心模块缺少测试: ${criticalModules.slice(0, 3).map(m => m.module).join(', ')}`);
  }

  return {
    testFileCount,
    testFileRatio,
    testLineCount,
    testLineRatio,
    testFrameworks,
    testTypes,
    coverageConfigured: coverageTools.length > 0,
    coverageTools,
    moduleTestCoverage,
    testPatterns,
    testQualityScore,
    recommendations,
  };
}

function analyzeModuleTestCoverage(projectPath: string, testFiles: string[]): ModuleTestCoverage[] {
  const modules: ModuleTestCoverage[] = [];
  const codeExtensions = ['.py', '.ts', '.tsx', '.js', '.jsx'];
  const ignoreDirs = ['node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.git', 'tests', 'test', '__tests__'];

  // Find top-level source directories
  const sourceDirs: string[] = [];
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoreDirs.includes(entry.name) || entry.name.startsWith('.')) continue;
      const dirPath = path.join(projectPath, entry.name);
      // Check if it contains source files
      try {
        const files = fs.readdirSync(dirPath);
        const hasSource = files.some(f => codeExtensions.some(ext => f.endsWith(ext)));
        if (hasSource || ['src', 'app', 'lib', 'crm', 'api', 'agents', 'services'].includes(entry.name)) {
          sourceDirs.push(entry.name);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  // For each source directory, count source files and matching test files
  for (const dir of sourceDirs) {
    const dirPath = path.join(projectPath, dir);
    let sourceFiles = 0;
    let matchingTests = 0;

    // Count source files
    function countSourceFiles(d: string, depth = 0) {
      if (depth > 5) return;
      try {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
          if (ignoreDirs.includes(entry.name) || entry.name.startsWith('.')) continue;
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory()) {
            countSourceFiles(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (codeExtensions.includes(ext) && !entry.name.includes('.test.') && !entry.name.includes('_test.') && !entry.name.startsWith('test_')) {
              sourceFiles++;
            }
          }
        }
      } catch { /* ignore */ }
    }
    countSourceFiles(dirPath);

    // Count test files that reference this module
    for (const tf of testFiles) {
      const testName = path.basename(tf).toLowerCase();
      const testContent = (() => {
        try { return fs.readFileSync(tf, 'utf-8').toLowerCase(); } catch { return ''; }
      })();
      if (testName.includes(dir.toLowerCase()) || testContent.includes(`from ${dir}`) || testContent.includes(`import { `) && testContent.includes(dir)) {
        matchingTests++;
      }
    }

    const ratio = sourceFiles > 0 ? Math.round((matchingTests / sourceFiles) * 100) / 100 : 0;
    let status: 'good' | 'warning' | 'critical' = 'good';
    if (ratio < 0.05) status = 'critical';
    else if (ratio < 0.15) status = 'warning';

    if (sourceFiles > 0) {
      modules.push({ module: dir, sourceFiles, testFiles: matchingTests, ratio, status });
    }
  }

  return modules.sort((a, b) => a.ratio - b.ratio);
}
