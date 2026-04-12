// Tests for ai/context-filter.ts.
//
// We construct a fake analysis markdown that mimics generateSummary()'s
// output from analyzers/index.ts and verify that each role gets the
// expected sections and that unknown roles pass through unchanged.

import {
  filterAnalysisForRole,
  splitAnalysisSections,
} from '../context-filter';

const FIXTURE = `# 项目分析报告: fake-project

## 项目概览
- 项目路径: /tmp/fake
- 总文件数: 100

## 子服务
- api (node, typescript): 50 文件

## 技术栈
- 主要语言: ts(50)

## API 端点
- 总端点数: 25
- 框架: Express

## 数据库
- ORM: Prisma
- 实体数量: 12

## 代码质量指标
- 平均文件大小: 120 行

## 最大文件 (Top 5)
- src/big.ts: 800 行

## 工程化配置
- TypeScript: ✅
- Linter: eslint

## 测试覆盖分析
| 指标 | 值 |
|------|-----|
| 测试文件数 | 30 |

## 项目文档
共 5 篇文档:
- README.md

## 文档完整性
- README: ✅

## 架构模式
- Event-driven

## 服务间依赖
- api → db

## 代码样本
### src/foo.ts
\`\`\`
fake code
\`\`\`
`;

describe('ai/context-filter splitAnalysisSections', () => {
  test('splits on ## headers and preserves preamble', () => {
    const { preamble, sections } = splitAnalysisSections(FIXTURE);
    expect(preamble).toContain('# 项目分析报告');
    expect(sections.map(s => s.heading)).toEqual([
      '项目概览',
      '子服务',
      '技术栈',
      'API 端点',
      '数据库',
      '代码质量指标',
      '最大文件 (Top 5)',
      '工程化配置',
      '测试覆盖分析',
      '项目文档',
      '文档完整性',
      '架构模式',
      '服务间依赖',
      '代码样本',
    ]);
  });

  test('### subheadings do NOT create new top-level sections', () => {
    // The fixture has `### src/foo.ts` inside 代码样本 — it must stay inside.
    const { sections } = splitAnalysisSections(FIXTURE);
    const samples = sections.find(s => s.heading === '代码样本')!;
    expect(samples.block).toContain('### src/foo.ts');
    expect(samples.block).toContain('fake code');
  });
});

describe('ai/context-filter filterAnalysisForRole', () => {
  test('unknown role gets the full analysis unchanged', () => {
    const out = filterAnalysisForRole('nonexistent_role', FIXTURE);
    expect(out).toBe(FIXTURE);
  });

  test('boss gets core + docs only (no API, DB, samples, metrics)', () => {
    const out = filterAnalysisForRole('boss', FIXTURE);
    expect(out).toContain('项目概览');
    expect(out).toContain('子服务');
    expect(out).toContain('技术栈');
    expect(out).toContain('项目文档');
    expect(out).not.toContain('API 端点');
    expect(out).not.toContain('代码样本');
    expect(out).not.toContain('测试覆盖分析');
    // Filtered output is strictly smaller.
    expect(out.length).toBeLessThan(FIXTURE.length);
  });

  test('architect gets everything that exists in the fixture', () => {
    const out = filterAnalysisForRole('architect', FIXTURE);
    expect(out).toContain('API 端点');
    expect(out).toContain('数据库');
    expect(out).toContain('代码质量指标');
    expect(out).toContain('工程化配置');
    expect(out).toContain('测试覆盖分析');
    expect(out).toContain('架构模式');
    expect(out).toContain('代码样本');
  });

  test('trade_expert gets API, DB, specs, architecture — not samples or metrics', () => {
    const out = filterAnalysisForRole('trade_expert', FIXTURE);
    expect(out).toContain('API 端点');
    expect(out).toContain('数据库');
    expect(out).toContain('架构模式');
    expect(out).not.toContain('代码样本');
    expect(out).not.toContain('代码质量指标');
  });

  test('delivery role gets engineering + testing + docs — not API/DB internals', () => {
    const out = filterAnalysisForRole('delivery', FIXTURE);
    expect(out).toContain('工程化配置');
    expect(out).toContain('测试覆盖分析');
    expect(out).toContain('项目文档');
    expect(out).not.toContain('API 端点');
    expect(out).not.toContain('数据库');
  });

  test('filter preserves preamble (project title) for every role', () => {
    for (const role of ['boss', 'architect', 'trade_expert', 'delivery']) {
      const out = filterAnalysisForRole(role, FIXTURE);
      expect(out).toContain('# 项目分析报告');
    }
  });

  test('filter is deterministic: same input produces same output', () => {
    const a = filterAnalysisForRole('architect', FIXTURE);
    const b = filterAnalysisForRole('architect', FIXTURE);
    expect(a).toBe(b);
  });
});
