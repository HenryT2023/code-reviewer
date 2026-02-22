// Report generation: JSON and Markdown reports
import * as fs from 'fs';
import * as path from 'path';
import type { EvalConfig, EvalReport, StageResult, EvalArtifacts, EvalMetrics } from '../types';
import { v4 as uuidv4 } from 'uuid';

export interface ReportGeneratorOptions {
  config: EvalConfig;
  stages: StageResult[];
  artifacts?: Partial<EvalArtifacts>;
  startedAt: Date;
  completedAt: Date;
}

export function generateReport(options: ReportGeneratorOptions): EvalReport {
  const { config, stages, artifacts, startedAt, completedAt } = options;

  const duration = completedAt.getTime() - startedAt.getTime();
  const errors = stages.flatMap(s => s.errors);
  const warnings: string[] = [];

  // Check for needs_config stages
  const needsConfigStages = stages.filter(s => s.status === 'needs_config');
  if (needsConfigStages.length > 0) {
    warnings.push('Some stages require configuration. Create evaluation.config.json to fix.');
  }

  // Calculate metrics
  const metrics = calculateMetrics(stages, config.evaluationType);

  // Determine overall status
  const failedStages = stages.filter(s => s.status === 'failed');
  const passedStages = stages.filter(s => s.status === 'passed');
  let status: 'passed' | 'failed' | 'partial' = 'passed';
  if (failedStages.length > 0 && passedStages.length > 0) {
    status = 'partial';
  } else if (failedStages.length > 0) {
    status = 'failed';
  }

  // Build rerun command
  const rerunCommand = buildRerunCommand(config);

  return {
    id: uuidv4(),
    projectPath: config.projectPath,
    projectName: config.projectName || path.basename(config.projectPath),
    evaluationType: config.evaluationType,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    duration_ms: duration,
    stages,
    artifacts: {
      screenshots: artifacts?.screenshots || [],
      traces: artifacts?.traces || [],
      logs: artifacts?.logs || [],
    },
    metrics,
    errors,
    warnings,
    rerun_command: rerunCommand,
  };
}

function calculateMetrics(stages: StageResult[], evalType: string): EvalMetrics {
  const staticStage = stages.find(s => s.stage === 'static');
  const startupStage = stages.find(s => s.stage === 'startup');
  const healthStage = stages.find(s => s.stage === 'health');
  const apiStage = stages.find(s => s.stage === 'api');
  const uiStage = stages.find(s => s.stage === 'ui');

  // Calculate runtime score (average of startup, health, api)
  const runtimeStages = [startupStage, healthStage, apiStage].filter(s => s?.score !== undefined);
  const runtimeScore = runtimeStages.length > 0
    ? Math.round(runtimeStages.reduce((sum, s) => sum + (s?.score || 0), 0) / runtimeStages.length)
    : undefined;

  // Calculate overall score based on eval type
  const scores: number[] = [];
  if (staticStage?.score !== undefined) scores.push(staticStage.score);
  if (runtimeScore !== undefined) scores.push(runtimeScore);
  if (uiStage?.score !== undefined) scores.push(uiStage.score);

  const overallScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;

  return {
    overall_score: overallScore,
    static_score: staticStage?.score,
    runtime_score: runtimeScore,
    ui_score: uiStage?.score,
  };
}

function buildRerunCommand(config: EvalConfig): string {
  const parts = ['npx tsx server/scripts/eval.ts'];
  parts.push(`--type ${config.evaluationType}`);
  if (config.port) parts.push(`--port ${config.port}`);
  if (config.baseUrl) parts.push(`--base-url ${config.baseUrl}`);
  if (config.envFile) parts.push(`--env-file ${config.envFile}`);
  parts.push(config.projectPath);
  return parts.join(' ');
}

