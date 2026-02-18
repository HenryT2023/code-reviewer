// Orchestrator: Debate round + final synthesis for Launch-Ready mode.
// Two LLM calls: (1) debate/cross-critique, (2) A-J structured synthesis.

import { callQwen } from './qwen';
import type { QwenMessage } from './qwen';
import { ROLE_NAMES } from './roles';

export interface RoleResult {
  role: string;
  score: number;
  summary: string;
  details: Record<string, unknown>;
}

export interface DebateResult {
  consensus: string[];
  disputes: Array<{
    topic: string;
    support: string[];
    oppose: string[];
    resolution: string;
  }>;
  unresolved: string[];
  summary: string;
}

export interface LaunchContext {
  launchWindow?: string;
  channels?: string[];
  constraints?: string;
  pricingExpectation?: string;
}

export interface OrchestratorResult {
  summary: string;
  sections: Record<string, unknown>;
  structured_json: Record<string, unknown>;
}

// ─── Debate Round ─────────────────────────────────────────────────

const DEBATE_SYSTEM_PROMPT = `你是一位产品评审仲裁者。你刚刚收到了多位专家对同一个产品的独立评审意见。

你的任务是：
1. **识别共识**：哪些观点所有角色都同意？
2. **识别分歧**：哪些问题上不同角色有对立意见？对每个分歧，列出支持方和反对方的论点。
3. **给出裁决**：对每个分歧，基于证据给出你的倾向性判断。
4. **标记未解决项**：哪些问题需要更多信息才能判断？

请严格用 JSON 格式返回：
{
  "consensus": ["共识点1", "共识点2"],
  "disputes": [
    {
      "topic": "争议主题",
      "support": ["支持方论点1（角色名: 论据）"],
      "oppose": ["反对方论点1（角色名: 论据）"],
      "resolution": "仲裁者判断"
    }
  ],
  "unresolved": ["待澄清问题1"],
  "summary": "一段话总结对喷结果"
}`;

function buildDebateUserMessage(roleResults: RoleResult[]): string {
  const parts = roleResults.map(r => {
    const roleName = ROLE_NAMES[r.role] || r.role;
    return `## ${roleName}（评分: ${r.score}）
**摘要**: ${r.summary}
**详情**: ${JSON.stringify(r.details, null, 2)}`;
  });

  return `以下是各位专家的独立评审意见：

${parts.join('\n\n---\n\n')}

请对比分析以上所有角色的观点，找出共识和分歧，进行仲裁。`;
}

export async function runDebateRound(roleResults: RoleResult[]): Promise<DebateResult> {
  const messages: QwenMessage[] = [
    { role: 'system', content: DEBATE_SYSTEM_PROMPT },
    { role: 'user', content: buildDebateUserMessage(roleResults) },
  ];

  const raw = await callQwen(messages, 'deepseek-chat', 8000);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as DebateResult;
    }
  } catch {
    // fallback
  }

  return {
    consensus: [],
    disputes: [],
    unresolved: ['Debate 输出解析失败'],
    summary: raw,
  };
}

// ─── Orchestrator Synthesis ───────────────────────────────────────

