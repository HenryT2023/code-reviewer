// API testing: probe common endpoints, test OpenAPI if available
import * as fs from 'fs';
import * as path from 'path';
import type { ApiTestResult, StageResult } from '../types';

const COMMON_API_ENDPOINTS = [
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api' },
  { method: 'GET', path: '/api/v1' },
  { method: 'GET', path: '/api/status' },
  { method: 'GET', path: '/api/version' },
];

const OPENAPI_PATHS = [
  '/openapi.json',
  '/api/openapi.json',
  '/swagger.json',
  '/api/swagger.json',
  '/docs/openapi.json',
];

export async function runApiTests(
  baseUrl: string,
  projectPath: string,
  timeout: number = 10000
): Promise<StageResult> {
  const startTime = Date.now();
  const results: ApiTestResult[] = [];
  const errors: string[] = [];

  // Try to find OpenAPI spec
  const openApiSpec = await findOpenApiSpec(baseUrl, projectPath);

  if (openApiSpec) {
    // Test endpoints from OpenAPI spec
    const endpoints = extractEndpointsFromOpenApi(openApiSpec);
    for (const ep of endpoints.slice(0, 10)) {
      const result = await testEndpoint(baseUrl, ep.method, ep.path, timeout);
      results.push(result);
    }
  } else {
    // Test common endpoints
    for (const ep of COMMON_API_ENDPOINTS) {
      const result = await testEndpoint(baseUrl, ep.method, ep.path, timeout);
      results.push(result);
    }
  }

  const duration = Date.now() - startTime;
  const passedCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  const score = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

  // Collect errors from failed tests
  for (const r of results) {
    if (!r.passed && r.error) {
      errors.push(`${r.method} ${r.endpoint}: ${r.error}`);
    }
  }

  return {
    stage: 'api',
    status: passedCount > 0 ? 'passed' : 'failed',
    duration_ms: duration,
    score,
    details: {
      total_tests: totalCount,
      passed: passedCount,
      failed: totalCount - passedCount,
      has_openapi: !!openApiSpec,
      results,
    },
    errors,
  };
}

async function testEndpoint(
  baseUrl: string,
  method: string,
  endpointPath: string,
  timeout: number
): Promise<ApiTestResult> {
  const url = `${baseUrl}${endpointPath}`;
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method,
      signal: AbortSignal.timeout(timeout),
      headers: {
        'Accept': 'application/json',
      },
    });

    const responseTime = Date.now() - startTime;

    // 2xx = passed, 3xx = passed (redirect), 4xx = depends, 5xx = failed
    const passed = response.status < 500;
    let note: string | undefined;

    if (response.status === 401 || response.status === 403) {
      note = 'Auth required (expected)';
    } else if (response.status === 404) {
      note = 'Endpoint not found';
    } else if (response.status >= 400 && response.status < 500) {
      note = 'Client error';
    }

    return {
      endpoint: endpointPath,
      method,
      status: response.status,
      passed,
      response_time_ms: responseTime,
      note,
    };
  } catch (err) {
    const responseTime = Date.now() - startTime;
    return {
      endpoint: endpointPath,
      method,
      status: 0,
      passed: false,
      response_time_ms: responseTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function findOpenApiSpec(baseUrl: string, projectPath: string): Promise<object | null> {
  // Try remote endpoints first
  for (const specPath of OPENAPI_PATHS) {
    try {
      const response = await fetch(`${baseUrl}${specPath}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const spec = await response.json() as Record<string, unknown>;
        if (spec.openapi || spec.swagger) {
          console.log(`[api-tester] Found OpenAPI spec at ${specPath}`);
          return spec as object;
        }
      }
    } catch {
      // Continue trying
    }
  }

  // Try local files
  const localPaths = [
    'openapi.json',
    'openapi.yaml',
    'swagger.json',
    'docs/openapi.json',
    'api/openapi.json',
  ];

  for (const localPath of localPaths) {
    const fullPath = path.join(projectPath, localPath);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const spec = JSON.parse(content);
        if (spec.openapi || spec.swagger) {
          console.log(`[api-tester] Found local OpenAPI spec at ${localPath}`);
          return spec;
        }
      } catch {
        // Invalid JSON, continue
      }
    }
  }

  return null;
}

interface OpenApiEndpoint {
  method: string;
  path: string;
}

function extractEndpointsFromOpenApi(spec: any): OpenApiEndpoint[] {
  const endpoints: OpenApiEndpoint[] = [];
  const paths = spec.paths || {};

  for (const [pathKey, pathItem] of Object.entries(paths)) {
    const methods = ['get', 'post', 'put', 'patch', 'delete'];
    for (const method of methods) {
      if ((pathItem as any)[method]) {
        // Prefer GET endpoints for testing
        endpoints.push({
          method: method.toUpperCase(),
          path: pathKey,
        });
      }
    }
  }

  // Sort: GET first, then others
  endpoints.sort((a, b) => {
    if (a.method === 'GET' && b.method !== 'GET') return -1;
    if (a.method !== 'GET' && b.method === 'GET') return 1;
    return 0;
  });

  return endpoints;
}
