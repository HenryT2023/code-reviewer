/**
 * Module Graph Builder
 * 构建项目的模块树，支持多种语言和 monorepo
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ModuleNode, ModuleMetrics, ProjectType, Language, DEFAULT_CONFIG } from './types';
import { normalizeModuleKey } from './module-key';

// ─── Project Type Detection ──────────────────────────────────────────────────

export function detectProjectType(projectPath: string): ProjectType {
  // Check for monorepo first
  const packageJson = readJsonSafe(path.join(projectPath, 'package.json'));
  if (packageJson?.workspaces) {
    if (fs.existsSync(path.join(projectPath, 'pnpm-workspace.yaml'))) return 'monorepo-pnpm';
    if (fs.existsSync(path.join(projectPath, 'yarn.lock'))) return 'monorepo-yarn';
    return 'monorepo-npm';
  }
  if (fs.existsSync(path.join(projectPath, 'nx.json'))) return 'monorepo-nx';
  if (fs.existsSync(path.join(projectPath, 'turbo.json'))) return 'monorepo-turbo';

  // Check for Python
  if (fs.existsSync(path.join(projectPath, 'pyproject.toml')) || 
      fs.existsSync(path.join(projectPath, 'setup.py'))) {
    const pyproject = readFileSafe(path.join(projectPath, 'pyproject.toml'));
    if (pyproject.includes('fastapi')) return 'python-fastapi';
    if (pyproject.includes('django')) return 'python-django';
    return 'python';
  }

  // Check for Java
  if (fs.existsSync(path.join(projectPath, 'pom.xml')) || 
      fs.existsSync(path.join(projectPath, 'build.gradle'))) {
    const buildFile = readFileSafe(path.join(projectPath, 'pom.xml')) || 
                      readFileSafe(path.join(projectPath, 'build.gradle'));
    if (buildFile.includes('spring')) return 'java-spring';
    return 'java';
  }

  // Check for Node/TypeScript
  if (packageJson) {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (deps?.next) return 'node-nextjs';
    if (deps?.react) return 'node-react';
    if (deps?.express) return 'node-express';
    if (fs.existsSync(path.join(projectPath, 'tsconfig.json'))) return 'typescript';
    return 'node';
  }

  return 'unknown';
}

export function detectLanguage(filePath: string): Language {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.py': return 'python';
    case '.ts': case '.tsx': return 'typescript';
    case '.js': case '.jsx': case '.mjs': return 'javascript';
    case '.java': return 'java';
    case '.go': return 'go';
    case '.rs': return 'rust';
    default: return 'unknown';
  }
}

// ─── Module Graph Building ───────────────────────────────────────────────────

export async function buildModuleGraph(
  projectPath: string,
  testFiles: string[] = []
): Promise<ModuleNode[]> {
  const projectType = detectProjectType(projectPath);
  
  switch (projectType) {
    case 'python':
    case 'python-fastapi':
    case 'python-django':
      return buildPythonModuleGraph(projectPath, testFiles);
    
    case 'node':
    case 'node-react':
    case 'node-nextjs':
    case 'node-express':
    case 'typescript':
      return buildNodeModuleGraph(projectPath, testFiles);
    
    case 'monorepo-pnpm':
    case 'monorepo-yarn':
    case 'monorepo-npm':
    case 'monorepo-nx':
    case 'monorepo-turbo':
      return buildMonorepoGraph(projectPath, testFiles);
    
    case 'java':
    case 'java-spring':
      return buildJavaModuleGraph(projectPath, testFiles);
    
    default:
      return buildFallbackGraph(projectPath, testFiles);
  }
}

// ─── Python Module Graph ─────────────────────────────────────────────────────

function buildPythonModuleGraph(projectPath: string, testFiles: string[]): ModuleNode[] {
  const modules: ModuleNode[] = [];
  const ignoreDirs = ['node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.git', '.mypy_cache', '.pytest_cache', 'htmlcov', 'egg-info'];
  
  // Find Python packages (directories with __init__.py)
  const packages = findPythonPackages(projectPath, ignoreDirs);
  
  // Also check for src/ layout
  const srcDir = path.join(projectPath, 'src');
  if (fs.existsSync(srcDir)) {
    const srcPackages = findPythonPackages(srcDir, ignoreDirs);
    packages.push(...srcPackages.map(p => ({ ...p, path: path.join('src', p.path) })));
  }
  
  // Build module nodes
  for (const pkg of packages) {
    const fullPath = path.join(projectPath, pkg.path);
    const metrics = calculateModuleMetrics(fullPath, testFiles, projectPath);
    
    modules.push({
      name: pkg.name,
      key: normalizeModuleKey(pkg.name),
      path: fullPath,
      relativePath: pkg.path,
      depth: pkg.depth,
      parent: pkg.parent,
      language: 'python',
      metrics,
      criticality: determineCriticality(pkg.name, pkg.path),
      status: determineStatus(metrics),
      children: [],
    });
  }
  
  // Build tree structure
  return buildTreeStructure(modules);
}

function findPythonPackages(
  dir: string,
  ignoreDirs: string[],
  depth = 0,
  parent: string | null = null
): Array<{ name: string; path: string; depth: number; parent: string | null }> {
  const packages: Array<{ name: string; path: string; depth: number; parent: string | null }> = [];
  if (depth > 5) return packages;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoreDirs.includes(entry.name) || entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(dir, entry.name);
      const hasInit = fs.existsSync(path.join(fullPath, '__init__.py'));
      const hasPyFiles = entries.some(e => e.isFile() && e.name.endsWith('.py'));
      
      if (hasInit || hasPyFiles) {
        const relativePath = path.relative(dir, fullPath);
        packages.push({
          name: entry.name,
          path: relativePath,
          depth,
          parent,
        });
        
        // Recursively find sub-packages
        const subPackages = findPythonPackages(fullPath, ignoreDirs, depth + 1, entry.name);
        packages.push(...subPackages.map(p => ({
          ...p,
          path: path.join(relativePath, p.path),
        })));
      }
    }
  } catch { /* ignore */ }
  
  return packages;
}

