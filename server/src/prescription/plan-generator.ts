/**
 * Plan Generator
 * Uses AI to generate Windsurf plan-mode compatible .md files
 * from gaps + community insights + project analysis context.
 */

import { callQwen } from '../ai/qwen';
import type { Gap, CommunityInsight, Prescription } from './types';

// ─── System Prompt ──────────────────────────────────────────────────────

const PLAN_GENERATOR_PROMPT = `你是一个高级技术顾问，负责将代码评审发现的问题转化为 Windsurf IDE 可执行的计划文件。

输出格式要求（严格遵守）：

1. 第一行必须是 YAML frontmatter:
---
description: [一句话描述，英文]
---

2. 接着是 ## Background 章节：解释问题背景和评审发现

3. ## Community References 章节：引用真实社区讨论（带链接）

4. ## Plan 章节：具体执行步骤（Cascade 可直接跟随执行）
   - 每步必须是具体的文件操作（创建/修改/删除文件）
   - 引用具体文件路径
   - 包含代码片段示例（如需要）
   - 不要写"建议团队讨论"这种空话

5. ## Acceptance Criteria 章节：验证标准

关键约束：
- code_fix 类：必须引用具体文件路径和代码改动
- validation 类：必须产出可填充的文档/模板，或添加可运行的追踪代码
- integration 类：必须给出具体 API 调用示例和配置步骤
- 每个 plan 控制在 40-60 行
- 用中文写 Background 和 Community References，Plan 步骤用英文动词开头

只输出 plan 文件内容本身，不要额外说明。`;

// ─── Category-specific context ──────────────────────────────────────────

function getCategoryGuidance(category: string): string {
  switch (category) {
    case 'code_fix':
      return `重点：产品完整性修复。确保 Plan 步骤涉及具体的前端页面串联、API 调用链路、数据流转。
如果问题是"E2E 流未串联"，Plan 应该包含：哪些页面之间需要添加导航、哪些 API 需要按序调用、如何写 E2E 测试。`;
    case 'validation':
      return `重点：市场验证和用户反馈。Plan 步骤应该产出：
- 可填充的验证追踪文档
- 前端埋点/事件追踪代码
- 用户反馈收集机制
不要写纯策略建议，要写可执行的代码或文档改动。`;
    case 'integration':
      return `重点：外部系统对接。Plan 步骤应该包含：
- 具体的 API 调用示例（含请求/响应格式）
- 环境变量配置
- 错误处理和降级方案
- 健康检查集成`;
    default:
      return '';
  }
}

// ─── Plan Generation ────────────────────────────────────────────────────

export async function generatePlan(
  gap: Gap,
  insight: CommunityInsight,
  projectContext: string,
): Promise<{ planContent: string; filename: string }> {
  // Build community reference text
  const communityText = insight.results.length > 0
    ? insight.results.slice(0, 5).map(r =>
        `- **${r.source}**: "${r.title}" — ${r.url} ${r.publishedDate ? `(${r.publishedDate})` : ''}`
      ).join('\n')
    : '未找到直接相关的社区讨论。';

  const synthesisText = insight.synthesis || '';

  const userMessage = `## 问题
ID: ${gap.id}
标题: ${gap.title}
类别: ${gap.category}
优先级: ${gap.priority}
来源角色: ${gap.sourceRoles.join(', ')}
详情: ${gap.description}
证据:
${gap.evidence.map(e => `- ${e}`).join('\n')}
${gap.relatedFiles ? `相关文件: ${gap.relatedFiles.join(', ')}` : ''}

## 社区搜索结果
${communityText}

## 社区建议摘要
${synthesisText}

## 项目上下文
${projectContext}

## 类别指导
${getCategoryGuidance(gap.category)}`;

  const response = await callQwen([
    { role: 'system', content: PLAN_GENERATOR_PROMPT },
    { role: 'user', content: userMessage },
  ], 'deepseek-chat', 3000);

  // Generate filename
  const slugTitle = gap.title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
  const idx = gap.id.replace('gap-', '');
  const filename = `rx-${idx}-${slugTitle}.md`;

  // Ensure plan has frontmatter
  let planContent = response.trim();
  if (!planContent.startsWith('---')) {
    planContent = `---\ndescription: ${gap.title}\n---\n\n${planContent}`;
  }

  return { planContent, filename };
}

// ─── Batch Generation ───────────────────────────────────────────────────

export async function generateAllPlans(
  gaps: Gap[],
  insights: CommunityInsight[],
  projectContext: string,
): Promise<Prescription[]> {
  const prescriptions: Prescription[] = [];

  for (const gap of gaps) {
    const insight = insights.find(i => i.gapId === gap.id) || {
      gapId: gap.id,
      results: [],
      llmAdvice: '',
      synthesis: '',
      queriesUsed: [],
      sourceStrategy: 'llm_only' as const,
    };

    console.log(`[prescription] Generating plan for ${gap.id}: ${gap.title.substring(0, 50)}...`);

    try {
      const { planContent, filename } = await generatePlan(gap, insight, projectContext);

      prescriptions.push({
        id: `rx-${gap.id}`,
        gapId: gap.id,
        gap,
        community: insight,
        planContent,
        filename,
      });
    } catch (err) {
      console.error(`[prescription] Failed to generate plan for ${gap.id}:`, err);
      // Create a fallback plan
      const fallbackContent = `---
description: ${gap.title}
---

## Background

Code Reviewer 评估发现: ${gap.description}

来源角色: ${gap.sourceRoles.join(', ')}

## Plan

> ⚠️ 自动生成失败，请手动制定修复方案。

## 问题详情

${gap.evidence.map(e => `- ${e}`).join('\n')}
`;
      prescriptions.push({
        id: `rx-${gap.id}`,
        gapId: gap.id,
        gap,
        community: insight,
        planContent: fallbackContent,
        filename: `rx-${gap.id.replace('gap-', '')}-manual.md`,
      });
    }
  }

  return prescriptions;
}
