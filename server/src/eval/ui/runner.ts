// Playwright runner: launch browser, execute flows, capture artifacts
import type { Browser, Page, BrowserContext } from 'playwright';
import type { UiFlowResult, UiFlowStep, StageResult } from '../types';

export interface PlaywrightRunner {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  consoleErrors: string[];
  networkErrors: string[];
  close: () => Promise<void>;
}

export interface RunnerOptions {
  baseUrl: string;
  screenshotDir: string;
  timeout: number;
  headless?: boolean;
}

export async function createRunner(options: RunnerOptions): Promise<PlaywrightRunner> {
  // Dynamic import to handle cases where playwright is not installed
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({
    headless: options.headless ?? true,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'CodeReviewer-UIEval/1.0',
  });

  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const networkErrors: string[] = [];

  // Capture console errors
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // Capture page errors
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });

  // Capture network errors
  page.on('response', (response) => {
    if (response.status() >= 400) {
      networkErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  page.on('requestfailed', (request) => {
    networkErrors.push(`FAILED: ${request.url()} - ${request.failure()?.errorText || 'Unknown'}`);
  });

  return {
    browser,
    context,
    page,
    consoleErrors,
    networkErrors,
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

export async function takeScreenshot(
  page: Page,
  name: string,
  screenshotDir: string
): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');

  fs.mkdirSync(screenshotDir, { recursive: true });
  const filename = `${name}.png`;
  const filepath = path.join(screenshotDir, filename);

  await page.screenshot({ path: filepath, fullPage: false });
  return filepath;
}

export async function runFlow(
  runner: PlaywrightRunner,
  flowName: string,
  steps: FlowStep[],
  options: RunnerOptions
): Promise<UiFlowResult> {
  const startTime = Date.now();
  const stepResults: UiFlowStep[] = [];
  let flowPassed = true;

  for (const step of steps) {
    const stepStart = Date.now();
    let passed = true;
    let error: string | undefined;
    let screenshot: string | undefined;

    try {
      switch (step.action) {
        case 'navigate':
          await runner.page.goto(`${options.baseUrl}${step.target || '/'}`, {
            timeout: options.timeout,
            waitUntil: 'domcontentloaded',
          });
          break;

        case 'wait':
          await runner.page.waitForSelector(step.target || 'body', {
            timeout: options.timeout,
          });
          break;

        case 'click':
          await runner.page.click(step.target!, { timeout: options.timeout });
          break;

        case 'fill':
          await runner.page.fill(step.target!, step.value || '', { timeout: options.timeout });
          break;

        case 'screenshot':
          screenshot = await takeScreenshot(runner.page, step.value || 'screenshot', options.screenshotDir);
          break;

        case 'check_element':
          const element = await runner.page.$(step.target!);
          if (!element) {
            throw new Error(`Element not found: ${step.target}`);
          }
          break;

        case 'check_text':
          const text = await runner.page.textContent(step.target || 'body');
          if (!text?.includes(step.value || '')) {
            throw new Error(`Text not found: ${step.value}`);
          }
          break;

        default:
          console.warn(`Unknown action: ${step.action}`);
      }
    } catch (err) {
      passed = false;
      flowPassed = false;
      error = err instanceof Error ? err.message : String(err);

      // Take error screenshot
      try {
        screenshot = await takeScreenshot(runner.page, `error-${step.action}`, options.screenshotDir);
      } catch {
        // Ignore screenshot errors
      }
    }

    stepResults.push({
      action: step.action,
      target: step.target,
      value: step.value,
      passed,
      screenshot,
      error,
      duration_ms: Date.now() - stepStart,
    });

    // Stop flow on first error
    if (!passed) {
      break;
    }
  }

  return {
    name: flowName,
    steps: stepResults,
    passed: flowPassed,
    duration_ms: Date.now() - startTime,
    console_errors: [...runner.consoleErrors],
    network_errors: [...runner.networkErrors],
  };
}

export interface FlowStep {
  action: 'navigate' | 'wait' | 'click' | 'fill' | 'screenshot' | 'check_element' | 'check_text';
  target?: string;
  value?: string;
}

export function flowResultToStage(results: UiFlowResult[], duration: number): StageResult {
  const passed = results.every(r => r.passed);
  const totalSteps = results.reduce((sum, r) => sum + r.steps.length, 0);
  const passedSteps = results.reduce((sum, r) => sum + r.steps.filter(s => s.passed).length, 0);
  const score = totalSteps > 0 ? Math.round((passedSteps / totalSteps) * 100) : 0;

  const errors: string[] = [];
  for (const result of results) {
    for (const step of result.steps) {
      if (step.error) {
        errors.push(`${result.name}/${step.action}: ${step.error}`);
      }
    }
    errors.push(...result.console_errors.slice(0, 3));
  }

  return {
    stage: 'ui',
    status: passed ? 'passed' : 'failed',
    duration_ms: duration,
    score,
    details: {
      flows: results.length,
      total_steps: totalSteps,
      passed_steps: passedSteps,
      results,
    },
    errors,
  };
}
