// Project type detection and start command inference
import * as fs from 'fs';
import * as path from 'path';
import type { StartConfig } from '../types';

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface EvalConfigFile {
  startCommand?: string;
  startArgs?: string[];
  port?: number;
  env?: Record<string, string>;
}

export function detectProject(projectPath: string, preferredPort?: number): StartConfig {
  const port = preferredPort || 3000;

  // 1. Check for evaluation.config.json
  const evalConfigPath = path.join(projectPath, 'evaluation.config.json');
  if (fs.existsSync(evalConfigPath)) {
    try {
      const config: EvalConfigFile = JSON.parse(fs.readFileSync(evalConfigPath, 'utf-8'));
      if (config.startCommand) {
        const [cmd, ...args] = config.startCommand.split(' ');
        return {
          command: cmd,
          args: [...args, ...(config.startArgs || [])],
          cwd: projectPath,
          port: config.port || port,
          env: config.env,
          framework: 'custom',
        };
      }
    } catch {
      // Invalid config, continue detection
    }
  }

  // 2. Check package.json
  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg: PackageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return detectNodeProject(projectPath, pkg, port);
    } catch {
      // Invalid package.json
    }
  }

  // 3. Check for Python projects
  if (fs.existsSync(path.join(projectPath, 'requirements.txt')) ||
      fs.existsSync(path.join(projectPath, 'pyproject.toml'))) {
    return detectPythonProject(projectPath, port);
  }

  // 4. Check for Docker
  if (fs.existsSync(path.join(projectPath, 'docker-compose.yml')) ||
      fs.existsSync(path.join(projectPath, 'docker-compose.yaml'))) {
    return {
      command: 'docker-compose',
      args: ['up', '-d'],
      cwd: projectPath,
      port,
      framework: 'docker',
    };
  }

  // Unable to detect
  return {
    command: '',
    args: [],
    cwd: projectPath,
    port,
    needsConfig: true,
    configError: 'Unable to detect project type. Please create evaluation.config.json with startCommand.',
  };
}

