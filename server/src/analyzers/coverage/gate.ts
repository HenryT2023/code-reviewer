/**
 * PR Gate
 * 覆盖率门禁检查
 */

import * as fs from 'fs';
import * as path from 'path';
import type { 
  GateResult, 
  GateMetrics, 
  BaselineCoverage,
  CoverageIntelligence,
} from './types';
import { DEFAULT_GATE_THRESHOLDS } from './types';

const BASELINE_FILENAME = 'baseline-coverage.json';
const CODE_REVIEW_DIR = '.code-review';

/**
 * Read baseline coverage from project directory.
 */
export function readBaseline(projectPath: string): BaselineCoverage | null {
  const baselinePath = path.join(projectPath, CODE_REVIEW_DIR, BASELINE_FILENAME);
  
  if (!fs.existsSync(baselinePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(baselinePath, 'utf-8');
    const baseline = JSON.parse(content) as BaselineCoverage;
    
    // Validate structure
    if (!baseline.version || !baseline.metrics) {
      return null;
    }
    
    return baseline;
  } catch {
    return null;
  }
}

/**
 * Write baseline coverage to project directory.
 */
export function writeBaseline(projectPath: string, metrics: GateMetrics): void {
  const codeReviewDir = path.join(projectPath, CODE_REVIEW_DIR);
  const baselinePath = path.join(codeReviewDir, BASELINE_FILENAME);
  
  // Ensure directory exists
  if (!fs.existsSync(codeReviewDir)) {
    fs.mkdirSync(codeReviewDir, { recursive: true });
  }
  
  const baseline: BaselineCoverage = {
    version: 1,
    timestamp: new Date().toISOString(),
    metrics,
  };
  
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
}

/**
 * Extract gate metrics from coverage intelligence.
 */
export function extractGateMetrics(intelligence: CoverageIntelligence): GateMetrics {
  return {
    lineCoverage: intelligence.overview.lineCoverage,
    branchCoverage: intelligence.overview.branchCoverage,
    testFileRatio: intelligence.overview.testFileRatio,
    testQualityScore: intelligence.quality.testQualityScore,
  };
}

/**
 * Compute gate result by comparing current metrics against baseline.
 */
export function computeGateResult(
  current: GateMetrics,
  baseline: BaselineCoverage | null,
  mode: 'warn' | 'fail' = 'warn',
  hasRealCoverage: boolean = false
): GateResult {
  // No baseline - skip gate
  if (!baseline) {
    return {
      mode,
      status: 'skipped',
      baselineSource: 'none',
      metrics: current,
      reasons: ['No baseline found. Run with --save-baseline to create one.'],
    };
  }
  
  const reasons: string[] = [];
  const delta: GateMetrics = {};
  
  // Calculate deltas
  if (current.lineCoverage !== undefined && baseline.metrics.lineCoverage !== undefined) {
    delta.lineCoverage = current.lineCoverage - baseline.metrics.lineCoverage;
  }
  if (current.branchCoverage !== undefined && baseline.metrics.branchCoverage !== undefined) {
    delta.branchCoverage = current.branchCoverage - baseline.metrics.branchCoverage;
  }
  if (current.testFileRatio !== undefined && baseline.metrics.testFileRatio !== undefined) {
    delta.testFileRatio = current.testFileRatio - baseline.metrics.testFileRatio;
  }
  if (current.testQualityScore !== undefined && baseline.metrics.testQualityScore !== undefined) {
    delta.testQualityScore = current.testQualityScore - baseline.metrics.testQualityScore;
  }
  
  // Check thresholds based on coverage type
  if (hasRealCoverage) {
    // Real coverage: check line and branch coverage
    if (delta.lineCoverage !== undefined && delta.lineCoverage < -DEFAULT_GATE_THRESHOLDS.lineCoverageMaxDrop) {
      reasons.push(`Line coverage decreased by ${Math.abs(delta.lineCoverage).toFixed(1)}% (threshold: -${DEFAULT_GATE_THRESHOLDS.lineCoverageMaxDrop}%)`);
    }
    if (delta.branchCoverage !== undefined && delta.branchCoverage < -DEFAULT_GATE_THRESHOLDS.branchCoverageMaxDrop) {
      reasons.push(`Branch coverage decreased by ${Math.abs(delta.branchCoverage).toFixed(1)}% (threshold: -${DEFAULT_GATE_THRESHOLDS.branchCoverageMaxDrop}%)`);
    }
  } else {
    // Proxy coverage: check test file ratio and quality score
    if (delta.testFileRatio !== undefined && delta.testFileRatio < -DEFAULT_GATE_THRESHOLDS.testFileRatioMaxDrop) {
      reasons.push(`Test file ratio decreased by ${Math.abs(delta.testFileRatio * 100).toFixed(1)}% (threshold: no decrease)`);
    }
    if (delta.testQualityScore !== undefined && delta.testQualityScore < -DEFAULT_GATE_THRESHOLDS.testQualityScoreMaxDrop) {
      reasons.push(`Test quality score decreased by ${Math.abs(delta.testQualityScore).toFixed(0)} points (threshold: -${DEFAULT_GATE_THRESHOLDS.testQualityScoreMaxDrop})`);
    }
  }
  
  // Determine status
  const status = reasons.length > 0 ? (mode === 'fail' ? 'fail' : 'warn') : 'pass';
  
  return {
    mode,
    status,
    baselinePath: path.join(CODE_REVIEW_DIR, BASELINE_FILENAME),
    baselineSource: 'file',
    metrics: current,
    baseline: baseline.metrics,
    delta,
    reasons,
  };
}

/**
 * Format gate result for markdown report.
 */
export function formatGateResultMarkdown(gate: GateResult): string {
  const lines: string[] = [];
  
  lines.push('### PR Gate');
  lines.push('');
  
  if (gate.status === 'skipped') {
    lines.push('**Status**: ⏭️ SKIPPED');
    lines.push('');
    lines.push(gate.reasons[0] || 'No baseline available.');
    return lines.join('\n');
  }
  
  // Status icon
  const statusIcon = gate.status === 'pass' ? '✅' : gate.status === 'warn' ? '⚠️' : '❌';
  lines.push(`**Status**: ${statusIcon} ${gate.status.toUpperCase()} (${gate.mode} mode)`);
  lines.push('');
  
  // Metrics table
  lines.push('| Metric | Baseline | Current | Δ | Result |');
  lines.push('|--------|----------|---------|---|--------|');
  
  const formatMetric = (name: string, baseline?: number, current?: number, delta?: number, isPercent = true): string => {
    if (baseline === undefined || current === undefined) return '';
    
    const baselineStr = isPercent ? `${baseline.toFixed(1)}%` : baseline.toFixed(0);
    const currentStr = isPercent ? `${current.toFixed(1)}%` : current.toFixed(0);
    const deltaStr = delta !== undefined 
      ? (delta >= 0 ? '+' : '') + (isPercent ? `${delta.toFixed(1)}%` : delta.toFixed(0))
      : 'n/a';
    
    // Determine if this metric failed
    const failed = gate.reasons.some(r => r.toLowerCase().includes(name.toLowerCase()));
    const resultIcon = failed ? '⚠️' : '✅';
    
    return `| ${name} | ${baselineStr} | ${currentStr} | ${deltaStr} | ${resultIcon} |`;
  };
  
  if (gate.baseline?.lineCoverage !== undefined) {
    const row = formatMetric('Line Coverage', gate.baseline.lineCoverage, gate.metrics.lineCoverage, gate.delta?.lineCoverage);
    if (row) lines.push(row);
  }
  if (gate.baseline?.branchCoverage !== undefined) {
    const row = formatMetric('Branch Coverage', gate.baseline.branchCoverage, gate.metrics.branchCoverage, gate.delta?.branchCoverage);
    if (row) lines.push(row);
  }
  if (gate.baseline?.testFileRatio !== undefined) {
    const row = formatMetric('Test File Ratio', (gate.baseline.testFileRatio ?? 0) * 100, (gate.metrics.testFileRatio ?? 0) * 100, (gate.delta?.testFileRatio ?? 0) * 100);
    if (row) lines.push(row);
  }
  if (gate.baseline?.testQualityScore !== undefined) {
    const row = formatMetric('Quality Score', gate.baseline.testQualityScore, gate.metrics.testQualityScore, gate.delta?.testQualityScore, false);
    if (row) lines.push(row);
  }
  
  lines.push('');
  
  // Reasons
  if (gate.reasons.length > 0) {
    lines.push('**Issues**:');
    for (const reason of gate.reasons) {
      lines.push(`- ${reason}`);
    }
  }
  
  return lines.join('\n');
}
