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
}

export async function analyzeApi(projectPath: string): Promise<ApiAnalysis> {
  const endpoints: ApiEndpoint[] = [];
  const methodCounts: Record<string, number> = {};
  const modules = new Set<string>();

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
    
    modules.add(controllerName);

    const methodPatterns = [
      { pattern: /@Get\(['"]([^'"]*)['"]\)/g, method: 'GET' },
      { pattern: /@Post\(['"]([^'"]*)['"]\)/g, method: 'POST' },
      { pattern: /@Put\(['"]([^'"]*)['"]\)/g, method: 'PUT' },
      { pattern: /@Delete\(['"]([^'"]*)['"]\)/g, method: 'DELETE' },
      { pattern: /@Patch\(['"]([^'"]*)['"]\)/g, method: 'PATCH' },
      { pattern: /@Get\(\)/g, method: 'GET' },
      { pattern: /@Post\(\)/g, method: 'POST' },
      { pattern: /@Put\(\)/g, method: 'PUT' },
      { pattern: /@Delete\(\)/g, method: 'DELETE' },
    ];

    for (const { pattern, method } of methodPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const endpointPath = match[1] || '';
        const fullPath = `/${basePath}${endpointPath ? '/' + endpointPath : ''}`.replace(/\/+/g, '/');
        
        const handlerMatch = content.substring(match.index).match(/\n\s*(?:async\s+)?(\w+)\s*\(/);
        const handler = handlerMatch ? handlerMatch[1] : 'unknown';

        endpoints.push({
          method,
          path: fullPath,
          controller: controllerName,
          handler,
          file,
        });

        methodCounts[method] = (methodCounts[method] || 0) + 1;
      }
    }
  }

  return {
    endpoints,
    totalEndpoints: endpoints.length,
    methodCounts,
    modules: Array.from(modules),
  };
}
