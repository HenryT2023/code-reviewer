// Role Evolution: Reflection Agent + Evolution Synthesizer
// Phase 3 of evaluation: self-critique and prompt improvement suggestions

import { callQwen, QwenMessage } from './qwen';
import { ROLE_REGISTRY, ROLE_NAMES } from './roles';

// ─── Types ───────────────────────────────────────────────────────────

export interface RoleResult {
  role: string;
  score: number;
  summary: string;
  details: Record<string, unknown>;
}

export interface RoleAssessment {
  role: string;
  quality_score: number;
  strengths: string[];
  weaknesses: string[];
  prompt_suggestions: string[];
  redundancy_with: string[];
}

export interface NewRoleProposal {
  id: string;
  label: string;
  emoji: string;
  rationale: string;
  draft_prompt_sketch: string;
}

export interface ReflectionResult {
  evaluation_id: string;
  timestamp: string;
  role_assessments: RoleAssessment[];
  blind_spots: string[];
  new_role_proposals: NewRoleProposal[];
  meta_observations: string;
}

export interface PromptDiff {
  role: string;
  suggested_additions: string[];
  suggested_removals: string[];
  rewritten_prompt: string;
  confidence: number;
  evidence_count: number;
}

export interface NewRoleDefinition {
  id: string;
  label: string;
  emoji: string;
  category: 'primary' | 'extended';
  standard_prompt: string;
  launch_ready_prompt: string;
  proposal_count: number;
  confidence: number;
}

export interface RetireCandidate {
  role: string;
  reason: string;
}

export interface EvolutionSynthesis {
  version: string;
  generated_at: string;
  prompt_diffs: PromptDiff[];
  new_roles: NewRoleDefinition[];
  retire_candidates: RetireCandidate[];
}

// ─── Reflection Agent ────────────────────────────────────────────────

const REFLECTION_SYSTEM_PROMPT = `你是一位 AI 评测系统的质量审计员。你刚刚收到了多位 AI 角色对同一个产品的评测输出。

你的任务是对每个角色的输出质量进行评估，并提出改进建议。

## 评估维度（每个角色）
1. **质量评分 (1-100)**：输出是否具体、有洞察力、可执行？
2. **优点**：这个角色做得好的地方
3. **缺点**：这个角色的输出有什么问题？（空话、重复、遗漏、不可执行等）
4. **Prompt 改进建议**：如何修改这个角色的 system prompt 来改善输出？
5. **冗余检测**：这个角色的输出是否与其他角色高度重复？

## 整体分析
1. **盲区**：所有角色都没有覆盖的重要维度（如法律合规、国际化、无障碍等）
2. **新角色提议**：如果发现明显盲区，提议一个新角色来填补
3. **元观察**：对整个评测系统的宏观观察

请严格用 JSON 格式返回：
{
  "role_assessments": [
    {
      "role": "角色ID",
      "quality_score": 85,
      "strengths": ["优点1"],
      "weaknesses": ["缺点1"],
      "prompt_suggestions": ["建议1"],
      "redundancy_with": ["与哪个角色重复"]
    }
  ],
  "blind_spots": ["盲区1", "盲区2"],
  "new_role_proposals": [
    {
      "id": "legal_compliance",
      "label": "法务/合规",
      "emoji": "⚖️",
      "rationale": "为什么需要这个角色",
      "draft_prompt_sketch": "你是一位专注于..."
    }
  ],
  "meta_observations": "对整个评测系统的宏观观察"
}`;

export interface MrepQualityMetrics {
  role_id: string;
  total_claims: number;
  evidence_coverage: number;
  verification_pass_rate: number | null;
  avg_confidence: number;
}

function buildReflectionUserMessage(
  roleResults: RoleResult[],
  debateSummary?: string,
  mrepMetrics?: MrepQualityMetrics[],
  judgmentSummary?: string
): string {
  const roleBlock = roleResults.map(r => {
    const roleName = ROLE_NAMES[r.role] || r.role;
    let block = `## ${roleName}（评分: ${r.score}）
**摘要**: ${r.summary}
**详情**: ${JSON.stringify(r.details, null, 2)}`;

    // Append MREP metrics if available for this role
    const mrep = mrepMetrics?.find(m => m.role_id === r.role);
    if (mrep) {
      block += `\n**MREP 客观指标**: claims=${mrep.total_claims}, 证据覆盖率=${mrep.evidence_coverage}, 验证通过率=${mrep.verification_pass_rate ?? 'N/A'}, 平均置信度=${mrep.avg_confidence}`;
    }

    return block;
  }).join('\n\n---\n\n');

  let message = `以下是各角色的评测输出：

${roleBlock}`;

  if (debateSummary) {
    message += `\n\n## 对喷/辩论摘要\n${debateSummary}`;
  }

  if (mrepMetrics && mrepMetrics.length > 0) {
    message += `\n\n## MREP 客观质量指标说明
以上部分角色（coder, architect, fact_checker）附带了 MREP 指标。这些是程序化验证的客观数据：
- **证据覆盖率**：claim 中有具体代码/文件引用的比例
- **验证通过率**：引用的文件/代码经程序化验证确实存在的比例
- **平均置信度**：AI 对自身断言的平均信心值
请在评估角色质量时参考这些客观指标，verification_pass_rate 越高说明角色输出越可靠。`;
  }

  if (judgmentSummary) {
    message += `\n\n${judgmentSummary}`;
  }

  message += `\n\n请对以上所有角色的输出质量进行评估，找出盲区，并提出改进建议。`;

  return message;
}

