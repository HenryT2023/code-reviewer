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
    
    // Extract summary - prefer details.summary if role.summary looks like JSON
    let summaryText = role.summary || '';
    if (role.details) {
      try {
        const details = typeof role.details === 'string' ? JSON.parse(role.details) : role.details;
        if (details.summary && typeof details.summary === 'string') {
          summaryText = details.summary;
        }
      } catch { /* use original */ }
    }
    if (summaryText && !summaryText.startsWith('{') && !summaryText.startsWith('```')) {
      lines.push(`> ${summaryText}`);
      lines.push('');
    }
    
    // Extract key findings from details if available
    if (role.details) {
      try {
        const details = typeof role.details === 'string' ? JSON.parse(role.details) : role.details;
        
        // Dimensions table (NEW)
        if (details.dimensions && Object.keys(details.dimensions).length > 0) {
          lines.push('#### Dimension Scores');
          lines.push('');
          lines.push('| Dimension | Score | Assessment |');
          lines.push('|-----------|-------|------------|');
          for (const [dim, data] of Object.entries(details.dimensions)) {
            const d = data as { score?: number; comment?: string };
            const dimName = dim.replace(/([A-Z])/g, ' $1').trim();
            lines.push(`| ${dimName} | ${getScoreEmoji(d.score ?? 0)} ${d.score ?? 'N/A'} | ${(d.comment ?? '').substring(0, 100)}${(d.comment?.length ?? 0) > 100 ? '...' : ''} |`);
          }
          lines.push('');
        }
        
        // Strengths (full list)
        if (details.strengths?.length) {
          lines.push('#### Strengths');
          lines.push('');
          for (const s of details.strengths) {
            lines.push(`- ${s}`);
          }
          lines.push('');
        }
        
        // Weaknesses (full list)
        if (details.weaknesses?.length) {
          lines.push('#### Weaknesses');
          lines.push('');
          for (const w of details.weaknesses) {
            lines.push(`- ${w}`);
          }
          lines.push('');
        }
        
        // Anti-Patterns (NEW)
        if (details.antiPatterns?.length) {
          lines.push('#### Anti-Patterns Detected');
          lines.push('');
          for (const ap of details.antiPatterns) {
            lines.push(`- ⚠️ ${ap}`);
          }
          lines.push('');
        }
        
        // Tech Debt (NEW)
        if (details.techDebt?.length) {
          lines.push('#### Technical Debt');
          lines.push('');
          for (const td of details.techDebt) {
            lines.push(`- 🔧 ${td}`);
          }
          lines.push('');
        }
        
        // Recommendations (full list)
        if (details.recommendations?.length) {
          lines.push('#### Recommendations');
          lines.push('');
          for (const r of details.recommendations) {
            lines.push(`- ${r}`);
          }
          lines.push('');
        }
        
        // MREP Claims summary (NEW)
        if (details.claims?.length) {
          lines.push('#### Verifiable Claims (MREP)');
          lines.push('');
          lines.push('| ID | Type | Severity | Statement |');
          lines.push('|----|------|----------|-----------|');
          for (const claim of details.claims.slice(0, 10)) {
            const severityIcon = claim.severity === 'critical' ? '🔴' : claim.severity === 'major' ? '🟠' : '🟡';
            lines.push(`| ${claim.id} | ${claim.type} | ${severityIcon} ${claim.severity} | ${claim.statement.substring(0, 80)}${claim.statement.length > 80 ? '...' : ''} |`);
          }
          if (details.claims.length > 10) {
            lines.push(`| ... | | | *${details.claims.length - 10} more claims* |`);
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
      lines.push('### Debate Round');
      lines.push('');
      lines.push(debate.summary || 'No debate summary available.');
      lines.push('');
      
      // Parse debate details for consensus and disputes
      if (debate.details) {
        try {
          const debateDetails = typeof debate.details === 'string' ? JSON.parse(debate.details) : debate.details;
          
          if (debateDetails.consensus?.length) {
            lines.push('#### Consensus Points');
            lines.push('');
            for (const c of debateDetails.consensus) {
              lines.push(`- ✅ ${c}`);
            }
            lines.push('');
          }
          
          if (debateDetails.disputes?.length) {
            lines.push('#### Disputed Points');
            lines.push('');
            for (const d of debateDetails.disputes) {
              if (typeof d === 'object') {
                lines.push(`- ⚔️ **${d.topic || 'Topic'}**: ${d.positions?.join(' vs ') || d.description || JSON.stringify(d)}`);
              } else {
                lines.push(`- ⚔️ ${d}`);
              }
            }
            lines.push('');
          }
        } catch {
          // Skip if parsing fails
        }
      }
    }
    
    if (orchestrator) {
      lines.push('### Orchestrator Verdict');
      lines.push('');
      lines.push(orchestrator.summary || 'No orchestrator summary available.');
      lines.push('');
      
      // Parse orchestrator structured output
      if (orchestrator.details) {
        try {
          const orchDetails = typeof orchestrator.details === 'string' ? JSON.parse(orchestrator.details) : orchestrator.details;
          
          if (orchDetails.launch_readiness) {
            const lr = orchDetails.launch_readiness;
            lines.push('#### Launch Readiness');
            lines.push('');
            lines.push(`- **Ready**: ${lr.ready ? '✅ Yes' : '❌ No'}`);
            if (lr.blockers?.length) {
              lines.push(`- **Blockers**: ${lr.blockers.join(', ')}`);
            }
            if (lr.recommendations?.length) {
              lines.push(`- **Pre-launch Actions**: ${lr.recommendations.join(', ')}`);
            }
            lines.push('');
          }
          
          if (orchDetails.priority_actions?.length) {
            lines.push('#### Priority Actions');
            lines.push('');
            for (const action of orchDetails.priority_actions) {
              if (typeof action === 'object') {
                lines.push(`1. **${action.action || action.title || 'Action'}** (${action.priority || 'medium'}) - ${action.rationale || action.description || ''}`);
              } else {
                lines.push(`1. ${action}`);
              }
            }
            lines.push('');
          }
        } catch {
          // Skip if parsing fails
        }
      }
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
