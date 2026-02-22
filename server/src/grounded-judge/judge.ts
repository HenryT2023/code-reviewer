// Grounded Judge: evaluates evaluation quality against a reference checklist
// Uses AI for coverage assessment + programmatic logic for accuracy/calibration/specificity

import { v4 as uuidv4 } from 'uuid';
import { callQwen, QwenMessage } from '../ai/qwen';
import type { RoleResult } from '../ai/role-evolution';
import type { MrepQualityMetrics } from '../ai/role-evolution';
import type { ReviewReference, GroundedJudgment, JudgeDimensions, DIMENSION_WEIGHTS } from './types';

const WEIGHTS: typeof DIMENSION_WEIGHTS = {
  coverage: 0.40,
  accuracy: 0.25,
  calibration: 0.20,
  specificity: 0.15,
};

// ─── Coverage: AI-based checklist matching ──────────────────────────

const COVERAGE_SYSTEM_PROMPT = `你是一位评测质量审计员。你收到一份评审清单（checklist）和多位 AI 评测角色的输出。

你的任务是判断清单中的每一项是否被至少一位角色**实质性**覆盖（不是随便提了一句，而是有具体分析或建议）。

严格返回 JSON：
{
  "covered": ["清单条目1原文", "清单条目2原文"],
  "missed": ["清单条目3原文", "清单条目4原文"],
  "role_coverage": {
    "角色ID": { "covered_count": 5, "total_items": 20 }
  }
}

只返回 JSON，不要其他内容。`;

interface CoverageResult {
  covered: string[];
  missed: string[];
  roleCoverage: Record<string, { coveredCount: number; totalItems: number }>;
}

async function assessCoverage(
  reference: ReviewReference,
  roleResults: RoleResult[]
): Promise<CoverageResult> {
  const allItems = [...reference.staticChecklist, ...reference.aiChecklist];

  if (allItems.length === 0) {
    return { covered: [], missed: [], roleCoverage: {} };
  }

  const checklistText = allItems
    .map((item, i) => `${i + 1}. [${item.category}/${item.severity}] ${item.item}`)
    .join('\n');

  const roleOutputs = roleResults
    .map(r => `## ${r.role} (score: ${r.score})\n${r.summary}\n${JSON.stringify(r.details, null, 2)}`)
    .join('\n\n---\n\n');

  const messages: QwenMessage[] = [
    { role: 'system', content: COVERAGE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `## 评审清单 (${allItems.length} 条)\n${checklistText}\n\n## 角色评测输出\n${roleOutputs}`,
    },
  ];

  const raw = await callQwen(messages, 'deepseek-chat', 4000);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        covered: parsed.covered || [],
        missed: parsed.missed || [],
        roleCoverage: Object.fromEntries(
          Object.entries(parsed.role_coverage || {}).map(([k, v]: [string, any]) => [
            k,
            { coveredCount: v.covered_count || 0, totalItems: v.total_items || allItems.length },
          ])
        ),
      };
    }
  } catch {
    console.error('Failed to parse coverage assessment');
  }

  // Fallback: assume 50% coverage
  return {
    covered: [],
    missed: allItems.map(i => i.item),
    roleCoverage: {},
  };
}

// ─── Accuracy: from MREP verification pass rate ─────────────────────

function computeAccuracy(mrepMetrics?: MrepQualityMetrics[]): { score: number; passRate: number } {
  if (!mrepMetrics || mrepMetrics.length === 0) {
    return { score: 50, passRate: 0 }; // neutral when no MREP data
  }

  const rates = mrepMetrics
    .filter(m => m.verification_pass_rate !== null)
    .map(m => m.verification_pass_rate as number);

  if (rates.length === 0) {
    return { score: 50, passRate: 0 };
  }

  const avgRate = rates.reduce((a, b) => a + b, 0) / rates.length;
  return {
    score: Math.round(avgRate * 100),
    passRate: Math.round(avgRate * 100) / 100,
  };
}

// ─── Calibration: scores vs objective indicators ────────────────────

function computeCalibration(
  roleResults: RoleResult[],
  reference: ReviewReference
): { score: number; details: string } {
  if (roleResults.length === 0) {
    return { score: 50, details: 'No role results to calibrate' };
  }

  const avgScore = roleResults.reduce((a, r) => a + r.score, 0) / roleResults.length;
  const criticalIssues = reference.staticChecklist.filter(i => i.severity === 'critical').length;
  const importantIssues = reference.staticChecklist.filter(i => i.severity === 'important').length;

  // Expected score range based on objective issues
  // More critical issues → lower expected score
  let expectedMax = 90;
  if (criticalIssues > 0) expectedMax -= criticalIssues * 10;
  if (importantIssues > 0) expectedMax -= importantIssues * 3;
  expectedMax = Math.max(30, expectedMax);

  const gap = Math.abs(avgScore - expectedMax);
  let score: number;
  let details: string;

  if (gap <= 10) {
    score = 90;
    details = `评分 ${avgScore.toFixed(0)} 与客观指标预期 ${expectedMax} 基本一致`;
  } else if (gap <= 20) {
    score = 70;
    details = `评分 ${avgScore.toFixed(0)} 与客观指标预期 ${expectedMax} 有一定偏差 (gap: ${gap.toFixed(0)})`;
  } else if (avgScore > expectedMax) {
    score = 40;
    details = `评分 ${avgScore.toFixed(0)} 显著高于客观指标预期 ${expectedMax}，可能偏乐观 (gap: ${gap.toFixed(0)})`;
  } else {
    score = 60;
    details = `评分 ${avgScore.toFixed(0)} 低于客观指标预期 ${expectedMax}，可能偏严格 (gap: ${gap.toFixed(0)})`;
  }

  return { score, details };
}

