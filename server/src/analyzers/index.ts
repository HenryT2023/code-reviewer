import { analyzeStructure, ProjectStructure } from './structure';
import { analyzeApi, ApiAnalysis } from './api';
import { analyzeDatabase, DatabaseAnalysis } from './database';
import { analyzeMetrics, CodeMetrics } from './metrics';
import { analyzeCodeQuality, QualityAnalysis } from './quality';

export interface FullAnalysis {
  structure: ProjectStructure;
  api: ApiAnalysis;
  database: DatabaseAnalysis;
  metrics: CodeMetrics;
  quality: QualityAnalysis;
  summary: string;
}

export async function analyzeProject(projectPath: string): Promise<FullAnalysis> {
  const [structure, api, database, metrics] = await Promise.all([
    analyzeStructure(projectPath),
    analyzeApi(projectPath),
    analyzeDatabase(projectPath),
    analyzeMetrics(projectPath),
  ]);

  const quality = analyzeCodeQuality(projectPath);
  const summary = generateSummary(structure, api, database, metrics, quality);

  return {
    structure,
    api,
    database,
    metrics,
    quality,
    summary,
  };
}

function generateSummary(
  structure: ProjectStructure,
  api: ApiAnalysis,
  database: DatabaseAnalysis,
  metrics: CodeMetrics,
  quality: QualityAnalysis
): string {
  const lines: string[] = [
    `# 项目分析报告: ${structure.name}`,
    '',
    '## 项目概览',
    `- 项目路径: ${structure.path}`,
    `- 目录数量: ${structure.directories.length}`,
    `- 总文件数: ${metrics.totalFiles}`,
    `- 总代码行数: ${metrics.totalLines.toLocaleString()}`,
    `- 有效代码行: ${metrics.codeLines.toLocaleString()}`,
    '',
    '## 技术栈',
    `- 主要语言: ${Object.entries(structure.languages)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => `${ext}(${count})`)
      .join(', ')}`,
    '',
    '## 后端模块',
    `- 模块数量: ${structure.modules.length}`,
    ...structure.modules.map(m => `  - ${m.name} (${m.type}): ${m.files.length} 文件`),
    '',
    '## API 端点',
    `- 总端点数: ${api.totalEndpoints}`,
    `- 方法分布: ${Object.entries(api.methodCounts)
      .map(([method, count]) => `${method}(${count})`)
      .join(', ')}`,
    '',
    '## 数据库实体',
    `- 实体数量: ${database.totalEntities}`,
    `- 总字段数: ${database.totalColumns}`,
    `- 关联关系: ${database.relations}`,
    ...database.entities.slice(0, 10).map(e => `  - ${e.name}: ${e.columns.length} 字段, ${e.relations.length} 关联`),
    '',
    '## 代码质量指标',
    `- 平均文件大小: ${metrics.avgFileSize} 行`,
    `- 平均函数数/文件: ${metrics.complexity.avgFunctionsPerFile}`,
    `- 平均行数/函数: ${metrics.complexity.avgLinesPerFunction}`,
    `- 高复杂度文件: ${metrics.complexity.filesWithHighComplexity}`,
    '',
    '## 最大文件 (Top 5)',
    ...metrics.largestFiles.slice(0, 5).map(f => `  - ${f.file}: ${f.lines} 行`),
    '',
    '## 工程化配置',
    `- TypeScript: ${quality.hasTypeScript ? '✅' : '❌'}`,
    `- Linter: ${quality.linterType || '❌ 未配置'}`,
    `- Prettier: ${quality.hasPrettier ? '✅' : '❌'}`,
    `- CI/CD: ${quality.ciPlatform || '❌ 未配置'}`,
    `- 测试框架: ${quality.testFramework || '❌ 未配置'}`,
    `- 测试文件数: ${quality.testFiles.length}`,
    '',
    '## 文档完整性',
    `- README: ${quality.readmeExists ? '✅' : '❌'}`,
    `- CHANGELOG: ${quality.changelogExists ? '✅' : '❌'}`,
    `- LICENSE: ${quality.licenseExists ? '✅' : '❌'}`,
    '',
    '## 依赖信息',
    `- 生产依赖: ${quality.dependencyCount}`,
    `- 开发依赖: ${quality.devDependencyCount}`,
    quality.vulnerabilities ? `- 安全漏洞: ${quality.vulnerabilities.total} (严重:${quality.vulnerabilities.critical}, 高:${quality.vulnerabilities.high})` : '',
  ];

  return lines.filter(Boolean).join('\n');
}

export { analyzeStructure, analyzeApi, analyzeDatabase, analyzeMetrics };
export type { ProjectStructure, ApiAnalysis, DatabaseAnalysis, CodeMetrics };
