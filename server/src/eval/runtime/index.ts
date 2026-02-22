// Dynamic evaluation entry point
import type { EvalConfig, StageResult, ProcessHandle } from '../types';
import { launchApplication, LaunchResult } from './launcher';
import { runApiTests } from './api-tester';

export interface RuntimeEvalResult {
  success: boolean;
  stages: StageResult[];
  process?: ProcessHandle;
  baseUrl: string;
  port: number;
  score: number;
}

export async function runRuntimeEvaluation(config: EvalConfig): Promise<RuntimeEvalResult> {
  const stages: StageResult[] = [];
  let process: ProcessHandle | undefined;
  let baseUrl = config.baseUrl || '';
  let port = config.port || 0;

  console.log('[runtime] Starting runtime evaluation...');

  // Stage 1: Launch application
  const launchResult = await launchApplication(config);
  stages.push(launchResult.startupStage);
  stages.push(launchResult.healthStage);

  process = launchResult.process;
  baseUrl = launchResult.baseUrl;
  port = launchResult.port;

  if (!launchResult.success) {
    console.log('[runtime] Launch failed, skipping API tests');
    return {
      success: false,
      stages,
      process,
      baseUrl,
      port,
      score: calculateScore(stages),
    };
  }

  // Stage 2: API tests
  console.log('[runtime] Running API tests...');
  const apiStage = await runApiTests(baseUrl, config.projectPath, config.timeout?.api || 10000);
  stages.push(apiStage);

  const score = calculateScore(stages);
  const success = stages.every(s => s.status === 'passed' || s.status === 'skipped');

  console.log(`[runtime] Runtime evaluation complete. Score: ${score}`);

  return {
    success,
    stages,
    process,
    baseUrl,
    port,
    score,
  };
}

function calculateScore(stages: StageResult[]): number {
  const scoredStages = stages.filter(s => s.score !== undefined);
  if (scoredStages.length === 0) return 0;

  const total = scoredStages.reduce((sum, s) => sum + (s.score || 0), 0);
  return Math.round(total / scoredStages.length);
}

export { launchApplication } from './launcher';
export { runApiTests } from './api-tester';
export { checkHealth, waitForHealthy } from './health';
export { spawnProcess, findAvailablePort, waitForPort } from './process';