export function saveReport(report: EvalReport, reportDir: string): { jsonPath: string; mdPath: string } {
  // Ensure directory exists
  fs.mkdirSync(reportDir, { recursive: true });

  const jsonPath = path.join(reportDir, 'report.json');
  const mdPath = path.join(reportDir, 'report.md');

  // Save JSON
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Save Markdown
  const markdown = generateMarkdown(report);
  fs.writeFileSync(mdPath, markdown);

  return { jsonPath, mdPath };
}

function generateMarkdown(report: EvalReport): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Evaluation Report: ${report.projectName}`);
  lines.push('');
  lines.push(`> Generated: ${new Date(report.completedAt).toLocaleString()}`);
  lines.push('');

  // Summary
  const statusEmoji = report.status === 'passed' ? '✅' : report.status === 'failed' ? '❌' : '⚠️';
  lines.push(`## ${statusEmoji} Summary`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Status | **${report.status.toUpperCase()}** |`);
  lines.push(`| Overall Score | **${report.metrics.overall_score}** |`);
  lines.push(`| Duration | ${report.duration_ms}ms |`);
  lines.push(`| Evaluation Type | ${report.evaluationType} |`);
  lines.push('');

  // Scores breakdown
  if (report.metrics.static_score !== undefined ||
      report.metrics.runtime_score !== undefined ||
      report.metrics.ui_score !== undefined) {
    lines.push('### Score Breakdown');
    lines.push('');
    if (report.metrics.static_score !== undefined) {
      lines.push(`- **Static Analysis**: ${report.metrics.static_score}`);
    }
    if (report.metrics.runtime_score !== undefined) {
      lines.push(`- **Runtime**: ${report.metrics.runtime_score}`);
    }
    if (report.metrics.ui_score !== undefined) {
      lines.push(`- **UI**: ${report.metrics.ui_score}`);
    }
    lines.push('');
  }

  // Stages
  lines.push('## Stages');
  lines.push('');
  for (const stage of report.stages) {
    const stageEmoji = stage.status === 'passed' ? '✅' :
                       stage.status === 'failed' ? '❌' :
                       stage.status === 'skipped' ? '⏭️' :
                       stage.status === 'needs_config' ? '⚙️' : '🔄';
    lines.push(`### ${stageEmoji} ${stage.stage.charAt(0).toUpperCase() + stage.stage.slice(1)}`);
    lines.push('');
    lines.push(`- **Status**: ${stage.status}`);
    lines.push(`- **Duration**: ${stage.duration_ms}ms`);
    if (stage.score !== undefined) {
      lines.push(`- **Score**: ${stage.score}`);
    }
    if (stage.errors.length > 0) {
      lines.push(`- **Errors**:`);
      for (const err of stage.errors) {
        lines.push(`  - ${err}`);
      }
    }
    lines.push('');
  }

  // Errors
  if (report.errors.length > 0) {
    lines.push('## ❌ Errors');
    lines.push('');
    for (const err of report.errors) {
      lines.push(`- ${err}`);
    }
    lines.push('');
  }

  // Warnings
  if (report.warnings.length > 0) {
    lines.push('## ⚠️ Warnings');
    lines.push('');
    for (const warn of report.warnings) {
      lines.push(`- ${warn}`);
    }
    lines.push('');
  }

  // Rerun command
  lines.push('## 🔄 Rerun Command');
  lines.push('');
  lines.push('```bash');
  lines.push(report.rerun_command);
  lines.push('```');
  lines.push('');

  // Artifacts
  if (report.artifacts.screenshots.length > 0 ||
      report.artifacts.traces.length > 0 ||
      report.artifacts.logs.length > 0) {
    lines.push('## 📁 Artifacts');
    lines.push('');
    if (report.artifacts.screenshots.length > 0) {
      lines.push(`- Screenshots: ${report.artifacts.screenshots.length} files`);
    }
    if (report.artifacts.traces.length > 0) {
      lines.push(`- Traces: ${report.artifacts.traces.length} files`);
    }
    if (report.artifacts.logs.length > 0) {
      lines.push(`- Logs: ${report.artifacts.logs.length} files`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function getDefaultReportDir(projectPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(projectPath, 'artifacts', 'eval', timestamp);
}