export async function runReflection(
  evaluationId: string,
  roleResults: RoleResult[],
  debateSummary?: string,
  mrepMetrics?: MrepQualityMetrics[],
  judgmentSummary?: string
): Promise<ReflectionResult> {
  const messages: QwenMessage[] = [
    { role: 'system', content: REFLECTION_SYSTEM_PROMPT },
    { role: 'user', content: buildReflectionUserMessage(roleResults, debateSummary, mrepMetrics, judgmentSummary) },
  ];

  const raw = await callQwen(messages, 'deepseek-chat', 4000);

  let parsed: Partial<ReflectionResult> = {};
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fallback
  }

  return {
    evaluation_id: evaluationId,
    timestamp: new Date().toISOString(),
    role_assessments: parsed.role_assessments || [],
    blind_spots: parsed.blind_spots || [],
    new_role_proposals: parsed.new_role_proposals || [],
    meta_observations: parsed.meta_observations || raw,
  };
}

// ─── Evolution Synthesizer ───────────────────────────────────────────

const SYNTHESIS_SYSTEM_PROMPT = `你是一位 AI 系统进化专家。你收到了多次评测后的反思记录，需要合成出具体的改进方案。

## 输入
- 多次评测的反思记录（每次包含各角色的质量评分、优缺点、改进建议、盲区、新角色提议）

## 输出要求
1. **Prompt Diff**：对每个需要改进的角色，给出具体的 Prompt 修改建议
   - 建议添加的内容
   - 建议移除的内容
   - 完整的重写版本（如果改动较大）
   - 置信度（基于多少次反馈得出）

2. **新角色定义**：如果多次反思都提议同一个新角色，给出完整的角色定义
   - ID、标签、emoji、分类
   - 标准模式 Prompt
   - Launch-Ready 模式 Prompt
   - 置信度

3. **退役候选**：如果某个角色连续多次质量低且与其他角色高度重复，建议退役

请严格用 JSON 格式返回：
{
  "version": "v2",
  "prompt_diffs": [
    {
      "role": "boss",
      "suggested_additions": ["增加竞品分析维度"],
      "suggested_removals": ["移除过于笼统的描述"],
      "rewritten_prompt": "完整新 Prompt...",
      "confidence": 0.82,
      "evidence_count": 5
    }
  ],
  "new_roles": [
    {
      "id": "legal_compliance",
      "label": "法务/合规",
      "emoji": "⚖️",
      "category": "extended",
      "standard_prompt": "完整 Prompt...",
      "launch_ready_prompt": "完整 Prompt...",
      "proposal_count": 3,
      "confidence": 0.75
    }
  ],
  "retire_candidates": [
    {
      "role": "xxx",
      "reason": "连续 5 次评测质量低于 60 分且与其他角色高度重复"
    }
  ]
}`;

function buildSynthesisUserMessage(reflections: ReflectionResult[]): string {
  const blocks = reflections.map((r, i) => {
    return `## 反思 #${i + 1} (${r.timestamp})
**角色评估**:
${r.role_assessments.map(a => `- ${a.role}: ${a.quality_score}分, 优点: ${a.strengths.join(', ')}, 缺点: ${a.weaknesses.join(', ')}, 建议: ${a.prompt_suggestions.join(', ')}`).join('\n')}

**盲区**: ${r.blind_spots.join(', ') || '无'}

**新角色提议**:
${r.new_role_proposals.map(p => `- ${p.emoji} ${p.label} (${p.id}): ${p.rationale}`).join('\n') || '无'}

**元观察**: ${r.meta_observations}`;
  }).join('\n\n---\n\n');

  return `以下是最近 ${reflections.length} 次评测的反思记录：

${blocks}

请基于以上所有反思记录，合成出具体的改进方案。`;
}

export async function runEvolutionSynthesis(
  reflections: ReflectionResult[]
): Promise<EvolutionSynthesis> {
  if (reflections.length === 0) {
    return {
      version: 'v1',
      generated_at: new Date().toISOString(),
      prompt_diffs: [],
      new_roles: [],
      retire_candidates: [],
    };
  }

  const messages: QwenMessage[] = [
    { role: 'system', content: SYNTHESIS_SYSTEM_PROMPT },
    { role: 'user', content: buildSynthesisUserMessage(reflections) },
  ];

  const raw = await callQwen(messages, 'deepseek-chat', 8000);

  let parsed: Partial<EvolutionSynthesis> = {};
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fallback
  }

  return {
    version: parsed.version || 'v1',
    generated_at: new Date().toISOString(),
    prompt_diffs: parsed.prompt_diffs || [],
    new_roles: parsed.new_roles || [],
    retire_candidates: parsed.retire_candidates || [],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function getAverageQualityScore(reflections: ReflectionResult[], roleId: string): number {
  const scores = reflections
    .flatMap(r => r.role_assessments)
    .filter(a => a.role === roleId)
    .map(a => a.quality_score);
  
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function getProposalCount(reflections: ReflectionResult[], newRoleId: string): number {
  return reflections
    .flatMap(r => r.new_role_proposals)
    .filter(p => p.id === newRoleId)
    .length;
}

export function getCommonBlindSpots(reflections: ReflectionResult[]): string[] {
  const counts: Record<string, number> = {};
  reflections.forEach(r => {
    r.blind_spots.forEach(spot => {
      counts[spot] = (counts[spot] || 0) + 1;
    });
  });
  
  return Object.entries(counts)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([spot]) => spot);
}
