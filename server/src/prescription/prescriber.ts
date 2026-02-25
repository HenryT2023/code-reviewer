/**
 * Prescriber — Main Orchestrator
 * Coordinates: gap extraction → community search → plan generation → file output
 */

import * as fs from 'fs';
import * as path from 'path';
import { extractGaps, type RoleOutput } from './gap-extractor';
import { searchCommunity } from './community-searcher';
import { generateAllPlans } from './plan-generator';
import { loadConfig, type PrescriptionReport, type PrescriptionConfig } from './types';

// ─── Project Context Builder ────────────────────────────────────────────

function buildProjectContext(analysisData: Record<string, any> | null, projectPath: string): string {
  const lines: string[] = [];
  lines.push(`项目路径: ${projectPath}`);

  if (!analysisData) return lines.join('\n');

  if (analysisData.structure) {
    lines.push(`文件总数: ${analysisData.structure.totalFiles || 'N/A'}`);
    lines.push(`代码行数: ${analysisData.structure.totalLines || 'N/A'}`);
    if (analysisData.structure.languages) {
      const langs = Object.entries(analysisData.structure.languages)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 5)
        .map(([ext, count]) => `${ext}(${count})`)
        .join(', ');
      lines.push(`主要语言: ${langs}`);
    }
  }

  if (analysisData.api) {
    lines.push(`API 端点数: ${analysisData.api.totalEndpoints || 0}`);
  }

  if (analysisData.database) {
    lines.push(`数据库实体: ${analysisData.database.totalEntities || 0}`);
    lines.push(`数据库字段: ${analysisData.database.totalColumns || 0}`);
    if (analysisData.database.orms?.length) {
      lines.push(`ORM: ${analysisData.database.orms.join(', ')}`);
    }
  }

  if (analysisData.quality) {
    const q = analysisData.quality;
    const checks = [];
    if (q.hasTests) checks.push('Tests');
    if (q.hasCI) checks.push('CI/CD');
    if (q.hasDocker || q.hasDockerfile || q.hasDockerCompose) checks.push('Docker');
    if (q.hasLinting || q.hasLinter) checks.push('Linting');
    if (q.hasTypeChecking) checks.push('TypeCheck');
    lines.push(`质量检查: ${checks.join(', ') || 'None'}`);

    if (q.testCoverage) {
      lines.push(`测试文件数: ${q.testCoverage.testFileCount}`);
      lines.push(`测试覆盖率: ${Math.round(q.testCoverage.testFileRatio * 100)}%`);
    }
  }

  return lines.join('\n');
}

// ─── Summary Generator ──────────────────────────────────────────────────

function generateSummary(report: PrescriptionReport): string {
  const lines: string[] = [];
  lines.push('# Prescription Summary');
  lines.push('');
  lines.push(`**Project**: ${report.projectName}`);
  lines.push(`**Generated**: ${report.generatedAt}`);
  lines.push(`**Evaluation ID**: \`${report.evaluationId}\``);
  lines.push(`**Gaps Found**: ${report.gaps.length}`);
  lines.push(`**Plans Generated**: ${report.prescriptions.length}`);
  lines.push(`**Search Queries Used**: ${report.searchQueriesUsed}`);
  lines.push('');
  lines.push('## Prescriptions');
  lines.push('');
  lines.push('| # | Type | Priority | Gap | Plan File |');
  lines.push('|---|------|----------|-----|-----------|');

  for (const rx of report.prescriptions) {
    const priorityIcon = rx.gap.priority === 'critical' ? '🔴'
      : rx.gap.priority === 'high' ? '🟠'
      : rx.gap.priority === 'medium' ? '🟡' : '🟢';
    lines.push(`| ${rx.gap.id} | ${rx.gap.category} | ${priorityIcon} ${rx.gap.priority} | ${rx.gap.title.substring(0, 50)} | [${rx.filename}](./${rx.filename}) |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('💡 在 Windsurf 中打开上述 `.md` 文件，Cascade 将引导你执行修复。');

  return lines.join('\n');
}

// ─── File Output ────────────────────────────────────────────────────────

function writePrescriptions(projectPath: string, report: PrescriptionReport): string[] {
  const plansDir = path.join(projectPath, '.code-review', 'plans');
  if (!fs.existsSync(plansDir)) {
    fs.mkdirSync(plansDir, { recursive: true });
  }

  const writtenFiles: string[] = [];

  // Write individual plan files
  for (const rx of report.prescriptions) {
    const filePath = path.join(plansDir, rx.filename);
    fs.writeFileSync(filePath, rx.planContent, 'utf-8');
    writtenFiles.push(filePath);
    console.log(`[prescription] Written: ${filePath}`);
  }

  // Write summary
  const summaryPath = path.join(plansDir, 'PRESCRIPTION-SUMMARY.md');
  fs.writeFileSync(summaryPath, generateSummary(report), 'utf-8');
  writtenFiles.push(summaryPath);
  console.log(`[prescription] Summary written: ${summaryPath}`);

  return writtenFiles;
}

// ─── Main Entry Point ───────────────────────────────────────────────────

export async function runPrescription(
  evaluationId: string,
  projectPath: string,
  projectName: string,
  roleOutputs: RoleOutput[],
  analysisData: Record<string, any> | null,
): Promise<PrescriptionReport | null> {
  const config = loadConfig();

  if (!config.enabled) {
    console.log(`[prescription] Prescription engine disabled`);
    return null;
  }

  console.log(`[${evaluationId}] Starting prescription engine...`);

  // Step 1: Extract gaps
  const gaps = extractGaps(roleOutputs, config.maxGaps);
  if (gaps.length === 0) {
    console.log(`[${evaluationId}] No actionable gaps found, skipping prescription`);
    return null;
  }
  console.log(`[${evaluationId}] Extracted ${gaps.length} gaps: ${gaps.map(g => g.category).join(', ')}`);

  // Step 2: Community search
  const insights = await searchCommunity(gaps, config.braveApiKey, config.cacheTtlDays);
  const totalQueries = insights.reduce((sum, i) => sum + i.queriesUsed.length, 0);
  console.log(`[${evaluationId}] Community search complete: ${totalQueries} queries used`);

  // Step 3: Generate plans
  const projectContext = buildProjectContext(analysisData, projectPath);
  const prescriptions = await generateAllPlans(gaps, insights, projectContext);
  console.log(`[${evaluationId}] Generated ${prescriptions.length} prescription plans`);

  // Step 4: Build report
  const report: PrescriptionReport = {
    evaluationId,
    projectPath,
    projectName,
    generatedAt: new Date().toISOString(),
    gaps,
    prescriptions,
    searchQueriesUsed: totalQueries,
    aiCallsUsed: gaps.length + 1 + gaps.length, // query builder + synthesis per gap + plan per gap
  };

  // Step 5: Write files
  const writtenFiles = writePrescriptions(projectPath, report);
  console.log(`[${evaluationId}] Prescription complete: ${writtenFiles.length} files written to ${projectPath}/.code-review/plans/`);

  return report;
}
