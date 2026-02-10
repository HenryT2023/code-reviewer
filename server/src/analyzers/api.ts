import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

export interface ApiEndpoint {
  method: string;
  path: string;
  controller: string;
  handler: string;
  file: string;
}

export interface ApiAnalysis {
  endpoints: ApiEndpoint[];
  totalEndpoints: number;
  methodCounts: Record<string, number>;
  modules: string[];
  frameworks: string[];
}

export async function analyzeApi(projectPath: string): Promise<ApiAnalysis> {
  const endpoints: ApiEndpoint[] = [];
  const methodCounts: Record<string, number> = {};
  const modules = new Set<string>();
  const frameworks = new Set<string>();

  // NestJS controllers
  const nestEndpoints = await analyzeNestJsApi(projectPath);
  if (nestEndpoints.length > 0) frameworks.add('NestJS');
  endpoints.push(...nestEndpoints);

  // FastAPI routes
  const fastapiEndpoints = await analyzeFastApiRoutes(projectPath);
  if (fastapiEndpoints.length > 0) frameworks.add('FastAPI');
  endpoints.push(...fastapiEndpoints);

  // Express routes
  const expressEndpoints = await analyzeExpressRoutes(projectPath);
  if (expressEndpoints.length > 0) frameworks.add('Express');
  endpoints.push(...expressEndpoints);

  // Flask routes
  const flaskEndpoints = await analyzeFlaskRoutes(projectPath);
  if (flaskEndpoints.length > 0) frameworks.add('Flask');
  endpoints.push(...flaskEndpoints);

  for (const ep of endpoints) {
    methodCounts[ep.method] = (methodCounts[ep.method] || 0) + 1;
    modules.add(ep.controller);
  }

  return {
    endpoints,
    totalEndpoints: endpoints.length,
    methodCounts,
    modules: Array.from(modules),
    frameworks: Array.from(frameworks),
  };
}

// --- NestJS ---
async function analyzeNestJsApi(projectPath: string): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];
  const controllerFiles = await glob('**/src/**/*.controller.ts', {
    cwd: projectPath,
    ignore: ['**/node_modules/**'],
  });

  for (const file of controllerFiles) {
    const filePath = path.join(projectPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const controllerMatch = content.match(/@Controller\(['"]([^'"]*)['"]\)/);
    const basePath = controllerMatch ? controllerMatch[1] : '';
    const controllerName = path.basename(file, '.controller.ts');

    const methodPatterns = [
      { pattern: /@Get\(['"]([^'"]*)['"]\)/g, method: 'GET' },
      { pattern: /@Post\(['"]([^'"]*)['"]\)/g, method: 'POST' },
      { pattern: /@Put\(['"]([^'"]*)['"]\)/g, method: 'PUT' },
      { pattern: /@Delete\(['"]([^'"]*)['"]\)/g, method: 'DELETE' },
      { pattern: /@Patch\(['"]([^'"]*)['"]\)/g, method: 'PATCH' },
      { pattern: /@Get\(\)/g, method: 'GET' },
      { pattern: /@Post\(\)/g, method: 'POST' },
    ];

    for (const { pattern, method } of methodPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const endpointPath = match[1] || '';
        const fullPath = `/${basePath}${endpointPath ? '/' + endpointPath : ''}`.replace(/\/+/g, '/');
        const handlerMatch = content.substring(match.index).match(/\n\s*(?:async\s+)?(\w+)\s*\(/);
        endpoints.push({
          method, path: fullPath, controller: controllerName,
          handler: handlerMatch ? handlerMatch[1] : 'unknown', file,
        });
      }
    }
  }
  return endpoints;
}

// --- FastAPI ---
async function analyzeFastApiRoutes(projectPath: string): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];
  const pyFiles = await glob('**/*.py', {
    cwd: projectPath,
    ignore: ['**/node_modules/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**', '**/migrations/**', '**/alembic/**'],
  });

  for (const file of pyFiles) {
    const filePath = path.join(projectPath, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.includes('router') && !content.includes('app.') && !content.includes('APIRouter')) continue;

      // Detect router prefix
      const prefixMatch = content.match(/(?:APIRouter|router)\s*\(\s*.*?prefix\s*=\s*['"](\/[^'"]*)['"]/);
      const prefix = prefixMatch ? prefixMatch[1] : '';
      const controllerName = path.basename(file, '.py');

      // Match @router.get("/path") or @app.get("/path") patterns
      const routePattern = /(?:@(?:router|app)\.(get|post|put|delete|patch|head|options))\s*\(\s*['"]([^'"]*)['"]/gi;
      let match;
      while ((match = routePattern.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const routePath = match[2];
        const fullPath = (prefix + routePath).replace(/\/+/g, '/') || '/';

        // Find handler name (next def/async def line)
        const afterMatch = content.substring(match.index);
        const handlerMatch = afterMatch.match(/(?:async\s+)?def\s+(\w+)/);

        endpoints.push({
          method, path: fullPath, controller: controllerName,
          handler: handlerMatch ? handlerMatch[1] : 'unknown', file,
        });
      }
    } catch { /* skip */ }
  }
  return endpoints;
}

// --- Express ---
async function analyzeExpressRoutes(projectPath: string): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];
  const jsFiles = await glob('**/src/**/*.{ts,js}', {
    cwd: projectPath,
    ignore: ['**/node_modules/**', '**/dist/**'],
  });

  for (const file of jsFiles) {
    const filePath = path.join(projectPath, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.includes('router.') && !content.includes('app.')) continue;

      const controllerName = path.basename(file).replace(/\.(ts|js)$/, '');
      // router.get('/path', handler) or app.post('/path', handler)
      const routePattern = /(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi;
      let match;
      while ((match = routePattern.exec(content)) !== null) {
        endpoints.push({
          method: match[1].toUpperCase(), path: match[2], controller: controllerName,
          handler: 'handler', file,
        });
      }
    } catch { /* skip */ }
  }
  return endpoints;
}

// --- Flask ---
async function analyzeFlaskRoutes(projectPath: string): Promise<ApiEndpoint[]> {
  const endpoints: ApiEndpoint[] = [];
  const pyFiles = await glob('**/*.py', {
    cwd: projectPath,
    ignore: ['**/node_modules/**', '**/.venv/**', '**/venv/**', '**/__pycache__/**'],
  });

  for (const file of pyFiles) {
    const filePath = path.join(projectPath, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      // @app.route('/path', methods=['GET', 'POST'])
      const routePattern = /@(?:app|bp|blueprint)\.route\s*\(\s*['"]([^'"]+)['"](?:.*?methods\s*=\s*\[([^\]]+)\])?/gi;
      let match;
      while ((match = routePattern.exec(content)) !== null) {
        const routePath = match[1];
        const methods = match[2] ? match[2].replace(/['"]/g, '').split(',').map(m => m.trim().toUpperCase()) : ['GET'];
        const afterMatch = content.substring(match.index);
        const handlerMatch = afterMatch.match(/def\s+(\w+)/);
        for (const method of methods) {
          endpoints.push({
            method, path: routePath, controller: path.basename(file, '.py'),
            handler: handlerMatch ? handlerMatch[1] : 'unknown', file,
          });
        }
      }
    } catch { /* skip */ }
  }
  return endpoints;
}
