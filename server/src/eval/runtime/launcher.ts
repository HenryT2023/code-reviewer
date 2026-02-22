// Application launcher: start app, wait for port, handle env
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { spawnProcess, findAvailablePort } from './process';
import { waitForHealthy } from './health';
import type { EvalConfig, StartConfig, ProcessHandle, StageResult, HealthCheckResult } from '../types';
import { detectProject, getProjectName } from '../detectors/project';

export interface LaunchResult {
  success: boolean;
  process?: ProcessHandle;
  baseUrl: string;
  port: number;
  startupStage: StageResult;
  healthStage: StageResult;
  startConfig: StartConfig;
}

export async function launchApplication(config: EvalConfig): Promise<LaunchResult> {
  const startTime = Date.now();
  const timeout = config.timeout?.startup || 30000;
  const healthTimeout = config.timeout?.health || 10000;

  // If baseUrl provided, skip startup
  if (config.baseUrl) {
    const healthResult = await waitForHealthy(config.baseUrl, healthTimeout);
    return {
      success: healthResult.reachable,
      baseUrl: config.baseUrl,
      port: extractPort(config.baseUrl),
      startupStage: {
        stage: 'startup',
        status: 'skipped',
        duration_ms: 0,
        details: { reason: 'baseUrl provided, skipping startup' },
        errors: [],
      },
      healthStage: healthResultToStage(healthResult, Date.now() - startTime),
      startConfig: {
        command: '',
        args: [],
        cwd: config.projectPath,
        port: extractPort(config.baseUrl),
      },
    };
  }

  // Load env file
  const envVars = loadEnvFile(config);

  // Detect project and get start command (this may detect the actual port)
  const preferredPort = config.port || 3000;
  const startConfig = detectProject(config.projectPath, preferredPort);
  startConfig.env = { ...startConfig.env, ...envVars };

  // Use the detected port (may differ from preferred if project has hardcoded port)
  const port = startConfig.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Check if detection failed
  if (startConfig.needsConfig) {
    return {
      success: false,
      baseUrl,
      port,
      startupStage: {
        stage: 'startup',
        status: 'needs_config',
        duration_ms: Date.now() - startTime,
        details: { error: startConfig.configError },
        errors: [startConfig.configError || 'Unable to detect start command'],
      },
      healthStage: {
        stage: 'health',
        status: 'skipped',
        duration_ms: 0,
        details: { reason: 'Startup failed' },
        errors: [],
      },
      startConfig,
    };
  }

  console.log(`[launcher] Starting: ${startConfig.command} ${startConfig.args.join(' ')}`);
  console.log(`[launcher] CWD: ${startConfig.cwd}, Port: ${port}`);

  // Spawn process
  const processHandle = spawnProcess({
    config: startConfig,
    timeout: timeout + healthTimeout + 10000, // Extra buffer
    onStdout: (data) => process.stdout.write(`[app] ${data}`),
    onStderr: (data) => process.stderr.write(`[app:err] ${data}`),
  });

  // Wait for health check
  console.log(`[launcher] Waiting for app to be healthy at ${baseUrl}...`);
  const healthResult = await waitForHealthy(baseUrl, timeout);

  const startupDuration = Date.now() - startTime;

  if (!healthResult.reachable) {
    // Kill the process if health check failed
    await processHandle.kill();

    return {
      success: false,
      baseUrl,
      port,
      startupStage: {
        stage: 'startup',
        status: 'failed',
        duration_ms: startupDuration,
        details: {
          command: `${startConfig.command} ${startConfig.args.join(' ')}`,
          stdout_tail: processHandle.stdout.slice(-2000),
          stderr_tail: processHandle.stderr.slice(-2000),
        },
        errors: ['Application failed to start or health check timed out'],
        logs: processHandle.stdout + '\n---STDERR---\n' + processHandle.stderr,
      },
      healthStage: healthResultToStage(healthResult, startupDuration),
      startConfig,
    };
  }

  console.log(`[launcher] App is healthy at ${healthResult.endpoint} (${healthResult.response_time_ms}ms)`);

  return {
    success: true,
    process: processHandle,
    baseUrl,
    port,
    startupStage: {
      stage: 'startup',
      status: 'passed',
      duration_ms: startupDuration,
      score: 100,
      details: {
        command: `${startConfig.command} ${startConfig.args.join(' ')}`,
        framework: startConfig.framework,
        port,
      },
      errors: [],
    },
    healthStage: healthResultToStage(healthResult, startupDuration),
    startConfig,
  };
}

function loadEnvFile(config: EvalConfig): Record<string, string> {
  const envVars: Record<string, string> = {};

  // Priority 1: EVAL_ENV_FILE environment variable
  const evalEnvFile = process.env.EVAL_ENV_FILE;
  if (evalEnvFile && fs.existsSync(evalEnvFile)) {
    const parsed = dotenv.parse(fs.readFileSync(evalEnvFile));
    Object.assign(envVars, parsed);
    console.log(`[launcher] Loaded env from EVAL_ENV_FILE: ${evalEnvFile}`);
    return envVars;
  }

  // Priority 2: config.envFile
  if (config.envFile && fs.existsSync(config.envFile)) {
    const parsed = dotenv.parse(fs.readFileSync(config.envFile));
    Object.assign(envVars, parsed);
    console.log(`[launcher] Loaded env from config: ${config.envFile}`);
    return envVars;
  }

  // Priority 3: Project root .env
  const projectEnv = path.join(config.projectPath, '.env');
  if (fs.existsSync(projectEnv)) {
    const parsed = dotenv.parse(fs.readFileSync(projectEnv));
    Object.assign(envVars, parsed);
    console.log(`[launcher] Loaded env from project: ${projectEnv}`);
    return envVars;
  }

  console.log('[launcher] No .env file found, continuing without additional env vars');
  return envVars;
}

function healthResultToStage(result: HealthCheckResult, duration: number): StageResult {
  return {
    stage: 'health',
    status: result.reachable ? 'passed' : 'failed',
    duration_ms: duration,
    score: result.reachable ? 100 : 0,
    details: {
      endpoint: result.endpoint,
      status_code: result.status_code,
      response_time_ms: result.response_time_ms,
    },
    errors: result.error ? [result.error] : [],
  };
}

function extractPort(url: string): number {
  try {
    const parsed = new URL(url);
    return parseInt(parsed.port) || 80;
  } catch {
    return 80;
  }
}
