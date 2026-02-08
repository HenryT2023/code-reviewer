import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface QualityAnalysis {
  hasTests: boolean;
  testFiles: string[];
  testFramework: string | null;
  hasLinter: boolean;
  linterType: string | null;
  hasTypeScript: boolean;
  hasPrettier: boolean;
  hasCI: boolean;
  ciPlatform: string | null;
  hasDocumentation: boolean;
  readmeExists: boolean;
  changelogExists: boolean;
  licenseExists: boolean;
  dependencyCount: number;
  devDependencyCount: number;
  outdatedDependencies: number;
  vulnerabilities: VulnerabilityInfo | null;
  codeMetrics: CodeMetrics;
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

export function analyzeCodeQuality(projectPath: string): QualityAnalysis {
  const packageJsonPath = path.join(projectPath, 'package.json');
  let packageJson: Record<string, unknown> = {};
  
  if (fs.existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    } catch {
      // ignore
    }
  }

  const deps = packageJson.dependencies as Record<string, string> || {};
  const devDeps = packageJson.devDependencies as Record<string, string> || {};
  const allDeps = { ...deps, ...devDeps };

  const testFiles = findTestFiles(projectPath);
  const testFramework = detectTestFramework(allDeps);
  const linterType = detectLinter(allDeps, projectPath);
  const ciPlatform = detectCI(projectPath);
  const codeMetrics = calculateCodeMetrics(projectPath);
  const vulnerabilities = checkVulnerabilities(projectPath);

  return {
    hasTests: testFiles.length > 0,
    testFiles: testFiles.slice(0, 20),
    testFramework,
    hasLinter: linterType !== null,
    linterType,
    hasTypeScript: 'typescript' in allDeps || fs.existsSync(path.join(projectPath, 'tsconfig.json')),
    hasPrettier: 'prettier' in allDeps || fs.existsSync(path.join(projectPath, '.prettierrc')),
    hasCI: ciPlatform !== null,
    ciPlatform,
    hasDocumentation: fs.existsSync(path.join(projectPath, 'docs')) || fs.existsSync(path.join(projectPath, 'documentation')),
    readmeExists: fs.existsSync(path.join(projectPath, 'README.md')) || fs.existsSync(path.join(projectPath, 'readme.md')),
    changelogExists: fs.existsSync(path.join(projectPath, 'CHANGELOG.md')) || fs.existsSync(path.join(projectPath, 'changelog.md')),
    licenseExists: fs.existsSync(path.join(projectPath, 'LICENSE')) || fs.existsSync(path.join(projectPath, 'LICENSE.md')),
    dependencyCount: Object.keys(deps).length,
    devDependencyCount: Object.keys(devDeps).length,
    outdatedDependencies: 0,
    vulnerabilities,
    codeMetrics,
  };
}

function findTestFiles(projectPath: string): string[] {
  const testPatterns = ['test', 'tests', 'spec', 'specs', '__tests__'];
  const testFiles: string[] = [];

  function scanDir(dir: string, depth = 0) {
    if (depth > 5) return;
    if (!fs.existsSync(dir)) return;
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (testPatterns.includes(entry.name.toLowerCase())) {
            testFiles.push(fullPath);
          }
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const name = entry.name.toLowerCase();
          if (name.includes('.test.') || name.includes('.spec.') || name.endsWith('_test.ts') || name.endsWith('_test.js')) {
            testFiles.push(fullPath);
          }
        }
      }
    } catch {
      // ignore
    }
  }

  scanDir(projectPath);
  return testFiles;
}

function detectTestFramework(deps: Record<string, string>): string | null {
  if ('jest' in deps) return 'Jest';
  if ('mocha' in deps) return 'Mocha';
  if ('vitest' in deps) return 'Vitest';
  if ('ava' in deps) return 'AVA';
  if ('jasmine' in deps) return 'Jasmine';
  if ('@testing-library/react' in deps) return 'React Testing Library';
  if ('cypress' in deps) return 'Cypress';
  if ('playwright' in deps || '@playwright/test' in deps) return 'Playwright';
  return null;
}

function detectLinter(deps: Record<string, string>, projectPath: string): string | null {
  if ('eslint' in deps || fs.existsSync(path.join(projectPath, '.eslintrc.js')) || fs.existsSync(path.join(projectPath, '.eslintrc.json'))) {
    return 'ESLint';
  }
  if ('tslint' in deps) return 'TSLint';
  if ('biome' in deps || '@biomejs/biome' in deps) return 'Biome';
  if ('oxlint' in deps) return 'OxLint';
  return null;
}

function detectCI(projectPath: string): string | null {
  if (fs.existsSync(path.join(projectPath, '.github/workflows'))) return 'GitHub Actions';
  if (fs.existsSync(path.join(projectPath, '.gitlab-ci.yml'))) return 'GitLab CI';
  if (fs.existsSync(path.join(projectPath, 'Jenkinsfile'))) return 'Jenkins';
  if (fs.existsSync(path.join(projectPath, '.circleci'))) return 'CircleCI';
  if (fs.existsSync(path.join(projectPath, '.travis.yml'))) return 'Travis CI';
  if (fs.existsSync(path.join(projectPath, 'azure-pipelines.yml'))) return 'Azure Pipelines';
  return null;
}

function calculateCodeMetrics(projectPath: string): CodeMetrics {
  let totalFiles = 0;
  let totalLines = 0;
  let totalComments = 0;
  let largestFile: { path: string; lines: number } | null = null;

  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.vue', '.py', '.java', '.go', '.rs'];

  function scanDir(dir: string, depth = 0) {
    if (depth > 10) return;
    if (!fs.existsSync(dir)) return;
    
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') continue;
        
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n').length;
              totalFiles++;
              totalLines += lines;
              
              const commentLines = (content.match(/\/\/.*|\/\*[\s\S]*?\*\/|#.*/g) || []).length;
              totalComments += commentLines;
              
              if (!largestFile || lines > largestFile.lines) {
                largestFile = { path: fullPath.replace(projectPath, ''), lines };
              }
            } catch {
              // ignore
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  scanDir(projectPath);

  return {
    totalFiles,
    totalLines,
    avgFileSize: totalFiles > 0 ? Math.round(totalLines / totalFiles) : 0,
    largestFile,
    commentRatio: totalLines > 0 ? Math.round((totalComments / totalLines) * 100) : 0,
  };
}

function checkVulnerabilities(projectPath: string): VulnerabilityInfo | null {
  const packageLockPath = path.join(projectPath, 'package-lock.json');
  if (!fs.existsSync(packageLockPath)) return null;

  try {
    const result = execSync('npm audit --json 2>/dev/null', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 30000,
    });
    
    const audit = JSON.parse(result);
    const metadata = audit.metadata?.vulnerabilities || {};
    
    return {
      total: metadata.total || 0,
      critical: metadata.critical || 0,
      high: metadata.high || 0,
      moderate: metadata.moderate || 0,
      low: metadata.low || 0,
    };
  } catch {
    return null;
  }
}
