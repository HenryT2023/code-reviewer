/**
 * Community Searcher
 * Brave Search API adapter with community source registry, query construction via AI,
 * and 7-day result caching.
 */

import https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { callQwen } from '../ai/qwen';
import type { Gap, CommunitySource, SearchQuery, SearchResult, CommunityInsight, SourceStrategy } from './types';

// ─── Community Source Registry ──────────────────────────────────────────

const SOURCES: CommunitySource[] = [
  // International
  { id: 'stackoverflow', name: 'Stack Overflow', siteFilter: 'site:stackoverflow.com', language: 'en', domain: 'general' },
  { id: 'reddit-saas', name: 'Reddit r/SaaS', siteFilter: 'site:reddit.com/r/SaaS', language: 'en', domain: 'saas' },
  { id: 'reddit-startups', name: 'Reddit r/startups', siteFilter: 'site:reddit.com/r/startups', language: 'en', domain: 'startup' },
  { id: 'hackernews', name: 'Hacker News', siteFilter: 'site:news.ycombinator.com', language: 'en', domain: 'general' },
  { id: 'indiehackers', name: 'Indie Hackers', siteFilter: 'site:indiehackers.com', language: 'en', domain: 'startup' },
  { id: 'devto', name: 'Dev.to', siteFilter: 'site:dev.to', language: 'en', domain: 'general' },
  // Chinese
  { id: 'zhihu', name: '知乎', siteFilter: 'site:zhihu.com', language: 'cn', domain: 'general' },
  { id: 'v2ex', name: 'V2EX', siteFilter: 'site:v2ex.com', language: 'cn', domain: 'general' },
  { id: 'juejin', name: '掘金', siteFilter: 'site:juejin.cn', language: 'cn', domain: 'general' },
  { id: 'segmentfault', name: 'SegmentFault', siteFilter: 'site:segmentfault.com', language: 'cn', domain: 'general' },
  // Trade-specific
  { id: 'fob', name: '福步外贸论坛', siteFilter: 'site:fob.vip', language: 'cn', domain: 'trade' },
  { id: 'waimaoquan', name: '阿里外贸圈', siteFilter: 'site:waimaoquan.alibaba.com', language: 'cn', domain: 'trade' },
  { id: 'reddit-importing', name: 'Reddit r/importing', siteFilter: 'site:reddit.com/r/importing', language: 'en', domain: 'trade' },
];

export function getAllSources(): CommunitySource[] {
  return SOURCES;
}

// ─── Cache ──────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'community-cache');

function getCachePath(queryHash: string): string {
  return path.join(CACHE_DIR, `${queryHash}.json`);
}

function queryHash(query: string): string {
  return crypto.createHash('md5').update(query).digest('hex').substring(0, 12);
}

function getCachedResults(query: string, ttlDays: number): SearchResult[] | null {
  const hash = queryHash(query);
  const cachePath = getCachePath(hash);

  if (!fs.existsSync(cachePath)) return null;

  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const age = (Date.now() - cached.timestamp) / (1000 * 60 * 60 * 24);
    if (age > ttlDays) return null;
    return cached.results;
  } catch {
    return null;
  }
}

function setCachedResults(query: string, results: SearchResult[]): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  const hash = queryHash(query);
  fs.writeFileSync(getCachePath(hash), JSON.stringify({
    query,
    timestamp: Date.now(),
    results,
  }), 'utf-8');
}

// ─── Brave Search API ───────────────────────────────────────────────────

export async function braveSearch(query: string, apiKey: string, count: number = 5): Promise<SearchResult[]> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      q: query,
      count: String(count),
    });
    const url = `https://api.search.brave.com/res/v1/web/search?${params.toString()}`;
    const parsedUrl = new URL(url);

    const req = https.request({
      hostname: parsedUrl.hostname,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          let body = Buffer.concat(chunks).toString('utf-8');
          // Handle gzip if needed
          if (res.headers['content-encoding'] === 'gzip') {
            const zlib = require('zlib');
            body = zlib.gunzipSync(Buffer.concat(chunks)).toString('utf-8');
          }
          const json = JSON.parse(body);
          const results: SearchResult[] = (json.web?.results || []).map((r: any) => ({
            title: r.title || '',
            url: r.url || '',
            snippet: r.description || '',
            source: new URL(r.url || 'https://unknown').hostname,
            publishedDate: r.page_age || undefined,
          }));
          resolve(results);
        } catch (e) {
          reject(new Error(`Brave Search parse error: ${e}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Brave Search request error: ${e}`)));
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Brave Search timeout'));
    });
    req.end();
  });
}

// ─── AI Query Builder ───────────────────────────────────────────────────