// ─── Specificity: ratio of recommendations with concrete references ─

function computeSpecificity(roleResults: RoleResult[]): { score: number; ratio: number } {
  if (roleResults.length === 0) {
    return { score: 50, ratio: 0 };
  }

  let totalRefs = 0;
  let concreteRefs = 0;

  for (const r of roleResults) {
    const detailStr = JSON.stringify(r.details);
    // Count recommendations/suggestions
    const recMatches = detailStr.match(/"(suggestion|recommendation|建议|改进)"/gi);
    totalRefs += recMatches ? recMatches.length : 1;

    // Count file/line references as concrete evidence
    const fileRefs = detailStr.match(/[a-zA-Z0-9_\-]+\.(ts|js|py|java|go|rs|tsx|jsx|vue|json|yaml|yml|toml|md)/g);
    const lineRefs = detailStr.match(/line\s*\d+|第\s*\d+\s*行|:\d+/g);
    concreteRefs += (fileRefs?.length || 0) + (lineRefs?.length || 0);
  }

  const ratio = totalRefs > 0 ? Math.min(concreteRefs / totalRefs, 1.0) : 0;
  return {
    score: Math.round(ratio * 100),
    ratio: Math.round(ratio * 100) / 100,
  };
}

// ─── Per-role scores ────────────────────────────────────────────────

function computeRoleScores(
  coverageResult: CoverageResult,
  totalChecklistSize: number
): Record<string, number> {
  const scores: Record<string, number> = {};

  for (const [role, cov] of Object.entries(coverageResult.roleCoverage)) {
    const coverageRatio = cov.totalItems > 0 ? cov.coveredCount / cov.totalItems : 0;
    scores[role] = Math.round(coverageRatio * 100);
  }

  return scores;
}

// ─── Main Entry ─────────────────────────────────────────────────────

export async function runGroundedJudge(
  evaluationId: string,
  projectPath: string,
  reference: ReviewReference,
  roleResults: RoleResult[],
  mrepMetrics?: MrepQualityMetrics[]
): Promise<GroundedJudgment> {
  console.log(`[Judge] Starting grounded judgment for ${evaluationId}...`);

  // Run dimensions
  const [coverageResult, accuracy, calibration, specificity] = await Promise.all([
    assessCoverage(reference, roleResults),
    Promise.resolve(computeAccuracy(mrepMetrics)),
    Promise.resolve(computeCalibration(roleResults, reference)),
    Promise.resolve(computeSpecificity(roleResults)),
  ]);

  const allItems = [...reference.staticChecklist, ...reference.aiChecklist];
  const totalItems = allItems.length;
  const coveredCount = coverageResult.covered.length;
  const coverageScore = totalItems > 0 ? Math.round((coveredCount / totalItems) * 100) : 50;

  const dimensions: JudgeDimensions = {
    coverage: {
      score: coverageScore,
      covered: coverageResult.covered,
      missed: coverageResult.missed,
    },
    accuracy,
    calibration,
    specificity,
  };

  // Weighted aggregate
  const overallScore = Math.round(
    dimensions.coverage.score * WEIGHTS.coverage +
    dimensions.accuracy.score * WEIGHTS.accuracy +
    dimensions.calibration.score * WEIGHTS.calibration +
    dimensions.specificity.score * WEIGHTS.specificity
  );

  const roleScores = computeRoleScores(coverageResult, totalItems);

  const judgment: GroundedJudgment = {
    id: uuidv4(),
    evaluationId,
    projectPath,
    referenceId: reference.id,
    overallScore,
    dimensions,
    roleScores,
    timestamp: new Date().toISOString(),
  };

  console.log(`[Judge] Judgment complete: overall=${overallScore}, coverage=${coverageScore}, accuracy=${accuracy.score}, calibration=${calibration.score}, specificity=${specificity.score}`);

  return judgment;
}

// ─── Judgment Summary (for injection into reflection prompt) ────────

export function formatJudgmentSummary(judgment: GroundedJudgment, techStack: string[]): string {
  const d = judgment.dimensions;
  const weakestRole = Object.entries(judgment.roleScores)
    .sort(([, a], [, b]) => a - b)[0];

  let summary = `## 接地判官评估（基于 tech stack: ${techStack.join(', ')} 的评审基准）
- 接地质量分: ${judgment.overallScore}/100
- 覆盖率: ${d.coverage.score}%`;

  if (d.coverage.missed.length > 0) {
    summary += ` (missed: ${d.coverage.missed.slice(0, 5).join(', ')})`;
  }

  summary += `
- 准确率: ${d.accuracy.score}% (MREP pass_rate: ${d.accuracy.passRate})
- 校准度: ${d.calibration.details}
- 具体性: ${d.specificity.score}% (引用比例: ${d.specificity.ratio})`;

  if (weakestRole) {
    summary += `\n- 最弱角色: ${weakestRole[0]} (覆盖率 ${weakestRole[1]}%)`;
  }

  return summary;
}
