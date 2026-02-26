/**
 * Interview Researcher
 * Uses Brave Search to find real WMS/cross-border logistics interview data,
 * pain points, and case studies from industry sources.
 */

import { braveSearch } from '../prescription/community-searcher';
import type { SearchResult } from '../prescription/types';

export interface ResearchTopic {
  id: string;
  personaRole: string;
  queries: { en: string; cn: string }[];
}

export interface ResearchResults {
  topicId: string;
  personaRole: string;
  results: SearchResult[];
}

// Pre-defined search queries per persona focus area
const RESEARCH_TOPICS: ResearchTopic[] = [
  {
    id: 'compliance',
    personaRole: '合规经理',
    queries: [
      { en: 'WMS compliance audit trail warehouse management best practices', cn: '仓库管理系统 合规 审计追溯 实战经验' },
      { en: 'cross-border trade compliance warehouse inspection pain points', cn: '跨境贸易 仓储合规 海关查验 痛点' },
    ],
  },
  {
    id: 'customer',
    personaRole: '客户经理',
    queries: [
      { en: 'warehouse management customer service pain points logistics', cn: '仓储客户服务 痛点 物流客户体验' },
      { en: 'B2B logistics customer satisfaction warehouse SaaS', cn: '仓库管理 客户满意度 B2B 物流 SaaS' },
    ],
  },
  {
    id: 'sales',
    personaRole: '销售总监',
    queries: [
      { en: 'WMS ROI warehouse management system sales conversion', cn: 'WMS 投资回报 仓库管理系统 销售转化' },
      { en: 'warehouse SaaS pricing enterprise sales logistics', cn: '仓储SaaS 定价策略 企业销售 物流行业' },
    ],
  },
  {
    id: 'analyst',
    personaRole: '数据分析师',
    queries: [
      { en: 'warehouse data analytics KPI inventory management reporting', cn: '仓库数据分析 KPI 库存管理 报表需求' },
      { en: 'WMS API integration data export logistics analytics', cn: 'WMS API 数据导出 物流数据分析 集成' },
    ],
  },
  {
    id: 'risk',
    personaRole: '风控主管',
    queries: [
      { en: 'warehouse management security data protection inventory system', cn: '仓库管理 数据安全 风控 系统稳定性' },
      { en: 'WMS disaster recovery backup logistics system reliability', cn: 'WMS 容灾备份 系统可靠性 仓储安全' },
    ],
  },
  {
    id: 'startup',
    personaRole: '创业老板',
    queries: [
      { en: 'warehouse management mobile app small business logistics efficiency', cn: '仓库管理 移动端 小企业 物流效率 上手' },
      { en: 'cross-border ecommerce warehouse startup pain points', cn: '跨境电商 仓储创业 痛点 效率工具' },
    ],
  },
  {
    id: 'boss',
    personaRole: '公司老板',
    queries: [
      { en: 'warehouse management system cost savings ROI labor reduction', cn: '仓库管理系统 成本节约 ROI 降低人力' },
      { en: 'WMS digital transformation decision making executive', cn: 'WMS 数字化转型 决策支持 老板视角 1039市场采购' },
    ],
  },
  {
    id: 'operator',
    personaRole: '运营专员',
    queries: [
      { en: 'warehouse operator training WMS usability onboarding', cn: '仓库操作员 培训 WMS 易用性 上手难度' },
      { en: 'warehouse daily operations pain points team collaboration', cn: '仓库日常运营 痛点 团队协作 操作流程' },
    ],
  },
];

export async function researchAllTopics(braveApiKey: string): Promise<ResearchResults[]> {
  const allResults: ResearchResults[] = [];

  for (const topic of RESEARCH_TOPICS) {
    const topicResults: SearchResult[] = [];

    for (const q of topic.queries) {
      // Search English sources
      try {
        console.log(`[interview-agent] Searching EN: ${q.en.substring(0, 50)}...`);
        const enResults = await braveSearch(q.en, braveApiKey, 5);
        topicResults.push(...enResults);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`[interview-agent] EN search failed:`, err);
      }

      // Search Chinese sources
      try {
        console.log(`[interview-agent] Searching CN: ${q.cn.substring(0, 50)}...`);
        const cnResults = await braveSearch(q.cn, braveApiKey, 5);
        topicResults.push(...cnResults);
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.error(`[interview-agent] CN search failed:`, err);
      }
    }

    allResults.push({
      topicId: topic.id,
      personaRole: topic.personaRole,
      results: topicResults.slice(0, 15),
    });

    console.log(`[interview-agent] ${topic.personaRole}: collected ${topicResults.length} results`);
  }

  return allResults;
}

export function getResearchTopics(): ResearchTopic[] {
  return RESEARCH_TOPICS;
}