// ─── Node/TypeScript Module Graph ────────────────────────────────────────────

function buildNodeModuleGraph(projectPath: string, testFiles: string[]): ModuleNode[] {
  const modules: ModuleNode[] = [];
  const ignoreDirs = ['node_modules', 'dist', 'build', '.next', 'coverage', '.git'];
  
  // Check for tsconfig paths
  const tsconfig = readJsonSafe(path.join(projectPath, 'tsconfig.json'));
  const pathAliases = tsconfig?.compilerOptions?.paths || {};
  
  // Find source directories
  const srcDirs = ['src', 'app', 'lib', 'components', 'pages', 'features', 'modules'];
  
  for (const srcDir of srcDirs) {
    const fullPath = path.join(projectPath, srcDir);
    if (!fs.existsSync(fullPath)) continue;
    
    // Add top-level module
    const metrics = calculateModuleMetrics(fullPath, testFiles, projectPath);
    modules.push({
      name: srcDir,
      key: normalizeModuleKey(srcDir),
      path: fullPath,
      relativePath: srcDir,
      depth: 0,
      parent: null,
      language: 'typescript',
      metrics,
      criticality: determineCriticality(srcDir, srcDir),
      status: determineStatus(metrics),
      children: [],
    });
    
    // Find sub-modules
    const subModules = findNodeSubModules(fullPath, ignoreDirs, testFiles, projectPath, 1, srcDir);
    modules.push(...subModules);
  }
  
  return buildTreeStructure(modules);
}

function findNodeSubModules(
  dir: string,
  ignoreDirs: string[],
  testFiles: string[],
  projectPath: string,
  depth: number,
  parent: string
): ModuleNode[] {
  const modules: ModuleNode[] = [];
  if (depth > 4) return modules;
  
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoreDirs.includes(entry.name) || entry.name.startsWith('.')) continue;
      if (['__tests__', 'test', 'tests', '__mocks__'].includes(entry.name)) continue;
      
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(projectPath, fullPath);
      
      // Check if it has source files
      const hasSourceFiles = fs.readdirSync(fullPath).some(f => 
        ['.ts', '.tsx', '.js', '.jsx'].some(ext => f.endsWith(ext))
      );
      
      if (hasSourceFiles) {
        const metrics = calculateModuleMetrics(fullPath, testFiles, projectPath);
        modules.push({
          name: entry.name,
          key: normalizeModuleKey(entry.name),
          path: fullPath,
          relativePath,
          depth,
          parent,
          language: 'typescript',
          metrics,
          criticality: determineCriticality(entry.name, relativePath),
          status: determineStatus(metrics),
          children: [],
        });
        
        // Recursively find sub-modules
        const subModules = findNodeSubModules(fullPath, ignoreDirs, testFiles, projectPath, depth + 1, entry.name);
        modules.push(...subModules);
      }
    }
  } catch { /* ignore */ }
  
  return modules;
}