function buildOrchestratorSystemPrompt(launchContext: LaunchContext): string {
  const contextBlock = [
    launchContext.launchWindow ? `上线窗口: ${launchContext.launchWindow}` : '',
    launchContext.channels?.length ? `目标渠道: ${launchContext.channels.join(', ')}` : '',
    launchContext.constraints ? `约束条件: ${launchContext.constraints}` : '',
    launchContext.pricingExpectation ? `定价预期: ${launchContext.pricingExpectation}` : '',
  ].filter(Boolean).join('\n');

  return `你是 Launch-Ready 产品评测总控（Orchestrator）。你已经收到了：
1. 项目的技术分析报告
2. 9 位专家的独立评审结果
3. 专家之间的对喷/辩论摘要

${contextBlock ? `上线上下文：\n${contextBlock}\n` : ''}
你的任务是把所有信息合成为一份「Launch-Ready 行动报告」。

## 输出规则（严格遵守）

1. **禁止空话**：每个建议必须附带「谁执行、怎么验收、预计工时」。
2. **禁止重复**：如果多个角色提到同一个问题，合并为一条，注明来源角色。
3. **优先级排序**：所有 action item 必须标注 P0/P1/P2。P0 = 上线前必须完成。
4. **量化**：尽可能给出数字（工时、用户数、收入预测、成功率）。

## 输出结构（A-J 十大章节）

请严格用 JSON 格式返回以下结构：
{
  "overall_score": 总分(1-100),
  "launch_verdict": "GO / NO-GO / CONDITIONAL-GO",
  "verdict_conditions": ["前提条件1", "前提条件2"],
  "sections": {
    "A_launch_definition": {
      "title": "Launch 定义与验收标准",
      "checklist": [
        { "item": "验收项", "status": "ready/not-ready/partial", "blocker": true/false }
      ]
    },
    "B_icp_and_market": {
      "title": "ICP 与市场",
      "icp_statement": "一句话描述",
      "reachable_channels": ["渠道1", "渠道2"],
      "tam_estimate": "市场规模估算"
    },
    "C_core_transaction": {
      "title": "核心交易与价值主张",
      "value_proposition": "一句话",
      "mvp_features": ["功能1", "功能2", "功能3"],
      "defer_features": ["延后功能1"]
    },
    "D_release_scope": {
      "title": "Release Scope",
      "included_modules": ["模块1"],
      "excluded_modules": ["模块2"],
      "tech_blockers": ["阻塞项1"]
    },
    "E_debate_summary": {
      "title": "专家对喷摘要",
      "consensus": ["共识1"],
      "key_disputes": ["争议1"],
      "final_resolution": "仲裁结论"
    },
    "F_experiments": {
      "title": "验证实验",
      "experiments": [
        {
          "id": "EXP-1",
          "hypothesis": "假设",
          "method": "方法",
          "success_metric": "成功指标",
          "duration_days": 天数,
          "cost": "成本"
        }
      ]
    },
    "G_instrumentation": {
      "title": "数据埋点与监控",
      "day1_events": ["事件1"],
      "north_star_metric": "北极星指标",
      "alerts": ["告警规则1"]
    },
    "H_roadmap": {
      "title": "迭代路线图",
      "sprint0": ["上线前任务"],
      "week1": ["第一周迭代"],
      "week2": ["第二周迭代"],
      "month1": ["首月目标"]
    },
    "I_risks": {
      "title": "风险登记表",
      "risks": [
        {
          "id": "RISK-1",
          "description": "描述",
          "probability": "high/medium/low",
          "impact": "high/medium/low",
          "mitigation": "缓解措施",
          "owner": "负责角色"
        }
      ]
    },
    "J_pricing": {
      "title": "定价与商业化",
      "recommended_model": "定价模型",
      "price_tiers": [
        { "tier": "层级名", "price": "价格", "features": ["功能"] }
      ],
      "month1_revenue_estimate": "首月收入预估"
    }
  },
  "action_items": [
    {
      "id": "ACT-1",
      "task": "任务描述",
      "priority": "P0/P1/P2",
      "owner_role": "负责角色",
      "effort_hours": 预估工时,
      "acceptance_criteria": "验收标准",
      "depends_on": ["ACT-x"]
    }
  ]
}`;
}

function buildOrchestratorUserMessage(
  projectAnalysis: string,
  context: string,
  roleResults: RoleResult[],
  debate: DebateResult
): string {
  const roleBlock = roleResults.map(r => {
    const name = ROLE_NAMES[r.role] || r.role;
    return `### ${name}（${r.score} 分）\n${r.summary}\n关键发现: ${JSON.stringify(r.details?.actionable_tasks || r.details?.recommendations || r.details?.items || [], null, 2)}`;
  }).join('\n\n');

  return `## 项目背景
${context || '未提供'}

## 技术分析摘要
${projectAnalysis.slice(0, 3000)}

## 各角色评审结果
${roleBlock}

## 对喷/辩论摘要
共识: ${JSON.stringify(debate.consensus)}
争议: ${JSON.stringify(debate.disputes)}
未解决: ${JSON.stringify(debate.unresolved)}
总结: ${debate.summary}

请基于以上所有信息，生成 Launch-Ready 行动报告（A-J 结构 JSON）。`;
}

export async function runOrchestrator(
  projectAnalysis: string,
  context: string,
  roleResults: RoleResult[],
  debate: DebateResult,
  launchContext: LaunchContext
): Promise<OrchestratorResult> {
  const messages: QwenMessage[] = [
    { role: 'system', content: buildOrchestratorSystemPrompt(launchContext) },
    { role: 'user', content: buildOrchestratorUserMessage(projectAnalysis, context, roleResults, debate) },
  ];

  const raw = await callQwen(messages, 'deepseek-chat', 8000);

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: `Launch Verdict: ${parsed.launch_verdict || 'UNKNOWN'} | Score: ${parsed.overall_score || '?'}`,
        sections: parsed.sections || {},
        structured_json: parsed,
      };
    }
  } catch {
    // fallback
  }

  return {
    summary: 'Orchestrator 输出解析失败',
    sections: {},
    structured_json: { raw_output: raw },
  };
}
