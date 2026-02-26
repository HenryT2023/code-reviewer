/**
 * Interview Agent
 * API routes for running the Brave Search + LLM interview research agent
 * and injecting results into DDT-Monodt evaluation context.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { researchAllTopics } from './researcher';
import { synthesizeInterviews, synthesizeInsights } from './synthesizer';
import type { InterviewDocument, InsightsSummary } from './synthesizer';
import type { ResearchResults } from './researcher';

const router = Router();

// In-memory cache for last run results
let lastRunResults: {
  research: ResearchResults[];
  interviews: InterviewDocument[];
  insights: InsightsSummary;
  timestamp: number;
} | null = null;

// ─── Run the full agent pipeline ──────────────────────────────────────

router.post('/run', async (req: Request, res: Response) => {
  const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveApiKey) {
    return res.status(400).json({ error: 'BRAVE_SEARCH_API_KEY not configured' });
  }

  const targetPath = req.body.targetPath as string | undefined;

  try {
    console.log('[interview-agent] Starting full pipeline...');

    // Phase 1: Research
    console.log('[interview-agent] Phase 1: Brave Search research...');
    const research = await researchAllTopics(braveApiKey);

    // Phase 2: Synthesize interviews
    console.log('[interview-agent] Phase 2: LLM interview synthesis...');
    const interviews = await synthesizeInterviews(research);

    // Phase 3: Generate insights summary
    console.log('[interview-agent] Phase 3: Insights synthesis...');
    const insights = await synthesizeInsights(interviews);

    lastRunResults = { research, interviews, insights, timestamp: Date.now() };

    // Phase 4: Write to target project if path provided
    if (targetPath) {
      const written = writeInterviewDocs(targetPath, interviews, insights);
      console.log(`[interview-agent] Wrote ${written} files to ${targetPath}`);
    }

    res.json({
      success: true,
      stats: {
        personas: interviews.length,
        totalSearchResults: research.reduce((sum, r) => sum + r.results.length, 0),
        filesWritten: targetPath ? interviews.length + 2 : 0,
      },
      timestamp: lastRunResults.timestamp,
    });
  } catch (err: any) {
    console.error('[interview-agent] Pipeline failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Get last run results ─────────────────────────────────────────────

router.get('/results', (_req: Request, res: Response) => {
  if (!lastRunResults) {
    return res.status(404).json({ error: 'No results yet. Run the agent first.' });
  }
  res.json({
    timestamp: lastRunResults.timestamp,
    interviews: lastRunResults.interviews.map(d => ({
      personaId: d.personaId,
      personaName: d.personaName,
      personaRole: d.personaRole,
      markdownLength: d.markdown.length,
    })),
    insightsLength: lastRunResults.insights.markdown.length,
  });
});

// ─── Write docs to a target project ──────────────────────────────────

router.post('/write', (req: Request, res: Response) => {
  if (!lastRunResults) {
    return res.status(404).json({ error: 'No results yet. Run the agent first.' });
  }
  const targetPath = req.body.targetPath as string;
  if (!targetPath) {
    return res.status(400).json({ error: 'targetPath required' });
  }

  const written = writeInterviewDocs(targetPath, lastRunResults.interviews, lastRunResults.insights);
  res.json({ success: true, filesWritten: written });
});

// ─── Get context string for evaluation injection ─────────────────────

export function getInterviewContextForEval(projectPath: string): string {
  const interviewDir = path.join(projectPath, 'docs', 'user_interviews');
  if (!fs.existsSync(interviewDir)) return '';

  const summaryPath = path.join(interviewDir, 'INSIGHTS_SUMMARY.md');
  if (!fs.existsSync(summaryPath)) return '';

  try {
    const summary = fs.readFileSync(summaryPath, 'utf-8');
    // Return a condensed version for context injection
    return `\n\n## 用户访谈研究报告（基于真实行业数据）\n\n${summary.substring(0, 3000)}`;
  } catch {
    return '';
  }
}

// ─── File Writer Helper ──────────────────────────────────────────────

const PERSONA_FILE_MAP: Record<string, string> = {
  perfectionist: 'persona_01_compliance.md',
  helper: 'persona_02_customer.md',
  achiever: 'persona_03_sales.md',
  investigator: 'persona_04_analyst.md',
  loyalist: 'persona_05_risk.md',
  enthusiast: 'persona_06_startup.md',
  challenger: 'persona_07_boss.md',
  peacemaker: 'persona_08_operator.md',
};

function writeInterviewDocs(
  projectPath: string,
  interviews: InterviewDocument[],
  insights: InsightsSummary,
): number {
  const outDir = path.join(projectPath, 'docs', 'user_interviews');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let written = 0;

  // Write README
  const readme = `# DDT-WMS 用户访谈研究

## 研究方法

本访谈研究采用 **Brave Search + LLM 双通道** 方法：

1. **数据采集**：通过 Brave Search API 搜索真实的 WMS/跨境物流行业资料，涵盖知乎、Reddit、福步外贸论坛、Stack Overflow 等 13 个社区源
2. **画像模拟**：基于九型人格模型定义 8 个典型用户画像（合规经理、客户经理、销售总监、数据分析师、风控主管、创业老板、公司老板、运营专员）
3. **访谈合成**：LLM 基于真实搜索数据为每个画像生成结构化访谈记录
4. **洞察提炼**：交叉分析所有访谈，输出 PMF 验证结论和功能优先级

## 访谈文件索引

| 文件 | 画像 | 角色 |
|------|------|------|
| persona_01_compliance.md | 1号-完美型 王主管 | 合规经理 |
| persona_02_customer.md | 2号-助人型 李姐 | 客户经理 |
| persona_03_sales.md | 3号-成就型 张总 | 销售总监 |
| persona_04_analyst.md | 5号-理智型 陈工 | 数据分析师 |
| persona_05_risk.md | 6号-忠诚型 刘经理 | 风控主管 |
| persona_06_startup.md | 7号-活跃型 小周 | 创业老板 |
| persona_07_boss.md | 8号-领袖型 赵总 | 公司老板 |
| persona_08_operator.md | 9号-和平型 小林 | 运营专员 |
| INSIGHTS_SUMMARY.md | — | 综合洞察报告 |

## 生成时间

${new Date().toISOString()}
`;
  fs.writeFileSync(path.join(outDir, 'README.md'), readme, 'utf-8');
  written++;

  // Write each persona interview
  for (const doc of interviews) {
    const filename = PERSONA_FILE_MAP[doc.personaId] || `persona_${doc.personaId}.md`;
    fs.writeFileSync(path.join(outDir, filename), doc.markdown, 'utf-8');
    written++;
  }

  // Write insights summary
  fs.writeFileSync(path.join(outDir, 'INSIGHTS_SUMMARY.md'), insights.markdown, 'utf-8');
  written++;

  return written;
}

export default router;