function detectNodeProject(projectPath: string, pkg: PackageJson, port: number): StartConfig {
  const scripts = pkg.scripts || {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Detect framework
  let framework = 'node';
  if (deps['next']) framework = 'nextjs';
  else if (deps['vite']) framework = 'vite';
  else if (deps['react-scripts']) framework = 'cra';
  else if (deps['nuxt']) framework = 'nuxt';
  else if (deps['@angular/core']) framework = 'angular';
  else if (deps['express']) framework = 'express';

  // Check for monorepo with concurrently (runs multiple services)
  const devScript = scripts['dev'] || '';
  if (devScript.includes('concurrently') || deps['concurrently']) {
    // Try to detect port from sub-packages
    const detectedPort = detectPortFromMonorepo(projectPath, scripts);
    return {
      command: 'npm',
      args: ['run', 'dev'],
      cwd: projectPath,
      port: detectedPort || port,
      framework: 'monorepo',
      env: { PORT: String(detectedPort || port) },
    };
  }

  // Priority: dev > start > serve
  const scriptPriority = ['dev', 'start', 'serve', 'dev:server'];
  let selectedScript: string | undefined;

  for (const s of scriptPriority) {
    if (scripts[s]) {
      selectedScript = s;
      break;
    }
  }

  if (!selectedScript) {
    return {
      command: '',
      args: [],
      cwd: projectPath,
      port,
      framework,
      needsConfig: true,
      configError: `No suitable start script found in package.json. Available scripts: ${Object.keys(scripts).join(', ')}`,
    };
  }

  // Build command with port injection
  const baseArgs = ['run', selectedScript];
  let portArgs: string[] = [];

  switch (framework) {
    case 'nextjs':
      portArgs = ['--', '-p', String(port)];
      break;
    case 'vite':
      portArgs = ['--', '--host', '127.0.0.1', '--port', String(port)];
      break;
    case 'cra':
      // CRA uses PORT env var
      break;
    case 'nuxt':
      portArgs = ['--', '--port', String(port)];
      break;
    default:
      // For express/generic, hope PORT env works
      break;
  }

  return {
    command: 'npm',
    args: [...baseArgs, ...portArgs],
    cwd: projectPath,
    port,
    framework,
    env: { PORT: String(port) },
  };
}

interface MonorepoPorts {
  backend: number | null;
  frontend: number | null;
}

function detectPortFromMonorepo(projectPath: string, scripts: Record<string, string>): number | null {
  const ports = detectMonorepoPorts(projectPath);
  // Prefer backend port for API health checks
  return ports.backend || ports.frontend;
}

export function detectMonorepoPorts(projectPath: string): MonorepoPorts {
  const result: MonorepoPorts = { backend: null, frontend: null };

  // Try to find backend port from server/src/index.ts
  const serverIndexPaths = [
    path.join(projectPath, 'server', 'src', 'index.ts'),
    path.join(projectPath, 'server', 'src', 'index.js'),
    path.join(projectPath, 'src', 'index.ts'),
    path.join(projectPath, 'src', 'index.js'),
  ];

  for (const indexPath of serverIndexPaths) {
    if (fs.existsSync(indexPath)) {
      try {
        const content = fs.readFileSync(indexPath, 'utf-8');
        const patterns = [
          /\|\|\s*(\d{4,5})/,
          /listen\((\d{4,5})\)/,
          /port\s*[=:]\s*(\d{4,5})/i,
          /PORT\s*\|\|\s*(\d{4,5})/,
        ];
        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match && match[1]) {
            const port = parseInt(match[1]);
            if (port >= 1000 && port <= 65535) {
              result.backend = port;
              break;
            }
          }
        }
        if (result.backend) break;
      } catch {
        // Ignore
      }
    }
  }

  // Try to find frontend port from vite.config or web/vite.config
  const viteConfigPaths = [
    path.join(projectPath, 'web', 'vite.config.ts'),
    path.join(projectPath, 'web', 'vite.config.js'),
    path.join(projectPath, 'frontend', 'vite.config.ts'),
    path.join(projectPath, 'client', 'vite.config.ts'),
    path.join(projectPath, 'vite.config.ts'),
  ];

  for (const configPath of viteConfigPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        // Look for port in vite config: port: 9001 or port: 3000
        const portMatch = content.match(/port\s*:\s*(\d{4,5})/);
        if (portMatch) {
          result.frontend = parseInt(portMatch[1]);
          break;
        }
      } catch {
        // Ignore
      }
    }
  }

  // Default Vite port if web/ exists but no port found
  if (!result.frontend) {
    const webDir = path.join(projectPath, 'web');
    const frontendDir = path.join(projectPath, 'frontend');
    if (fs.existsSync(webDir) || fs.existsSync(frontendDir)) {
      // Check if it's a Vite project (default port 5173) or has custom port
      const webPkgPath = path.join(webDir, 'package.json');
      if (fs.existsSync(webPkgPath)) {
        try {
          const webPkg = JSON.parse(fs.readFileSync(webPkgPath, 'utf-8'));
          if (webPkg.dependencies?.vite || webPkg.devDependencies?.vite) {
            // Vite default is 5173, but many projects use 9001 or 3000
            // Check dev script for port hint
            const devScript = webPkg.scripts?.dev || '';
            const portMatch = devScript.match(/--port\s+(\d+)/);
            if (portMatch) {
              result.frontend = parseInt(portMatch[1]);
            }
          }
        } catch {
          // Ignore
        }
      }
    }
  }

  return result;
}

function detectPythonProject(projectPath: string, port: number): StartConfig {
  // Check for common entry points
  const entryPoints = ['app.py', 'main.py', 'server.py', 'run.py'];
  let entryPoint: string | undefined;

  for (const ep of entryPoints) {
    if (fs.existsSync(path.join(projectPath, ep))) {
      entryPoint = ep;
      break;
    }
  }

  if (!entryPoint) {
    return {
      command: '',
      args: [],
      cwd: projectPath,
      port,
      framework: 'python',
      needsConfig: true,
      configError: 'Unable to detect Python entry point. Please create evaluation.config.json.',
    };
  }

  // Check for Flask/FastAPI/Django
  const content = fs.readFileSync(path.join(projectPath, entryPoint), 'utf-8');
  
  if (content.includes('FastAPI') || content.includes('fastapi')) {
    return {
      command: 'uvicorn',
      args: [`${entryPoint.replace('.py', '')}:app`, '--host', '127.0.0.1', '--port', String(port)],
      cwd: projectPath,
      port,
      framework: 'fastapi',
    };
  }

  if (content.includes('Flask') || content.includes('flask')) {
    return {
      command: 'python',
      args: [entryPoint],
      cwd: projectPath,
      port,
      framework: 'flask',
      env: { FLASK_RUN_PORT: String(port) },
    };
  }

  // Generic Python
  return {
    command: 'python',
    args: [entryPoint],
    cwd: projectPath,
    port,
    framework: 'python',
    env: { PORT: String(port) },
  };
}

export function getProjectName(projectPath: string): string {
  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg: PackageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name) return pkg.name;
    } catch {
      // Ignore
    }
  }
  return path.basename(projectPath);
}