const QUERY_BUILDER_PROMPT = `你是一个搜索查询构造器。给定一组项目评估发现的问题（gaps），为每个问题生成精确的搜索查询。

规则：
1. 每个 gap 生成 2 条查询：1 条英文（面向 Stack Overflow/Reddit/HN），1 条中文（面向知乎/V2EX/掘金）
2. 查询应该是具体的、可搜索的短语，不是问句
3. 包含相关技术关键词和最佳实践关键词
4. 不要加 site: 过滤（系统会自动添加）
5. 每条查询 5-15 个词

严格返回 JSON 数组：
[
  { "gapId": "gap-001", "en": "FastAPI payment integration Stripe best practices 2024", "cn": "FastAPI 接入支付 实战经验 最佳实践" },
  ...
]

只返回 JSON，不要其他内容。`;

interface QueryPair {
  gapId: string;
  en: string;
  cn: string;
}

async function buildSearchQueries(gaps: Gap[]): Promise<SearchQuery[]> {
  const gapDescriptions = gaps.map(g =>
    `[${g.id}] (${g.category}) ${g.title}: ${g.description.substring(0, 200)}`
  ).join('\n');

  const response = await callQwen([
    { role: 'system', content: QUERY_BUILDER_PROMPT },
    { role: 'user', content: `项目评估发现的问题：\n${gapDescriptions}` },
  ]);

  let pairs: QueryPair[];
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    pairs = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    console.error('[prescription] Failed to parse query builder response');
    pairs = gaps.map(g => ({
      gapId: g.id,
      en: g.title,
      cn: g.title,
    }));
  }

  const queries: SearchQuery[] = [];

  for (const pair of pairs) {
    const gap = gaps.find(g => g.id === pair.gapId);
    if (!gap) continue;

    // Select sources based on gap category
    const enSources = gap.category === 'validation'
      ? ['indiehackers', 'reddit-saas', 'reddit-startups']
      : gap.category === 'integration'
        ? ['stackoverflow', 'devto']
        : ['stackoverflow', 'reddit-saas', 'hackernews'];

    const cnSources = gap.category === 'validation'
      ? ['zhihu', 'v2ex']
      : ['zhihu', 'juejin', 'segmentfault'];

    // Add trade sources if gap involves trade domain
    const hasTradeRole = gap.sourceRoles.some(r => r === 'trade_expert');
    if (hasTradeRole) {
      cnSources.push('fob', 'waimaoquan');
      enSources.push('reddit-importing');
    }

    // Add supply chain sources if gap involves food supply chain domain
    const hasSupplyChainRole = gap.sourceRoles.some(r => r === 'supply_chain_expert');
    if (hasSupplyChainRole) {
      cnSources.push('zhihu', 'juejin');
      enSources.push('reddit-supplychain', 'stackoverflow');
    }

    queries.push({
      gapId: pair.gapId,
      query: pair.en,
      language: 'en',
      targetSources: enSources,
    });
    queries.push({
      gapId: pair.gapId,
      query: pair.cn,
      language: 'cn',
      targetSources: cnSources,
    });
  }

  return queries;
}

// ─── Channel B: LLM Expert Advisor ──────────────────────────────────────

const LLM_EXPERT_PROMPT = `你是一位资深技术顾问和产品专家，拥有丰富的 SaaS 产品交付、B2B 软件、跨境贸易系统的实战经验。

你将收到一个项目评估中发现的具体问题。请以专家身份给出建议。

规则：
1. 给出 3-5 条具体的、可操作的建议
2. 区分"高置信度建议"（你确定的行业最佳实践）和"推测性建议"（需要进一步验证的）
3. 区分"技术实现建议"和"商业策略建议"
4. 如果某条建议需要特定前提条件，明确说明
5. 用中文回答，关键技术术语保留英文

输出格式（纯文本，不要 JSON）：

**高置信度建议：**
1. [建议内容] — 类型: [技术/商业] — 前提: [如有]
2. ...

**推测性建议（需验证）：**
1. [建议内容] — 类型: [技术/商业] — 需验证: [什么]
2. ...`;

async function consultLlmExpert(gap: Gap): Promise<string> {
  try {
    const categoryLabel = gap.category === 'code_fix' ? '产品完整性'
      : gap.category === 'validation' ? '市场验证'
      : '外部集成';

    const response = await callQwen([
      { role: 'system', content: LLM_EXPERT_PROMPT },
      { role: 'user', content: `问题领域: ${categoryLabel}\n标题: ${gap.title}\n详情: ${gap.description}\n来源评估角色: ${gap.sourceRoles.join(', ')}\n证据:\n${gap.evidence.map(e => `- ${e}`).join('\n')}` },
    ]);
    return response;
  } catch (err) {
    console.error(`[prescription] LLM expert consultation failed for ${gap.id}:`, err);
    return '';
  }
}

// ─── Cross-Validation Synthesis ─────────────────────────────────────────

