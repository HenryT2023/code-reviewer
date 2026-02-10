import * as fs from 'fs';
import * as path from 'path';
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
  deepContext?: DeepContext;
}

export interface DeepContext {
  codeSamples: CodeSample[];
  architecturePatterns: string[];
  specSummaries: string[];
  crossServiceDeps: string[];
}

export interface CodeSample {
  file: string;
  purpose: string;
  content: string;
}

export async function analyzeProject(projectPath: string, depth: 'quick' | 'deep' = 'quick'): Promise<FullAnalysis> {
  const [structure, api, database, metrics] = await Promise.all([
    analyzeStructure(projectPath),
    analyzeApi(projectPath),
    analyzeDatabase(projectPath),
    analyzeMetrics(projectPath),
  ]);

  const quality = analyzeCodeQuality(projectPath);
  
  let deepContext: DeepContext | undefined;
  if (depth === 'deep') {
    deepContext = await gatherDeepContext(projectPath, structure, api);
  }

  const summary = generateSummary(structure, api, database, metrics, quality, deepContext);

  return {
    structure,
    api,
    database,
    metrics,
    quality,
    summary,
    deepContext,
  };
}

async function gatherDeepContext(
  projectPath: string,
  structure: ProjectStructure,
  api: ApiAnalysis
): Promise<DeepContext> {
  const codeSamples: CodeSample[] = [];
  const architecturePatterns: string[] = [];
  const specSummaries: string[] = [];
  const crossServiceDeps: string[] = [];

  // 1. Read spec files
  const specsDir = path.join(projectPath, 'specs');
  if (fs.existsSync(specsDir)) {
    try {
      const specFiles = fs.readdirSync(specsDir).filter(f => f.endsWith('.md')).sort();
      for (const sf of specFiles.slice(0, 5)) {
        try {
          const content = fs.readFileSync(path.join(specsDir, sf), 'utf-8');
          // Take first 800 chars as summary
          specSummaries.push(`[${sf}] ${content.substring(0, 800)}`);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // 2. Extract key code samples from sub-services
  for (const svc of structure.subServices) {
    // Read entry point
    for (const ep of svc.entryPoints.slice(0, 1)) {
      try {
        const content = fs.readFileSync(path.join(svc.path, ep), 'utf-8');
        codeSamples.push({
          file: `${svc.name}/${ep}`,
          purpose: `${svc.name} entry point`,
          content: content.substring(0, 1500),
        });
      } catch { /* skip */ }
    }

    // Read a sample API route file
    const apiDir = path.join(svc.path, 'app', 'api');
    const srcApiDir = path.join(svc.path, 'src', 'api');
    const routesDir = path.join(svc.path, 'src', 'routes');
    for (const dir of [apiDir, srcApiDir, routesDir]) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir).filter(f => 
          (f.endsWith('.py') || f.endsWith('.ts')) && !f.startsWith('__')
        );
        if (files.length > 0) {
          const sampleFile = files[0];
          const content = fs.readFileSync(path.join(dir, sampleFile), 'utf-8');
          codeSamples.push({
            file: `${svc.name}/${path.basename(dir)}/${sampleFile}`,
            purpose: `${svc.name} API route sample`,
            content: content.substring(0, 1500),
          });
        }
      } catch { /* skip */ }
      break;
    }

    // Read a sample model file
    const modelsFile = path.join(svc.path, 'app', 'models.py');
    const modelsDir = path.join(svc.path, 'app', 'models');
    if (fs.existsSync(modelsFile)) {
      try {
        const content = fs.readFileSync(modelsFile, 'utf-8');
        codeSamples.push({
          file: `${svc.name}/app/models.py`,
          purpose: `${svc.name} data models`,
          content: content.substring(0, 2000),
        });
      } catch { /* skip */ }
    } else if (fs.existsSync(modelsDir)) {
      try {
        const modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.py') && !f.startsWith('__'));
        if (modelFiles.length > 0) {
          const content = fs.readFileSync(path.join(modelsDir, modelFiles[0]), 'utf-8');
          codeSamples.push({
            file: `${svc.name}/app/models/${modelFiles[0]}`,
            purpose: `${svc.name} data model sample`,
            content: content.substring(0, 1500),
          });
        }
      } catch { /* skip */ }
    }
  }

  // 3. Detect architecture patterns
  const readmeContent = readFileSafe(path.join(projectPath, 'README.md'));
  const dockerCompose = readFileSafe(path.join(projectPath, 'docker-compose.yml'));
  
  if (structure.subServices.length > 1) architecturePatterns.push('Monorepo / Multi-service');
  if (dockerCompose.includes('redis') || dockerCompose.includes('Redis')) architecturePatterns.push('Redis caching');
  if (dockerCompose.includes('postgres') || dockerCompose.includes('PostgreSQL')) architecturePatterns.push('PostgreSQL');
  if (dockerCompose.includes('rabbitmq') || dockerCompose.includes('kafka')) architecturePatterns.push('Message queue');
  
  if (fs.existsSync(path.join(projectPath, 'contracts'))) architecturePatterns.push('Contract-first design');
  if (readmeContent.includes('event') || readmeContent.includes('Event')) architecturePatterns.push('Event-driven');
  if (readmeContent.includes('digital twin') || readmeContent.toLowerCase().includes('数字孪生')) architecturePatterns.push('Digital Twin');
  if (readmeContent.includes('CQRS') || readmeContent.includes('cqrs')) architecturePatterns.push('CQRS');
  if (readmeContent.includes('agent') || readmeContent.includes('Agent')) architecturePatterns.push('AI Agent');

  // Check for event schemas in contracts
  const contractsDir = path.join(projectPath, 'contracts');
  if (fs.existsSync(contractsDir)) {
    try {
      const contractFiles = fs.readdirSync(contractsDir, { recursive: true }) as string[];
      const schemaCount = contractFiles.filter(f => 
        typeof f === 'string' && (f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.py'))
      ).length;
      if (schemaCount > 5) architecturePatterns.push(`${schemaCount} contract schemas`);
    } catch { /* skip */ }
  }

  // 4. Cross-service dependencies
  for (const svc of structure.subServices) {
    for (const otherSvc of structure.subServices) {
      if (svc.name === otherSvc.name) continue;
      // Check if one service references another
      try {
        const files = fs.readdirSync(svc.path, { recursive: true }) as string[];
        for (const f of files.slice(0, 50)) {
          if (typeof f !== 'string' || !f.endsWith('.py') && !f.endsWith('.ts')) continue;
          try {
            const content = fs.readFileSync(path.join(svc.path, f), 'utf-8');
            if (content.includes(otherSvc.name) && !f.includes('node_modules')) {
              crossServiceDeps.push(`${svc.name} → ${otherSvc.name}`);
              break;
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }

  return { codeSamples, architecturePatterns, specSummaries, crossServiceDeps: [...new Set(crossServiceDeps)] };
}

function readFileSafe(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

function generateSummary(
  structure: ProjectStructure,
  api: ApiAnalysis,
  database: DatabaseAnalysis,
  metrics: CodeMetrics,
  quality: QualityAnalysis,
  deepContext?: DeepContext
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
    `- Monorepo: ${structure.isMonorepo ? '是' : '否'}`,
    '',
  ];

  // Sub-services
  if (structure.subServices.length > 0) {
    lines.push('## 子服务');
    for (const svc of structure.subServices) {
      lines.push(`- ${svc.name} (${svc.type}, ${svc.language}): ${svc.fileCount} 文件, 测试: ${svc.hasTests ? '✅' : '❌'}`);
    }
    lines.push('');
  }

  // Language breakdown
  if (metrics.languageBreakdown) {
    lines.push('## 语言分布');
    const sorted = Object.entries(metrics.languageBreakdown).sort((a, b) => b[1].lines - a[1].lines);
    for (const [ext, info] of sorted.slice(0, 8)) {
      lines.push(`- ${ext}: ${info.files} 文件, ${info.lines.toLocaleString()} 行`);
    }
    lines.push('');
  }

  lines.push(
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
    `- 框架: ${api.frameworks.join(', ') || '未检测到'}`,
    `- 方法分布: ${Object.entries(api.methodCounts).map(([method, count]) => `${method}(${count})`).join(', ')}`,
    '',
    '## 数据库',
    `- ORM: ${database.orms.join(', ') || '未检测到'}`,
    `- 实体数量: ${database.totalEntities}`,
    `- 总字段数: ${database.totalColumns}`,
    `- 关联关系: ${database.relations}`,
    `- 迁移: ${database.hasMigrations ? `✅ (${database.migrationCount} 个)` : '❌'}`,
    ...database.entities.slice(0, 10).map(e => `  - ${e.name} (${e.orm}): ${e.columns.length} 字段, ${e.relations.length} 关联`),
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
    `- 类型检查: ${quality.hasTypeChecking ? '✅' : '❌'}`,
    `- Linter: ${quality.linters.join(', ') || '❌ 未配置'}`,
    `- Formatter: ${quality.formatters.join(', ') || '❌ 未配置'}`,
    `- CI/CD: ${quality.ciPlatform || '❌ 未配置'}`,
    `- 测试框架: ${quality.testFrameworks.join(', ') || '❌ 未配置'}`,
    `- 测试文件数: ${quality.testFiles.length}`,
    `- Docker: ${quality.hasDockerfile ? '✅' : '❌'} | Compose: ${quality.hasDockerCompose ? '✅' : '❌'}`,
    `- Specs: ${quality.hasSpecs ? `✅ (${quality.specFiles.length} 个)` : '❌'}`,
    `- Contracts: ${quality.hasContracts ? '✅' : '❌'}`,
    '',
  );

  // Python quality
  if (quality.pythonQuality) {
    const pq = quality.pythonQuality;
    lines.push(
      '## Python 工程化',
      `- pyproject.toml: ${pq.hasPyproject ? '✅' : '❌'}`,
      `- Ruff: ${pq.hasRuff ? '✅' : '❌'}`,
      `- Black: ${pq.hasBlack ? '✅' : '❌'}`,
      `- MyPy: ${pq.hasMypy ? '✅' : '❌'}`,
      `- pytest: ${pq.hasPytest ? '✅' : '❌'}`,
      `- Alembic: ${pq.hasAlembic ? '✅' : '❌'}`,
      `- 依赖数: ${pq.dependencies.length}`,
      '',
    );
  }

  lines.push(
    '## 文档完整性',
    `- README: ${quality.readmeExists ? '✅' : '❌'}`,
    `- CHANGELOG: ${quality.changelogExists ? '✅' : '❌'}`,
    `- LICENSE: ${quality.licenseExists ? '✅' : '❌'}`,
    '',
  );

  // Deep context
  if (deepContext) {
    if (deepContext.architecturePatterns.length > 0) {
      lines.push('## 架构模式', ...deepContext.architecturePatterns.map(p => `- ${p}`), '');
    }
    if (deepContext.crossServiceDeps.length > 0) {
      lines.push('## 服务间依赖', ...deepContext.crossServiceDeps.map(d => `- ${d}`), '');
    }
    if (deepContext.specSummaries.length > 0) {
      lines.push('## Spec 摘要');
      for (const s of deepContext.specSummaries) {
        lines.push(s.substring(0, 400), '');
      }
    }
    if (deepContext.codeSamples.length > 0) {
      lines.push('## 代码样本');
      for (const sample of deepContext.codeSamples.slice(0, 6)) {
        lines.push(`### ${sample.file} (${sample.purpose})`, '```', sample.content.substring(0, 1000), '```', '');
      }
    }
  }

  return lines.filter(l => l !== undefined).join('\n');
}

export { analyzeStructure, analyzeApi, analyzeDatabase, analyzeMetrics };
export type { ProjectStructure, ApiAnalysis, DatabaseAnalysis, CodeMetrics };
