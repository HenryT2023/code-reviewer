// Reference Builder: constructs tech-stack-specific review checklists
// Uses static analysis data + AI model's compressed knowledge of real code review patterns

import { v4 as uuidv4 } from 'uuid';
import { callQwen, QwenMessage } from '../ai/qwen';
import type { QualityAnalysis } from '../analyzers/quality';
import type { ChecklistItem, ReviewReference } from './types';

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory cache for references by tech stack signature
const referenceCache = new Map<string, ReviewReference>();

// ─── Tech Stack Extraction ──────────────────────────────────────────

export function extractTechStack(analysisSummary: string): string[] {
  const stack: string[] = [];
  const lower = analysisSummary.toLowerCase();

  // Frameworks
  const frameworks: Record<string, string[]> = {
    'next.js': ['next', 'nextjs', 'next.js'],
    'express': ['express'],
    'nestjs': ['nestjs', 'nest.js'],
    'fastify': ['fastify'],
    'koa': ['koa'],
    'react': ['react', 'jsx'],
    'vue': ['vue', 'vuejs'],
    'angular': ['angular'],
    'svelte': ['svelte'],
    'django': ['django'],
    'flask': ['flask'],
    'fastapi': ['fastapi'],
    'spring': ['spring boot', 'spring'],
  };

  for (const [name, keywords] of Object.entries(frameworks)) {
    if (keywords.some(k => lower.includes(k))) {
      stack.push(name);
    }
  }

  // Languages
  if (lower.includes('typescript') || lower.includes('.ts')) stack.push('typescript');
  else if (lower.includes('javascript') || lower.includes('.js')) stack.push('javascript');
  if (lower.includes('python') || lower.includes('.py')) stack.push('python');
  if (lower.includes('java') && !lower.includes('javascript')) stack.push('java');
  if (lower.includes('golang') || lower.includes('.go')) stack.push('go');
  if (lower.includes('rust') || lower.includes('.rs')) stack.push('rust');

  // Databases
  if (lower.includes('postgresql') || lower.includes('postgres')) stack.push('postgresql');
  if (lower.includes('mysql')) stack.push('mysql');
  if (lower.includes('mongodb') || lower.includes('mongoose')) stack.push('mongodb');
  if (lower.includes('redis')) stack.push('redis');
  if (lower.includes('sqlite')) stack.push('sqlite');
  if (lower.includes('prisma')) stack.push('prisma');

  // Infrastructure
  if (lower.includes('docker')) stack.push('docker');
  if (lower.includes('kubernetes') || lower.includes('k8s')) stack.push('kubernetes');

  return [...new Set(stack)];
}

// ─── Static Checklist (from analysis data) ──────────────────────────

export function buildStaticChecklist(quality: QualityAnalysis): ChecklistItem[] {
  const items: ChecklistItem[] = [];

  // Testing
  if (!quality.hasTests) {
    items.push({
      category: 'quality',
      item: '项目缺少测试：应评估测试策略和覆盖率需求',
      severity: 'critical',
      source: 'static-analysis: no test files detected',
    });
  }

  // Linting
  if (!quality.hasLinter) {
    items.push({
      category: 'quality',
      item: '缺少代码规范工具（linter）：应检查代码风格一致性',
      severity: 'important',
      source: 'static-analysis: no linter config found',
    });
  }

  // Type Safety
  if (!quality.hasTypeScript && !quality.hasTypeChecking) {
    items.push({
      category: 'quality',
      item: '缺少类型检查：应评估类型安全性风险',
      severity: 'important',
      source: 'static-analysis: no TypeScript or type checking',
    });
  }

  // CI/CD
  if (!quality.hasCI) {
    items.push({
      category: 'ops',
      item: '缺少 CI/CD 配置：应评估部署流程和自动化测试',
      severity: 'important',
      source: 'static-analysis: no CI config detected',
    });
  }

  // Docker
  if (!quality.hasDockerfile) {
    items.push({
      category: 'ops',
      item: '缺少 Docker 配置：应评估容器化和部署可移植性',
      severity: 'nice-to-have',
      source: 'static-analysis: no Dockerfile found',
    });
  }

  // Vulnerabilities
  if (quality.vulnerabilities) {
    const vuln = quality.vulnerabilities;
    if (vuln.critical > 0) {
      items.push({
        category: 'security',
        item: `存在 ${vuln.critical} 个严重安全漏洞：必须评估依赖安全性`,
        severity: 'critical',
        source: `static-analysis: ${vuln.total} total vulnerabilities (${vuln.critical} critical)`,
      });
    } else if (vuln.total > 0) {
      items.push({
        category: 'security',
        item: `存在 ${vuln.total} 个安全漏洞：应评估依赖更新策略`,
        severity: 'important',
        source: `static-analysis: ${vuln.total} vulnerabilities`,
      });
    }
  }

  // Documentation
  if (!quality.readmeExists) {
    items.push({
      category: 'quality',
      item: '缺少 README：应评估项目文档完整性',
      severity: 'important',
      source: 'static-analysis: no README found',
    });
  }

  // Dependencies
  if (quality.dependencyCount > 50) {
    items.push({
      category: 'architecture',
      item: `依赖数量较多 (${quality.dependencyCount})：应评估依赖管理和包大小`,
      severity: 'nice-to-have',
      source: `static-analysis: ${quality.dependencyCount} dependencies`,
    });
  }

  return items;
}