const CROSS_VALIDATION_PROMPT = `你是一个信息交叉验证专家。你收到两个独立信息通道对同一问题的分析：
- Channel A: 互联网社区搜索结果（有 URL 来源但可能有噪声）
- Channel B: LLM 专家直接建议（体系化但无来源佐证）

你的任务是交叉验证并合并为最终建议。

交叉验证规则：
1. 如果两个通道给出一致建议 → 标记为 ✅ 高置信度
2. 如果仅 LLM 专家给出、社区搜索无佐证 → 标记为 ⚠️ 专家建议（待验证）
3. 如果两个通道矛盾 → 标记为 ⚔️ 分歧点，呈现双方观点
4. 社区搜索结果为空时，仅基于 LLM 专家建议输出，但明确标注

输出格式（纯文本，不要 JSON）：

**✅ 高置信度建议（双通道一致）：**
1. [建议] — 社区来源: [网站] / 专家确认

**⚠️ 专家建议（待社区验证）：**
1. [建议] — LLM 专家建议，暂无社区佐证

**⚔️ 分歧点（如有）：**
1. [议题]: 社区观点 vs 专家观点

**信息质量评估：** [高/中/低] — [原因]`;

async function crossValidateSynthesize(
  gap: Gap,
  webResults: SearchResult[],
  llmAdvice: string,
): Promise<string> {
  const webText = webResults.length > 0
    ? webResults.map((r, i) =>
        `[${i + 1}] ${r.title}\n    来源: ${r.source} ${r.publishedDate ? `(${r.publishedDate})` : ''}\n    摘要: ${r.snippet}`
      ).join('\n\n')
    : '（社区搜索无结果）';

  const response = await callQwen([
    { role: 'system', content: CROSS_VALIDATION_PROMPT },
    { role: 'user', content: `问题: ${gap.title}\n详情: ${gap.description}\n类别: ${gap.category}\n\n## Channel A: 社区搜索结果\n${webText}\n\n## Channel B: LLM 专家建议\n${llmAdvice || '（专家咨询失败）'}` },
  ]);

  return response;
}

// ─── Main Export ────────────────────────────────────────────────────────

export async function searchCommunity(
  gaps: Gap[],
  braveApiKey: string,
  cacheTtlDays: number = 7,
): Promise<CommunityInsight[]> {
  const hasWebSearch = !!braveApiKey;
  const strategy: SourceStrategy = hasWebSearch ? 'hybrid' : 'llm_only';

  if (!hasWebSearch) {
    console.log('[prescription] No BRAVE_SEARCH_API_KEY — using llm_only mode');
  } else {
    console.log('[prescription] Hybrid mode: Web Search + LLM Expert');
  }

  // ── Channel A: Web Search (if available) ──

  const resultsByGap = new Map<string, { results: SearchResult[]; queries: string[] }>();
  for (const gap of gaps) {
    resultsByGap.set(gap.id, { results: [], queries: [] });
  }

  if (hasWebSearch) {
    console.log(`[prescription] Building search queries for ${gaps.length} gaps...`);
    const queries = await buildSearchQueries(gaps);
    console.log(`[prescription] Generated ${queries.length} search queries`);

    for (const sq of queries) {
      const source = SOURCES.find(s => sq.targetSources.includes(s.id));
      const fullQuery = source ? `${sq.query} ${source.siteFilter}` : sq.query;

      const entry = resultsByGap.get(sq.gapId)!;
      entry.queries.push(fullQuery);

      // Check cache
      const cached = getCachedResults(fullQuery, cacheTtlDays);
      if (cached) {
        console.log(`[prescription] Cache hit: ${fullQuery.substring(0, 60)}...`);
        entry.results.push(...cached);
        continue;
      }

      // Search Brave
      try {
        console.log(`[prescription] Searching: ${fullQuery.substring(0, 60)}...`);
        const results = await braveSearch(fullQuery, braveApiKey, 5);
        entry.results.push(...results);
        setCachedResults(fullQuery, results);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`[prescription] Search failed for "${fullQuery}":`, err);
      }
    }
  }

  // ── Channel B: LLM Expert (always available) ──

  console.log(`[prescription] Consulting LLM expert for ${gaps.length} gaps...`);
  const llmAdviceByGap = new Map<string, string>();
  for (const gap of gaps) {
    console.log(`[prescription] LLM expert: ${gap.id} — ${gap.title.substring(0, 50)}...`);
    const advice = await consultLlmExpert(gap);
    llmAdviceByGap.set(gap.id, advice);
  }

  // ── Cross-Validation Synthesis ──

  const insights: CommunityInsight[] = [];

  for (const gap of gaps) {
    const webEntry = resultsByGap.get(gap.id)!;
    const llmAdvice = llmAdviceByGap.get(gap.id) || '';

    console.log(`[prescription] Cross-validating ${gap.id}: ${webEntry.results.length} web results + LLM advice`);

    const synthesis = await crossValidateSynthesize(gap, webEntry.results, llmAdvice);

    insights.push({
      gapId: gap.id,
      results: webEntry.results.slice(0, 10),
      llmAdvice,
      synthesis,
      queriesUsed: webEntry.queries,
      sourceStrategy: webEntry.results.length > 0 ? 'hybrid' : (hasWebSearch ? 'llm_only' : 'llm_only'),
    });
  }

  return insights;
}
