import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface ProjectStructure {
  name: string;
  path: string;
  directories: DirectoryInfo[];
  totalFiles: number;
  totalLines: number;
  languages: Record<string, number>;
  modules: ModuleInfo[];
  isMonorepo: boolean;
  subServices: SubServiceInfo[];
}

export interface DirectoryInfo {
  name: string;
  path: string;
  fileCount: number;
  type: 'backend' | 'frontend' | 'config' | 'docs' | 'other';
}

export interface ModuleInfo {
  name: string;
  path: string;
  files: string[];
  type: string;
}

export interface SubServiceInfo {
  name: string;
  path: string;
  type: 'python-fastapi' | 'python-flask' | 'python-django' | 'node-express' | 'node-nestjs' | 'react' | 'vue' | 'static' | 'unknown';
  language: 'python' | 'typescript' | 'javascript' | 'mixed' | 'unknown';
  fileCount: number;
  hasTests: boolean;
  entryPoints: string[];
  keyFiles: string[];
}

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv', 'venv', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'htmlcov', 'egg-info'];
const IGNORE_FILES = ['.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

export async function analyzeStructure(projectPath: string): Promise<ProjectStructure> {
  const projectName = path.basename(projectPath);
  const directories: DirectoryInfo[] = [];
  const languages: Record<string, number> = {};
  const modules: ModuleInfo[] = [];
  let totalFiles = 0;
  let totalLines = 0;

  // Detect monorepo
  const subServices = await detectMonorepoServices(projectPath);
  const isMonorepo = subServices.length > 0;

  const topLevelDirs = fs.readdirSync(projectPath, { withFileTypes: true })
    .filter(d => d.isDirectory() && !IGNORE_DIRS.includes(d.name));

  for (const dir of topLevelDirs) {
    const dirPath = path.join(projectPath, dir.name);
    const files = await glob('**/*', {
      cwd: dirPath,
      nodir: true,
      ignore: IGNORE_DIRS.map(d => `**/${d}/**`),
    });

    const validFiles = files.filter(f => !IGNORE_FILES.includes(path.basename(f)));
    const fileCount = validFiles.length;
    totalFiles += fileCount;

    const dirType = detectDirType(dir.name, validFiles);
    directories.push({
      name: dir.name,
      path: dirPath,
      fileCount,
      type: dirType,
    });

    for (const file of validFiles) {
      const ext = path.extname(file).toLowerCase();
      if (ext) {
        languages[ext] = (languages[ext] || 0) + 1;
      }

      const filePath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < 500000) { // skip files > 500KB
          const content = fs.readFileSync(filePath, 'utf-8');
          totalLines += content.split('\n').length;
        }
      } catch {
        // Skip binary files
      }
    }

    // Detect modules in various patterns
    const detectedModules = await detectModules(dirPath, dir.name);
    modules.push(...detectedModules);
  }

  return {
    name: projectName,
    path: projectPath,
    directories,
    totalFiles,
    totalLines,
    languages,
    modules,
    isMonorepo,
    subServices,
  };
}

async function detectMonorepoServices(projectPath: string): Promise<SubServiceInfo[]> {
  const services: SubServiceInfo[] = [];
  const servicesDirs = ['services', 'packages', 'apps', 'modules'];

  for (const servicesDir of servicesDirs) {
    const servicesDirPath = path.join(projectPath, servicesDir);
    if (!fs.existsSync(servicesDirPath)) continue;

    const subDirs = fs.readdirSync(servicesDirPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !IGNORE_DIRS.includes(d.name));

    for (const subDir of subDirs) {
      const subPath = path.join(servicesDirPath, subDir.name);
      const info = await analyzeSubService(subPath, subDir.name);
      services.push(info);
    }
  }

  return services;
}