// ─── AI Checklist (compressed search via model knowledge) ───────────

const CHECKLIST_SYSTEM_PROMPT = `你是一位资深的代码评审专家。基于你对业界最佳实践、安全标准和开源项目评审模式的了解，为给定的技术栈生成一份评审清单。

这份清单代表了"一个有经验的人类评审者会关注什么"。

要求：
1. 清单应涵盖 security、architecture、quality、performance、ops 五个维度
2. 每个条目要具体可操作（不是空话）
3. 严重程度分为 critical / important / nice-to-have
4. source 字段说明这条建议的依据（框架官方文档、OWASP、业界惯例等）

严格返回 JSON 数组格式：
[
  {
    "category": "security",
    "item": "检查 SQL 注入防护：确认所有数据库查询使用参数化查询",
    "severity": "critical",
    "source": "OWASP Top 10 - Injection"
  }
]

生成 15-25 条，覆盖所有五个维度。`;

export async function buildAIChecklist(techStack: string[]): Promise<ChecklistItem[]> {
  const messages: QwenMessage[] = [
    { role: 'system', content: CHECKLIST_SYSTEM_PROMPT },
    { role: 'user', content: `技术栈: ${techStack.join(', ')}\n\n请为这个技术栈生成评审清单。` },
  ];

  const raw = await callQwen(messages, 'deepseek-chat', 4000);

  try {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as ChecklistItem[];
      return parsed.filter(
        item => item.category && item.item && item.severity && item.source
      );
    }
  } catch {
    console.error('Failed to parse AI checklist response');
  }

  return [];
}

// ─── Main Entry: get or build reference ─────────────────────────────

function techStackKey(projectPath: string, techStack: string[]): string {
  return `${projectPath}::${techStack.sort().join(',')}`;
}

export async function getOrBuildReference(
  projectPath: string,
  analysisSummary: string,
  quality: QualityAnalysis
): Promise<ReviewReference> {
  const techStack = extractTechStack(analysisSummary);
  const key = techStackKey(projectPath, techStack);

  // Check cache
  const cached = referenceCache.get(key);
  if (cached && new Date(cached.cachedUntil).getTime() > Date.now()) {
    return cached;
  }

  // Build fresh reference
  const staticChecklist = buildStaticChecklist(quality);

  let aiChecklist: ChecklistItem[] = [];
  try {
    aiChecklist = await buildAIChecklist(techStack.length > 0 ? techStack : ['general']);
  } catch (err) {
    console.error('Failed to build AI checklist, proceeding with static only:', err);
  }

  const now = new Date();
  const reference: ReviewReference = {
    id: uuidv4(),
    projectPath,
    techStack,
    generatedAt: now.toISOString(),
    cachedUntil: new Date(now.getTime() + CACHE_DURATION_MS).toISOString(),
    staticChecklist,
    aiChecklist,
  };

  referenceCache.set(key, reference);
  return reference;
}