// ─── Monorepo Graph ──────────────────────────────────────────────────────────

function buildMonorepoGraph(projectPath: string, testFiles: string[]): ModuleNode[] {
  const modules: ModuleNode[] = [];
  
  // Find workspace packages
  const packageJson = readJsonSafe(path.join(projectPath, 'package.json'));
  let workspacePatterns: string[] = [];
  
  if (Array.isArray(packageJson?.workspaces)) {
    workspacePatterns = packageJson.workspaces;
  } else if (packageJson?.workspaces?.packages) {
    workspacePatterns = packageJson.workspaces.packages;
  }
  
  // Also check pnpm-workspace.yaml
  const pnpmWorkspace = readFileSafe(path.join(projectPath, 'pnpm-workspace.yaml'));
  if (pnpmWorkspace) {
    const matches = pnpmWorkspace.match(/- ['"]?([^'"]+)['"]?/g);
    if (matches) {
      workspacePatterns.push(...matches.map(m => m.replace(/- ['"]?/, '').replace(/['"]?$/, '')));
    }
  }
  
  // Resolve workspace patterns to actual directories
  for (const pattern of workspacePatterns) {
    const basePath = pattern.replace(/\/\*$/, '').replace(/\*$/, '');
    const fullBasePath = path.join(projectPath, basePath);
    
    if (!fs.existsSync(fullBasePath)) continue;
    
    try {
      const entries = fs.readdirSync(fullBasePath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        
        const pkgPath = path.join(fullBasePath, entry.name);
        const pkgJson = readJsonSafe(path.join(pkgPath, 'package.json'));
        
        if (pkgJson) {
          const relativePath = path.relative(projectPath, pkgPath);
          const metrics = calculateModuleMetrics(pkgPath, testFiles, projectPath);
          const moduleName = pkgJson.name || entry.name;
          
          modules.push({
            name: moduleName,
            key: normalizeModuleKey(moduleName),
            path: pkgPath,
            relativePath,
            depth: 0,
            parent: null,
            language: fs.existsSync(path.join(pkgPath, 'tsconfig.json')) ? 'typescript' : 'javascript',
            metrics,
            criticality: determineCriticality(entry.name, relativePath),
            status: determineStatus(metrics),
            children: [],
          });
        }
      }
    } catch { /* ignore */ }
  }
  
  return modules;
}

// ─── Java Module Graph ───────────────────────────────────────────────────────

function buildJavaModuleGraph(projectPath: string, testFiles: string[]): ModuleNode[] {
  const modules: ModuleNode[] = [];
  
  // Check for Maven multi-module
  const pomXml = readFileSafe(path.join(projectPath, 'pom.xml'));
  const moduleMatches = pomXml.match(/<module>([^<]+)<\/module>/g);
  
  if (moduleMatches && moduleMatches.length > 0) {
    // Multi-module Maven project
    for (const match of moduleMatches) {
      const moduleName = match.replace(/<\/?module>/g, '');
      const modulePath = path.join(projectPath, moduleName);
      
      if (fs.existsSync(modulePath)) {
        const metrics = calculateModuleMetrics(modulePath, testFiles, projectPath);
        modules.push({
          name: moduleName,
          key: normalizeModuleKey(moduleName),
          path: modulePath,
          relativePath: moduleName,
          depth: 0,
          parent: null,
          language: 'java',
          metrics,
          criticality: determineCriticality(moduleName, moduleName),
          status: determineStatus(metrics),
          children: [],
        });
      }
    }
  } else {
    // Single module - look for src/main/java packages
    const srcMain = path.join(projectPath, 'src', 'main', 'java');
    if (fs.existsSync(srcMain)) {
      const metrics = calculateModuleMetrics(srcMain, testFiles, projectPath);
      modules.push({
        name: 'main',
        key: normalizeModuleKey('main'),
        path: srcMain,
        relativePath: 'src/main/java',
        depth: 0,
        parent: null,
        language: 'java',
        metrics,
        criticality: 'high',
        status: determineStatus(metrics),
        children: [],
      });
    }
  }
  
  return modules;
}

// ─── Fallback Graph ──────────────────────────────────────────────────────────

function buildFallbackGraph(projectPath: string, testFiles: string[]): ModuleNode[] {
  const modules: ModuleNode[] = [];
  const ignoreDirs = ['node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.git', 'test', 'tests', '__tests__'];
  const codeExtensions = ['.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.go', '.rs'];
  
  try {
    const entries = fs.readdirSync(projectPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoreDirs.includes(entry.name) || entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(projectPath, entry.name);
      
      // Check if directory contains source files
      const hasSourceFiles = fs.readdirSync(fullPath).some(f => 
        codeExtensions.some(ext => f.endsWith(ext))
      );
      
      if (hasSourceFiles) {
        const metrics = calculateModuleMetrics(fullPath, testFiles, projectPath);
        modules.push({
          name: entry.name,
          key: normalizeModuleKey(entry.name),
          path: fullPath,
          relativePath: entry.name,
          depth: 0,
          parent: null,
          language: detectPrimaryLanguage(fullPath),
          metrics,
          criticality: determineCriticality(entry.name, entry.name),
          status: determineStatus(metrics),
          children: [],
        });
      }
    }
  } catch { /* ignore */ }
  
  return modules;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function calculateModuleMetrics(
  modulePath: string,
  testFiles: string[],
  projectPath: string
): ModuleMetrics {
  const codeExtensions = ['.py', '.ts', '.tsx', '.js', '.jsx', '.java', '.go', '.rs'];
  const testPatterns = ['.test.', '_test.', '.spec.', '_spec.', 'test_'];
  
  let sourceFiles = 0;
  let sourceLines = 0;
  let testFilesCount = 0;
  let testLines = 0;
  let testCaseCount = 0;
  
  function scanDir(dir: string, depth = 0) {
    if (depth > 10) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || ['node_modules', '__pycache__', '.venv', 'venv'].includes(entry.name)) continue;
        
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          scanDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (!codeExtensions.includes(ext)) continue;
          
          const isTest = testPatterns.some(p => entry.name.includes(p)) || entry.name.startsWith('test_');
          
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n').length;
            
            if (isTest) {
              testFilesCount++;
              testLines += lines;
              // Estimate test cases
              testCaseCount += (content.match(/def test_|it\s*\(|test\s*\(|@Test/g) || []).length;
            } else {
              sourceFiles++;
              sourceLines += lines;
            }
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
  
  scanDir(modulePath);
  
  // Also count test files that reference this module
  const moduleName = path.basename(modulePath).toLowerCase();
  for (const tf of testFiles) {
    if (tf.toLowerCase().includes(moduleName)) {
      // Already counted if inside module, skip
    }
  }
  
  const testFileRatio = sourceFiles > 0 ? testFilesCount / sourceFiles : 0;
  const testToSrcLocRatio = sourceLines > 0 ? testLines / sourceLines : 0;
  
  return {
    sourceFiles,
    sourceLines,
    testFiles: testFilesCount,
    testLines,
    testCaseCount,
    testFileRatio,
    testToSrcLocRatio,
    isProxy: true,
  };
}

function determineCriticality(name: string, relativePath: string): 'high' | 'medium' | 'low' {
  const highPriority = ['core', 'api', 'services', 'agents', 'auth', 'payment', 'billing', 'db', 'models'];
  const lowPriority = ['utils', 'helpers', 'constants', 'types', 'config', 'scripts', 'migrations'];
  
  const nameLower = name.toLowerCase();
  if (highPriority.some(p => nameLower.includes(p))) return 'high';
  if (lowPriority.some(p => nameLower.includes(p))) return 'low';
  return 'medium';
}

function determineStatus(metrics: ModuleMetrics): 'good' | 'warning' | 'critical' {
  if (metrics.testFileRatio >= 0.15) return 'good';
  if (metrics.testFileRatio >= 0.05) return 'warning';
  return 'critical';
}

function buildTreeStructure(modules: ModuleNode[]): ModuleNode[] {
  const rootModules: ModuleNode[] = [];
  const moduleMap = new Map<string, ModuleNode>();
  
  // First pass: create map
  for (const mod of modules) {
    moduleMap.set(mod.name, mod);
  }
  
  // Second pass: build tree
  for (const mod of modules) {
    if (mod.parent && moduleMap.has(mod.parent)) {
      moduleMap.get(mod.parent)!.children.push(mod);
    } else {
      rootModules.push(mod);
    }
  }
  
  return rootModules;
}

function detectPrimaryLanguage(dir: string): Language {
  const counts: Record<Language, number> = {
    python: 0, typescript: 0, javascript: 0, java: 0, go: 0, rust: 0, unknown: 0
  };
  
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const lang = detectLanguage(f);
      counts[lang]++;
    }
  } catch { /* ignore */ }
  
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0][0] as Language;
}

function readFileSafe(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

function readJsonSafe(filePath: string): any {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

export { detectPrimaryLanguage, calculateModuleMetrics, determineStatus, determineCriticality };
