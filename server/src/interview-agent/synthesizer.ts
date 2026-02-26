/**
 * Interview Synthesizer
 * Uses LLM to synthesize realistic interview documents from search results
 * and persona definitions.
 */

import { callQwen } from '../ai/qwen';
import { USER_PERSONAS } from '../ai/user-interview';
import type { ResearchResults } from './researcher';

export interface InterviewDocument {
  personaId: string;
  personaName: string;
  personaRole: string;
  markdown: string;
}

export interface InsightsSummary {
  markdown: string;
}

const INTERVIEW_SYNTH_PROMPT = `你是一位专业的用户研究员，擅长从真实行业数据中构建结构化的用户访谈报告。

你将收到：
1. 一个具体的用户画像（角色、背景、关注点）
2. 来自互联网的真实行业搜索结果（含 URL 来源）

请基于这些真实数据，构建一份**模拟但高度真实**的用户访谈记录。

要求：
- 访谈内容必须基于搜索结果中的真实行业数据和痛点
- 引用真实来源 URL 作为数据支撑
- 包含具体的数字、场景、案例（从搜索结果提取或合理推导）
- 语气符合该画像的性格特征
- 用中文撰写，关键术语保留英文

输出 Markdown 格式：

# 用户访谈记录：[角色名] [姓名]

## 画像概述
- **角色**：xxx
- **背景**：xxx
- **核心关注**：xxx

## 行业痛点反馈

### 痛点 1：[标题]
**场景描述**："[用户原话模拟]"
**行业数据**：[引用搜索结果中的具体数据]
**来源**：[URL]

### 痛点 2：...
（3-5 个痛点）

## 对 DDT-WMS 的期望
- [期望 1]
- [期望 2]
- ...

## 付费意愿评估
- **预算范围**：xxx
- **决策因素**：xxx
- **竞品对比**：xxx

## 关键语录
> "[模拟语录 1]"
> "[模拟语录 2]"
> "[模拟语录 3]"

## 访谈小结
[一段话总结该用户的核心需求和对产品的态度]`;

const INSIGHTS_PROMPT = `你是一位高级产品经理，负责汇总 8 位用户的访谈结果并输出 PMF 验证报告。

请基于所有访谈摘要，输出一份结构化的洞察报告：

# 用户访谈综合洞察报告

## 调研概述
- 访谈人数、角色分布、时间范围

## 核心发现

### 1. 高频痛点 Top 5
（按提及频次排序，标注涉及的角色）

### 2. PMF 验证信号
- ✅ 强信号：[用户明确表达愿意付费/替换现有方案的证据]
- ⚠️ 弱信号：[需要更多验证的假设]
- ❌ 风险信号：[可能阻碍采用的因素]

### 3. 功能优先级矩阵
| 功能 | 用户需求强度 | 当前实现状态 | 建议优先级 |
|------|------------|------------|-----------|
| ... | ... | ... | ... |

### 4. 竞品感知
- 用户提及的替代方案
- DDT-WMS 的差异化优势

## 定价洞察
- 用户预算范围分布
- 付费模式偏好

## 行动建议
1. [建议 1]
2. [建议 2]
3. ...

## 数据来源
- 搜索引擎真实数据 + 用户画像模拟访谈
- 所有行业数据均有 URL 来源标注`;

// Map persona enneagram type to research topic ID
const PERSONA_TOPIC_MAP: Record<number, string> = {
  1: 'compliance',
  2: 'customer',
  3: 'sales',
  5: 'analyst',
  6: 'risk',
  7: 'startup',
  8: 'boss',
  9: 'operator',
};

export async function synthesizeInterviews(
  researchResults: ResearchResults[],
): Promise<InterviewDocument[]> {
  const docs: InterviewDocument[] = [];

  for (const persona of USER_PERSONAS) {
    const topicId = PERSONA_TOPIC_MAP[persona.enneagramType];
    const research = researchResults.find(r => r.topicId === topicId);

    const snippets = research
      ? research.results.map((r, i) =>
          `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    摘要: ${r.snippet}`
        ).join('\n\n')
      : '（无搜索结果，请基于行业通识生成）';

    const personaDesc = `角色: ${persona.role} ${persona.name}
背景: ${persona.background}
关注领域: ${persona.focusAreas.join('、')}
口头禅: "${persona.catchphrase}"
常见痛点: ${persona.painPoints.join('、')}`;

    console.log(`[interview-agent] Synthesizing interview for ${persona.role} ${persona.name}...`);

    try {
      const response = await callQwen([
        { role: 'system', content: INTERVIEW_SYNTH_PROMPT },
        { role: 'user', content: `## 用户画像\n${personaDesc}\n\n## 搜索到的真实行业数据\n${snippets}\n\n请为「DDT-WMS 数字孪生仓储管理平台」生成该用户的访谈记录。产品定位：面向跨境贸易企业的数字孪生 WMS，支持 1039 市场采购模式，集成 Event Sourcing + CQRS 架构。` },
      ], 'deepseek-chat', 4000);

      docs.push({
        personaId: persona.id,
        personaName: persona.name,
        personaRole: persona.role,
        markdown: response,
      });
    } catch (err) {
      console.error(`[interview-agent] Failed to synthesize for ${persona.name}:`, err);
      docs.push({
        personaId: persona.id,
        personaName: persona.name,
        personaRole: persona.role,
        markdown: `# 用户访谈记录：${persona.role} ${persona.name}\n\n> 合成失败，请重试。`,
      });
    }
  }

  return docs;
}

export async function synthesizeInsights(
  interviews: InterviewDocument[],
): Promise<InsightsSummary> {
  const summaries = interviews.map(doc => {
    // Extract first ~500 chars as summary
    const lines = doc.markdown.split('\n').slice(0, 30).join('\n');
    return `### ${doc.personaRole} ${doc.personaName}\n${lines.substring(0, 600)}`;
  }).join('\n\n---\n\n');

  console.log('[interview-agent] Synthesizing insights summary...');

  try {
    const response = await callQwen([
      { role: 'system', content: INSIGHTS_PROMPT },
      { role: 'user', content: `以下是 8 位用户的访谈摘要：\n\n${summaries}\n\n请输出综合洞察报告。` },
    ], 'deepseek-chat', 4000);

    return { markdown: response };
  } catch (err) {
    console.error('[interview-agent] Failed to synthesize insights:', err);
    return { markdown: '# 综合洞察报告\n\n> 合成失败，请重试。' };
  }
}
