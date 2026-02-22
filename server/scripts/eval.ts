#!/usr/bin/env npx tsx
// CLI entry point for evaluation
import * as path from 'path';
import { parseArgs } from 'util';
import type { EvalConfig, EvaluationType, StageResult } from '../src/eval/types';
import { DEFAULT_TIMEOUT } from '../src/eval/types';
import { runRuntimeEvaluation } from '../src/eval/runtime';
import { runUiEvaluation } from '../src/eval/ui';
import { generateReport, saveReport, getDefaultReportDir } from '../src/eval/report/generator';
import { getProjectName, detectMonorepoPorts } from '../src/eval/detectors/project';

interface CliArgs {
  type: EvaluationType;
  port?: number;
  baseUrl?: string;
  envFile?: string;
  timeout?: number;
  reportDir?: string;
  projectPath: string;
}

function parseCliArgs(): CliArgs {
  const { values, positionals } = parseArgs({
    options: {
      type: { type: 'string', short: 't', default: 'dynamic' },
      port: { type: 'string', short: 'p' },
      'base-url': { type: 'string', short: 'b' },
      'env-file': { type: 'string', short: 'e' },
      timeout: { type: 'string' },
      'report-dir': { type: 'string', short: 'r' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  if (positionals.length === 0) {
    console.error('Error: Project path is required');
    printHelp();
    process.exit(1);
  }

  const projectPath = path.resolve(positionals[0]);
  const evalType = values.type as EvaluationType;

  if (!['static', 'dynamic', 'ui', 'full'].includes(evalType)) {
    console.error(`Error: Invalid evaluation type: ${evalType}`);
    process.exit(1);
  }

  return {
    type: evalType,
    port: values.port ? parseInt(values.port) : undefined,
    baseUrl: values['base-url'],
    envFile: values['env-file'],
    timeout: values.timeout ? parseInt(values.timeout) : undefined,
    reportDir: values['report-dir'],
    projectPath,
  };
}

function printHelp(): void {
  console.log(`
Usage: npx tsx scripts/eval.ts [options] <project-path>

Options:
  -t, --type <type>       Evaluation type: static, dynamic, ui, full (default: dynamic)
  -p, --port <port>       Port to run the application on (default: auto-detect)
  -b, --base-url <url>    Base URL if app is already running (skips startup)
  -e, --env-file <path>   Path to .env file
  --timeout <ms>          Startup timeout in milliseconds (default: 30000)
  -r, --report-dir <dir>  Directory to save reports (default: ./artifacts/eval/<timestamp>)
  -h, --help              Show this help message

Examples:
  npx tsx scripts/eval.ts --type static /path/to/project
  npx tsx scripts/eval.ts --type dynamic /path/to/project
  npx tsx scripts/eval.ts --type ui --port 3000 /path/to/project
  npx tsx scripts/eval.ts --type full --env-file .env.test /path/to/project
  npx tsx scripts/eval.ts --type ui --base-url http://localhost:3000 /path/to/project
`);
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const startedAt = new Date();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              Code Reviewer - Evaluation CLI                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`📁 Project: ${args.projectPath}`);
  console.log(`🔍 Type: ${args.type}`);
  console.log('');

  const config: EvalConfig = {
    projectPath: args.projectPath,
    projectName: getProjectName(args.projectPath),
    evaluationType: args.type,
    port: args.port,
    baseUrl: args.baseUrl,
    envFile: args.envFile,
    timeout: args.timeout ? { ...DEFAULT_TIMEOUT, startup: args.timeout } : DEFAULT_TIMEOUT,
    reportDir: args.reportDir,
  };

  const stages: StageResult[] = [];
  let runtimeProcess: { kill: () => Promise<void> } | undefined;

  try {
    // Run evaluation based on type
    if (args.type === 'static') {
      console.log('📊 Running static analysis only...');
      // TODO: Integrate with existing static analyzer
      stages.push({
        stage: 'static',
        status: 'skipped',
        duration_ms: 0,
        details: { reason: 'Static analysis integration pending' },
        errors: [],
      });
    } else if (args.type === 'dynamic' || args.type === 'full') {
      console.log('🚀 Running runtime evaluation...');
      const runtimeResult = await runRuntimeEvaluation(config);
      stages.push(...runtimeResult.stages);
      runtimeProcess = runtimeResult.process;

      if (args.type === 'full') {
        console.log('🎭 Running UI evaluation...');
        // For monorepo, use frontend port for UI testing
        const ports = detectMonorepoPorts(args.projectPath);
        const uiBaseUrl = ports.frontend 
          ? `http://localhost:${ports.frontend}` 
          : runtimeResult.baseUrl;
        console.log(`[ui] Using URL: ${uiBaseUrl}`);
        const uiResult = await runUiEvaluation(
          { ...config, reportDir: args.reportDir || getDefaultReportDir(args.projectPath) },
          uiBaseUrl
        );
        stages.push(uiResult.stage);
      }
    } else if (args.type === 'ui') {
      // For UI-only, still need to launch the app
      console.log('🚀 Launching application for UI evaluation...');
      const runtimeResult = await runRuntimeEvaluation(config);
      stages.push(...runtimeResult.stages.filter(s => s.stage !== 'api'));
      runtimeProcess = runtimeResult.process;

      if (runtimeResult.success) {
        console.log('🎭 Running UI evaluation...');
        // For monorepo, use frontend port for UI testing
        const ports = detectMonorepoPorts(args.projectPath);
        const uiBaseUrl = ports.frontend 
          ? `http://localhost:${ports.frontend}` 
          : runtimeResult.baseUrl;
        console.log(`[ui] Using URL: ${uiBaseUrl}`);
        
        // Wait for frontend to be ready if different from backend
        if (ports.frontend && ports.frontend !== ports.backend) {
          console.log(`[ui] Waiting for frontend at port ${ports.frontend}...`);
          const { waitForHealthy } = await import('../src/eval/runtime/health');
          const frontendHealth = await waitForHealthy(uiBaseUrl, 10000);
          if (!frontendHealth.reachable) {
            console.log(`[ui] Warning: Frontend not reachable, proceeding anyway`);
          }
        }
        
        const uiResult = await runUiEvaluation(
          { ...config, reportDir: args.reportDir || getDefaultReportDir(args.projectPath) },
          uiBaseUrl
        );
        stages.push(uiResult.stage);
      } else {
        stages.push({
          stage: 'ui',
          status: 'skipped',
          duration_ms: 0,
          details: { reason: 'Skipped due to startup failure' },
          errors: [],
        });
      }
    }

    const completedAt = new Date();

    // Generate and save report
    const reportDir = args.reportDir || getDefaultReportDir(args.projectPath);
    const report = generateReport({
      config,
      stages,
      startedAt,
      completedAt,
    });

    const { jsonPath, mdPath } = saveReport(report, reportDir);

    console.log('');
    console.log('════════════════════════════════════════════════════════════');
    console.log('');

    // Print summary
    const statusEmoji = report.status === 'passed' ? '✅' : report.status === 'failed' ? '❌' : '⚠️';
    console.log(`${statusEmoji} Evaluation ${report.status.toUpperCase()}`);
    console.log('');
    console.log(`📊 Overall Score: ${report.metrics.overall_score}`);
    console.log(`⏱️  Duration: ${report.duration_ms}ms`);
    console.log('');

    // Print stage results
    console.log('Stages:');
    for (const stage of report.stages) {
      const emoji = stage.status === 'passed' ? '✅' :
                    stage.status === 'failed' ? '❌' :
                    stage.status === 'skipped' ? '⏭️' :
                    stage.status === 'needs_config' ? '⚙️' : '🔄';
      const scoreStr = stage.score !== undefined ? ` (${stage.score})` : '';
      console.log(`  ${emoji} ${stage.stage}${scoreStr}: ${stage.status}`);
    }
    console.log('');

    // Print errors if any
    if (report.errors.length > 0) {
      console.log('❌ Errors:');
      for (const err of report.errors.slice(0, 5)) {
        console.log(`  - ${err}`);
      }
      if (report.errors.length > 5) {
        console.log(`  ... and ${report.errors.length - 5} more`);
      }
      console.log('');
    }

    console.log('📁 Reports saved to:');
    console.log(`   ${jsonPath}`);
    console.log(`   ${mdPath}`);
    console.log('');

    // Exit with appropriate code
    process.exitCode = report.status === 'failed' ? 1 : 0;

  } finally {
    // Cleanup: kill the process if still running
    if (runtimeProcess) {
      console.log('🧹 Cleaning up...');
      await runtimeProcess.kill();
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
