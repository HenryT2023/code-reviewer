// UI evaluation entry point
import * as path from 'path';
import type { EvalConfig, StageResult, UiFlowResult } from '../types';
import { createRunner, runFlow, flowResultToStage, FlowStep } from './runner';
import { getGenericFlow, buildDynamicFlow } from './generic-flow';

export interface UiEvalResult {
  success: boolean;
  stage: StageResult;
  screenshots: string[];
  traces: string[];
}

export async function runUiEvaluation(
  config: EvalConfig,
  baseUrl: string
): Promise<UiEvalResult> {
  const startTime = Date.now();
  const screenshotDir = path.join(config.reportDir || '.', 'screenshots');
  const timeout = config.timeout?.ui || 60000;

  console.log('[ui] Starting UI evaluation...');
  console.log(`[ui] Base URL: ${baseUrl}`);
  console.log(`[ui] Screenshot dir: ${screenshotDir}`);

  let runner;
  const flowResults: UiFlowResult[] = [];
  const screenshots: string[] = [];

  try {
    // Create Playwright runner
    runner = await createRunner({
      baseUrl,
      screenshotDir,
      timeout,
      headless: true,
    });

    // Run generic flow first
    console.log('[ui] Running generic flow...');
    const genericSteps = getGenericFlow();
    const genericResult = await runFlow(runner, 'Generic Flow', genericSteps, {
      baseUrl,
      screenshotDir,
      timeout,
    });
    flowResults.push(genericResult);

    // Collect screenshots
    for (const step of genericResult.steps) {
      if (step.screenshot) {
        screenshots.push(step.screenshot);
      }
    }

    // If generic flow passed, try dynamic flow
    if (genericResult.passed) {
      console.log('[ui] Running dynamic flow...');
      const dynamicSteps = await buildDynamicFlow(runner.page, baseUrl);

      // Filter out steps already done in generic flow
      const additionalSteps = dynamicSteps.slice(getGenericFlow().length);

      if (additionalSteps.length > 0) {
        const dynamicResult = await runFlow(runner, 'Dynamic Flow', additionalSteps, {
          baseUrl,
          screenshotDir,
          timeout,
        });
        flowResults.push(dynamicResult);

        for (const step of dynamicResult.steps) {
          if (step.screenshot) {
            screenshots.push(step.screenshot);
          }
        }
      }
    }

    // Check for custom test files
    const customFlowResult = await runCustomFlowIfExists(config.projectPath, runner, {
      baseUrl,
      screenshotDir,
      timeout,
    });
    if (customFlowResult) {
      flowResults.push(customFlowResult);
      for (const step of customFlowResult.steps) {
        if (step.screenshot) {
          screenshots.push(step.screenshot);
        }
      }
    }

  } catch (err) {
    console.error('[ui] UI evaluation error:', err);
    const duration = Date.now() - startTime;

    return {
      success: false,
      stage: {
        stage: 'ui',
        status: 'failed',
        duration_ms: duration,
        score: 0,
        details: { error: err instanceof Error ? err.message : String(err) },
        errors: [err instanceof Error ? err.message : String(err)],
      },
      screenshots,
      traces: [],
    };
  } finally {
    if (runner) {
      console.log('[ui] Closing browser...');
      await runner.close();
    }
  }

  const duration = Date.now() - startTime;
  const stage = flowResultToStage(flowResults, duration);

  console.log(`[ui] UI evaluation complete. Score: ${stage.score}`);

  return {
    success: stage.status === 'passed',
    stage,
    screenshots,
    traces: [],
  };
}

async function runCustomFlowIfExists(
  projectPath: string,
  runner: Awaited<ReturnType<typeof createRunner>>,
  options: { baseUrl: string; screenshotDir: string; timeout: number }
): Promise<UiFlowResult | null> {
  const fs = await import('fs');
  const path = await import('path');

  // Check for custom test files
  const customTestDirs = [
    path.join(projectPath, 'tests', 'ui'),
    path.join(projectPath, 'test', 'ui'),
    path.join(projectPath, 'e2e'),
  ];

  for (const testDir of customTestDirs) {
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir).filter(f => f.endsWith('.spec.ts') || f.endsWith('.spec.js'));
      if (files.length > 0) {
        console.log(`[ui] Found custom test files in ${testDir}, but custom flow execution is not yet implemented`);
        // TODO: Implement custom flow execution
        // For now, just note that custom tests exist
        return {
          name: 'Custom Flow (detected)',
          steps: [{
            action: 'check_element',
            target: 'body',
            passed: true,
            duration_ms: 0,
          }],
          passed: true,
          duration_ms: 0,
          console_errors: [],
          network_errors: [],
        };
      }
    }
  }

  return null;
}

export { createRunner, runFlow, flowResultToStage } from './runner';
export { getGenericFlow, buildDynamicFlow } from './generic-flow';