async function analyzeSubService(servicePath: string, name: string): Promise<SubServiceInfo> {
  const hasPyproject = fs.existsSync(path.join(servicePath, 'pyproject.toml'));
  const hasRequirements = fs.existsSync(path.join(servicePath, 'requirements.txt'));
  const hasPackageJson = fs.existsSync(path.join(servicePath, 'package.json'));
  const hasMainPy = fs.existsSync(path.join(servicePath, 'main.py')) || fs.existsSync(path.join(servicePath, 'app/main.py'));

  // Count files
  let fileCount = 0;
  try {
    const files = await glob('**/*.{py,ts,tsx,js,jsx,vue}', {
      cwd: servicePath,
      ignore: IGNORE_DIRS.map(d => `**/${d}/**`),
    });
    fileCount = files.length;
  } catch { /* ignore */ }

  // Detect type
  let type: SubServiceInfo['type'] = 'unknown';
  let language: SubServiceInfo['language'] = 'unknown';
  const keyFiles: string[] = [];
  const entryPoints: string[] = [];

  if (hasPyproject || hasRequirements || hasMainPy) {
    language = 'python';
    type = await detectPythonFramework(servicePath);
    // Find entry points
    for (const ep of ['main.py', 'app/main.py', 'app/__init__.py', 'manage.py', 'wsgi.py']) {
      if (fs.existsSync(path.join(servicePath, ep))) entryPoints.push(ep);
    }
    // Key files
    for (const kf of ['pyproject.toml', 'requirements.txt', 'alembic.ini', 'Dockerfile']) {
      if (fs.existsSync(path.join(servicePath, kf))) keyFiles.push(kf);
    }
  } else if (hasPackageJson) {
    const pkgContent = readJsonSafe(path.join(servicePath, 'package.json'));
    const allDeps = { ...pkgContent.dependencies, ...pkgContent.devDependencies };
    
    if ('react' in allDeps || 'next' in allDeps) {
      language = 'typescript';
      type = 'react';
    } else if ('vue' in allDeps || 'nuxt' in allDeps) {
      language = 'typescript';
      type = 'vue';
    } else if ('@nestjs/core' in allDeps) {
      language = 'typescript';
      type = 'node-nestjs';
    } else if ('express' in allDeps || 'fastify' in allDeps || 'koa' in allDeps) {
      language = 'typescript';
      type = 'node-express';
    } else {
      language = 'typescript';
      type = 'unknown';
    }
    keyFiles.push('package.json');
    if (fs.existsSync(path.join(servicePath, 'tsconfig.json'))) keyFiles.push('tsconfig.json');
    if (fs.existsSync(path.join(servicePath, 'vite.config.ts'))) keyFiles.push('vite.config.ts');
  }

  // Has tests?
  const hasTests = fs.existsSync(path.join(servicePath, 'tests')) ||
    fs.existsSync(path.join(servicePath, '__tests__')) ||
    fs.existsSync(path.join(servicePath, 'test')) ||
    fs.existsSync(path.join(servicePath, 'src/__tests__'));

  return { name, path: servicePath, type, language, fileCount, hasTests, entryPoints, keyFiles };
}

