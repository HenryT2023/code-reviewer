import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { glob } from 'glob';

export interface QualityAnalysis {
  hasTests: boolean;
  testFiles: string[];
  testFramework: string | null;
  testFrameworks: string[];
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

  return {
    hasTests: testFiles.length > 0,
    testFiles: testFiles.slice(0, 30),
    testFramework: testFrameworks[0] || null,
    testFrameworks,
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
              name.includes('.test.') || name.includes('_spec.')) {
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
