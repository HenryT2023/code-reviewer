// Health check: try multiple endpoints to verify app is running
import type { HealthCheckResult } from '../types';

const HEALTH_ENDPOINTS = [
  '/health',
  '/api/health',
  '/healthz',
  '/api/healthz',
  '/',
];

export async function checkHealth(
  baseUrl: string,
  timeout: number = 10000
): Promise<HealthCheckResult> {
  for (const endpoint of HEALTH_ENDPOINTS) {
    const result = await tryEndpoint(baseUrl, endpoint, timeout);
    if (result.reachable) {
      return result;
    }
  }

  // All endpoints failed
  return {
    reachable: false,
    endpoint: '/',
    response_time_ms: 0,
    error: 'All health check endpoints failed',
  };
}

async function tryEndpoint(
  baseUrl: string,
  endpoint: string,
  timeout: number
): Promise<HealthCheckResult> {
  const url = `${baseUrl}${endpoint}`;
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'Accept': 'text/html,application/json,*/*',
      },
    });

    const responseTime = Date.now() - startTime;

    // Consider 2xx and 3xx as healthy
    // 4xx might be auth required but app is running
    if (response.status < 500) {
      return {
        reachable: true,
        endpoint,
        status_code: response.status,
        response_time_ms: responseTime,
      };
    }

    return {
      reachable: false,
      endpoint,
      status_code: response.status,
      response_time_ms: responseTime,
      error: `Server returned ${response.status}`,
    };
  } catch (err) {
    const responseTime = Date.now() - startTime;
    return {
      reachable: false,
      endpoint,
      response_time_ms: responseTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function waitForHealthy(
  baseUrl: string,
  timeout: number,
  checkInterval: number = 1000
): Promise<HealthCheckResult> {
  const startTime = Date.now();

  // Try both 127.0.0.1 and localhost variants
  const urls = [baseUrl];
  if (baseUrl.includes('127.0.0.1')) {
    urls.push(baseUrl.replace('127.0.0.1', 'localhost'));
  } else if (baseUrl.includes('localhost')) {
    urls.push(baseUrl.replace('localhost', '127.0.0.1'));
  }

  while (Date.now() - startTime < timeout) {
    for (const url of urls) {
      const result = await checkHealth(url, 3000);
      if (result.reachable) {
        return result;
      }
    }
    await sleep(checkInterval);
  }

  return {
    reachable: false,
    endpoint: '/',
    response_time_ms: timeout,
    error: `Health check timed out after ${timeout}ms`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