async function detectPythonFramework(servicePath: string): Promise<SubServiceInfo['type']> {
  // Check pyproject.toml or requirements.txt for framework
  for (const depFile of ['pyproject.toml', 'requirements.txt']) {
    const filePath = path.join(servicePath, depFile);
    if (!fs.existsSync(filePath)) continue;
    try {
      const content = fs.readFileSync(filePath, 'utf-8').toLowerCase();
      if (content.includes('fastapi')) return 'python-fastapi';
      if (content.includes('flask')) return 'python-flask';
      if (content.includes('django')) return 'python-django';
    } catch { /* ignore */ }
  }

  // Scan source files for framework imports
  try {
    const pyFiles = await glob('**/*.py', {
      cwd: servicePath,
      ignore: IGNORE_DIRS.map(d => `**/${d}/**`),
    });
    for (const f of pyFiles.slice(0, 20)) {
      try {
        const content = fs.readFileSync(path.join(servicePath, f), 'utf-8');
        if (content.includes('from fastapi') || content.includes('import fastapi')) return 'python-fastapi';
        if (content.includes('from flask') || content.includes('import flask')) return 'python-flask';
        if (content.includes('from django') || content.includes('import django')) return 'python-django';
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }

  return 'unknown';
}

async function detectModules(dirPath: string, dirName: string): Promise<ModuleInfo[]> {
  const modules: ModuleInfo[] = [];

  // NestJS-style: src/modules/xxx
  const nestModulesPath = path.join(dirPath, 'src', 'modules');
  if (fs.existsSync(nestModulesPath)) {
    const moduleDirs = fs.readdirSync(nestModulesPath, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const moduleDir of moduleDirs) {
      const modulePath = path.join(nestModulesPath, moduleDir.name);
      const files = fs.readdirSync(modulePath).filter(f => f.endsWith('.ts') || f.endsWith('.js'));
      modules.push({ name: moduleDir.name, path: modulePath, files, type: detectModuleType(moduleDir.name, files) });
    }
  }

  // FastAPI-style: app/api/xxx.py
  const fastapiApiPath = path.join(dirPath, 'app', 'api');
  if (fs.existsSync(fastapiApiPath)) {
    try {
      const apiFiles = fs.readdirSync(fastapiApiPath).filter(f => f.endsWith('.py') && f !== '__init__.py');
      for (const f of apiFiles) {
        const modName = path.basename(f, '.py');
        modules.push({ name: modName, path: path.join(fastapiApiPath, f), files: [f], type: detectModuleType(modName, [f]) });
      }
    } catch { /* ignore */ }
  }

  // Python-style: src/xxx/ directories with __init__.py
  const srcPath = path.join(dirPath, 'src');
  if (fs.existsSync(srcPath)) {
    try {
      const srcDirs = fs.readdirSync(srcPath, { withFileTypes: true }).filter(d => d.isDirectory() && !IGNORE_DIRS.includes(d.name));
      for (const sd of srcDirs) {
        const sdPath = path.join(srcPath, sd.name);
        if (fs.existsSync(path.join(sdPath, '__init__.py'))) {
          const files = fs.readdirSync(sdPath).filter(f => f.endsWith('.py'));
          modules.push({ name: sd.name, path: sdPath, files, type: detectModuleType(sd.name, files) });
        }
      }
    } catch { /* ignore */ }
  }

  return modules;
}

function detectDirType(name: string, files: string[]): DirectoryInfo['type'] {
  const lowerName = name.toLowerCase();
  if (['backend', 'server', 'api', 'src'].includes(lowerName)) return 'backend';
  if (['frontend', 'web', 'client', 'admin-web', 'user-h5', 'b2b-h5'].includes(lowerName)) return 'frontend';
  if (['docs', 'documentation', 'specs'].includes(lowerName)) return 'docs';
  if (['contracts', 'schemas', 'proto'].includes(lowerName)) return 'config';
  if (['services', 'packages', 'apps'].includes(lowerName)) return 'backend';
  if (files.some(f => f.includes('config') || f.endsWith('.json'))) return 'config';
  return 'other';
}

function detectModuleType(name: string, files: string[]): string {
  if (name.includes('auth')) return 'authentication';
  if (name.includes('order')) return 'order-management';
  if (name.includes('catalog') || name.includes('product') || name.includes('sku')) return 'product-catalog';
  if (name.includes('customer') || name.includes('user') || name.includes('merchant')) return 'user-management';
  if (name.includes('wms') || name.includes('inventory')) return 'warehouse';
  if (name.includes('erp')) return 'erp';
  if (name.includes('crm')) return 'crm';
  if (name.includes('payment') || name.includes('billing')) return 'payment';
  if (name.includes('trace')) return 'traceability';
  if (name.includes('event')) return 'event-system';
  if (name.includes('task')) return 'task-management';
  if (name.includes('transfer')) return 'transfer-management';
  if (name.includes('loading')) return 'logistics';
  if (name.includes('agent')) return 'ai-agent';
  if (name.includes('health')) return 'health-check';
  return 'general';
}

function readJsonSafe(filePath: string): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}
