/**
 * Markdown Report Generator
 * Generates evaluation reports in Markdown format and saves to project folder.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface RoleEvaluation {
  role: string;
  score: number;
  summary: string;
  details?: any;
}

export interface ReportData {
  evaluationId: string;
  projectName: string;
  projectPath: string;
  overallScore: number;
  roleEvaluations: RoleEvaluation[];
  analysisData?: {
    structure?: {
      totalFiles?: number;
      totalLines?: number;
      languages?: Record<string, number>;
    };
    api?: {
      totalEndpoints?: number;
    };
    database?: {
      totalEntities?: number;
      totalColumns?: number;
      orms?: string[];
    };
    quality?: {
      hasTests?: boolean;
      testFileCount?: number;
      hasCI?: boolean;
      hasDocker?: boolean;
      hasLinting?: boolean;
      hasTypeChecking?: boolean;
    };
  };
  depth: string;
  mode: string;
  evaluationType: string;
  timestamp: Date;
}

function formatDate(date: Date): string {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

function getScoreEmoji(score: number): string {
  if (score >= 85) return '🟢';
  if (score >= 70) return '🟡';
  if (score >= 50) return '🟠';
  return '🔴';
}

function getScoreGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 80) return 'B+';
  if (score >= 75) return 'B';
  if (score >= 70) return 'C+';
  if (score >= 65) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function generateMarkdownReport(data: ReportData): string {
  const {
    evaluationId,
    projectName,
    overallScore,
    roleEvaluations,
    analysisData,
    depth,
    mode,
    evaluationType,
    timestamp,
  } = data;

  const lines: string[] = [];

  // Header
  lines.push(`# Code Review Report: ${projectName}`);
  lines.push('');
  lines.push(`**Generated**: ${formatDate(timestamp)}`);
  lines.push(`**Evaluation ID**: \`${evaluationId}\``);
  lines.push(`**Mode**: ${depth} / ${mode} / ${evaluationType}`);
  lines.push('');

  // Overall Score
  lines.push('## Overall Score');
  lines.push('');
  lines.push(`# ${getScoreEmoji(overallScore)} ${overallScore}/100 (${getScoreGrade(overallScore)})`);
  lines.push('');

  // Project Analysis Summary
  if (analysisData) {
    lines.push('## Project Analysis');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    
    if (analysisData.structure) {
      lines.push(`| Total Files | ${analysisData.structure.totalFiles ?? 'N/A'} |`);
      lines.push(`| Total Lines | ${analysisData.structure.totalLines?.toLocaleString() ?? 'N/A'} |`);
      if (analysisData.structure.languages) {
        const topLangs = Object.entries(analysisData.structure.languages)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([ext, count]) => `${ext} (${count})`)
          .join(', ');
        lines.push(`| Top Languages | ${topLangs} |`);
      }
    }
    if (analysisData.api) {
      lines.push(`| API Endpoints | ${analysisData.api.totalEndpoints ?? 0} |`);
    }
    if (analysisData.database) {
      lines.push(`| Database Entities | ${analysisData.database.totalEntities ?? 0} |`);
      lines.push(`| Database Columns | ${analysisData.database.totalColumns ?? 0} |`);
      if (analysisData.database.orms?.length) {
        lines.push(`| ORM | ${analysisData.database.orms.join(', ')} |`);
      }
    }
    if (analysisData.quality) {
      const q = analysisData.quality;
      const checks = [
        q.hasTests ? '✅ Tests' : '❌ Tests',
        q.hasCI ? '✅ CI/CD' : '❌ CI/CD',
        q.hasDocker ? '✅ Docker' : '❌ Docker',
        q.hasLinting ? '✅ Linting' : '❌ Linting',
        q.hasTypeChecking ? '✅ TypeCheck' : '❌ TypeCheck',
      ];
      lines.push(`| Quality Checks | ${checks.join(' ')} |`);
      if (q.testFileCount) {
        lines.push(`| Test Files | ${q.testFileCount} |`);
      }
    }
    lines.push('');
  }

  // Role Evaluations
  lines.push('## Role Evaluations');
  lines.push('');
  
  // Summary table
  const sortedRoles = [...roleEvaluations]
    .filter(r => !r.role.startsWith('_'))
    .sort((a, b) => b.score - a.score);
  
  if (sortedRoles.length > 0) {
    lines.push('| Role | Score | Grade |');
    lines.push('|------|-------|-------|');
    for (const role of sortedRoles) {
      lines.push(`| ${role.role} | ${getScoreEmoji(role.score)} ${role.score} | ${getScoreGrade(role.score)} |`);
    }
    lines.push('');
  }

  // Detailed evaluations
  for (const role of sortedRoles) {
    lines.push(`### ${role.role} (${role.score}/100)`);
    lines.push('');
    if (role.summary) {
      lines.push(role.summary);
      lines.push('');
    }
    
    // Extract key findings from details if available
    if (role.details) {
      try {
        const details = typeof role.details === 'string' ? JSON.parse(role.details) : role.details;
        
        if (details.strengths?.length) {
          lines.push('**Strengths:**');
          for (const s of details.strengths.slice(0, 5)) {
            lines.push(`- ${s}`);
          }
          lines.push('');
        }
        
        if (details.weaknesses?.length) {
          lines.push('**Weaknesses:**');
          for (const w of details.weaknesses.slice(0, 5)) {
            lines.push(`- ${w}`);
          }
          lines.push('');
        }
        
        if (details.recommendations?.length) {
          lines.push('**Recommendations:**');
          for (const r of details.recommendations.slice(0, 5)) {
            lines.push(`- ${r}`);
          }
          lines.push('');
        }
      } catch {
        // Skip if details parsing fails
      }
    }
  }

  // Orchestrator / Debate results if present
  const orchestrator = roleEvaluations.find(r => r.role === '_orchestrator');
  const debate = roleEvaluations.find(r => r.role === '_debate');
  
  if (orchestrator || debate) {
    lines.push('## Synthesis');
    lines.push('');
    
    if (debate) {
      lines.push('### Debate Summary');
      lines.push('');
      lines.push(debate.summary || 'No debate summary available.');
      lines.push('');
    }
    
    if (orchestrator) {
      lines.push('### Orchestrator Verdict');
      lines.push('');
      lines.push(orchestrator.summary || 'No orchestrator summary available.');
      lines.push('');
    }
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push(`*Report generated by [Code Reviewer](https://github.com/your-repo/code-reviewer)*`);

  return lines.join('\n');
}

export async function saveReportToProject(
  projectPath: string,
  reportContent: string,
  evaluationId: string
): Promise<string> {
  // Create reports directory in project
  const reportsDir = path.join(projectPath, '.code-review');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const filename = `review-${timestamp}.md`;
  const filepath = path.join(reportsDir, filename);

  // Write report
  fs.writeFileSync(filepath, reportContent, 'utf-8');

  // Also create/update a symlink to latest report
  const latestPath = path.join(reportsDir, 'LATEST.md');
  try {
    if (fs.existsSync(latestPath)) {
      fs.unlinkSync(latestPath);
    }
    fs.copyFileSync(filepath, latestPath);
  } catch {
    // Symlink may fail on some systems, ignore
  }

  console.log(`[${evaluationId}] Report saved to: ${filepath}`);
  return filepath;
}
