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

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__'];
const IGNORE_FILES = ['.DS_Store', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

export async function analyzeStructure(projectPath: string): Promise<ProjectStructure> {
  const projectName = path.basename(projectPath);
  const directories: DirectoryInfo[] = [];
  const languages: Record<string, number> = {};
  const modules: ModuleInfo[] = [];
  let totalFiles = 0;
  let totalLines = 0;

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
        const content = fs.readFileSync(filePath, 'utf-8');
        totalLines += content.split('\n').length;
      } catch {
        // Skip binary files
      }
    }

    if (dir.name === 'backend' || dir.name === 'server') {
      const backendModules = await detectBackendModules(dirPath);
      modules.push(...backendModules);
    }
  }

  return {
    name: projectName,
    path: projectPath,
    directories,
    totalFiles,
    totalLines,
    languages,
    modules,
  };
}

function detectDirType(name: string, files: string[]): DirectoryInfo['type'] {
  const lowerName = name.toLowerCase();
  if (['backend', 'server', 'api', 'src'].includes(lowerName)) return 'backend';
  if (['frontend', 'web', 'client', 'admin-web', 'user-h5', 'b2b-h5'].includes(lowerName)) return 'frontend';
  if (['docs', 'documentation'].includes(lowerName)) return 'docs';
  if (files.some(f => f.includes('config') || f.endsWith('.json'))) return 'config';
  return 'other';
}

async function detectBackendModules(backendPath: string): Promise<ModuleInfo[]> {
  const modules: ModuleInfo[] = [];
  const modulesPath = path.join(backendPath, 'src', 'modules');

  if (fs.existsSync(modulesPath)) {
    const moduleDirs = fs.readdirSync(modulesPath, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const moduleDir of moduleDirs) {
      const modulePath = path.join(modulesPath, moduleDir.name);
      const files = fs.readdirSync(modulePath)
        .filter(f => f.endsWith('.ts') || f.endsWith('.js'));

      modules.push({
        name: moduleDir.name,
        path: modulePath,
        files,
        type: detectModuleType(moduleDir.name, files),
      });
    }
  }

  return modules;
}

function detectModuleType(name: string, files: string[]): string {
  if (name.includes('auth')) return 'authentication';
  if (name.includes('order')) return 'order-management';
  if (name.includes('catalog') || name.includes('product')) return 'product-catalog';
  if (name.includes('customer') || name.includes('user')) return 'user-management';
  if (name.includes('wms') || name.includes('inventory')) return 'warehouse';
  if (name.includes('erp')) return 'erp';
  if (name.includes('crm')) return 'crm';
  if (name.includes('payment')) return 'payment';
  if (name.includes('trace')) return 'traceability';
  return 'general';
}
