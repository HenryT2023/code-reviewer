import { Router } from 'express';
import { getEvaluation, getRoleEvaluations } from '../db/sqlite';

const router = Router();

router.get('/markdown/:id', (req, res) => {
  const { id } = req.params;
  const evaluation = getEvaluation(id);
  
  if (!evaluation) {
    return res.status(404).json({ error: 'Evaluation not found' });
  }

  const roleEvaluations = getRoleEvaluations(id);
  const markdown = generateMarkdownReport(evaluation, roleEvaluations);
  
  res.setHeader('Content-Type', 'text/markdown');
  res.setHeader('Content-Disposition', `attachment; filename="${evaluation.projectName}-report.md"`);
  res.send(markdown);
});

router.get('/json/:id', (req, res) => {
  const { id } = req.params;
  const evaluation = getEvaluation(id);
  
  if (!evaluation) {
    return res.status(404).json({ error: 'Evaluation not found' });
  }

  const roleEvaluations = getRoleEvaluations(id);
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${evaluation.projectName}-report.json"`);
  res.json({
    evaluation,
    roleEvaluations: roleEvaluations.map(r => ({
      ...r,
      details: r.details ? JSON.parse(r.details) : null,
    })),
  });
});

function generateMarkdownReport(
  evaluation: ReturnType<typeof getEvaluation>,
  roleEvaluations: ReturnType<typeof getRoleEvaluations>
): string {
  if (!evaluation) return '';

  const lines: string[] = [
    `# 项目评测报告: ${evaluation.projectName}`,
    '',
    `> 生成时间: ${new Date().toLocaleString('zh-CN')}`,
    '',
    '---',
    '',
    '## 📊 评测概览',
    '',
    `| 项目 | 值 |`,
    `|------|-----|`,
    `| 项目路径 | \`${evaluation.projectPath}\` |`,
    `| 业务背景 | ${evaluation.context || '未提供'} |`,
    `| 总评分 | **${evaluation.overallScore ?? '-'} 分** |`,
    `| 评测时间 | ${new Date(evaluation.createdAt).toLocaleString('zh-CN')} |`,
    '',
    '---',
    '',
    '## 🎭 角色评测详情',
    '',
  ];

  const roleNames: Record<string, string> = {
    boss: '👔 老板视角',
    merchant: '🏪 商户视角',
    operator: '⚙️ 运营视角',
  };

  for (const role of roleEvaluations) {
    const roleName = roleNames[role.role] || role.role;
    lines.push(`### ${roleName}`);
    lines.push('');
    lines.push(`**评分: ${role.score ?? '-'} 分**`);
    lines.push('');
    lines.push(`**摘要:** ${role.summary || '暂无摘要'}`);
    lines.push('');

    if (role.details) {
      try {
        const details = JSON.parse(role.details);
        
        if (details.dimensions) {
          lines.push('#### 维度评分');
          lines.push('');
          lines.push('| 维度 | 评分 | 说明 |');
          lines.push('|------|------|------|');
          for (const [key, dim] of Object.entries(details.dimensions)) {
            const d = dim as { score?: number; comment?: string };
            lines.push(`| ${key} | ${d.score ?? '-'}% | ${d.comment || '-'} |`);
          }
          lines.push('');
        }

        if (details.opportunities?.length) {
          lines.push('#### ✅ 机会点');
          lines.push('');
          for (const item of details.opportunities) {
            lines.push(`- ${item}`);
          }
          lines.push('');
        }

        if (details.risks?.length) {
          lines.push('#### ⚠️ 风险点');
          lines.push('');
          for (const item of details.risks) {
            lines.push(`- ${item}`);
          }
          lines.push('');
        }

        if (details.recommendations?.length) {
          lines.push('#### 💡 改进建议');
          lines.push('');
          for (const item of details.recommendations) {
            lines.push(`- ${item}`);
          }
          lines.push('');
        }

        if (details.painPoints?.length) {
          lines.push('#### 😣 痛点');
          lines.push('');
          for (const item of details.painPoints) {
            lines.push(`- ${item}`);
          }
          lines.push('');
        }

        if (details.suggestions?.length) {
          lines.push('#### 📝 建议');
          lines.push('');
          for (const item of details.suggestions) {
            lines.push(`- ${item}`);
          }
          lines.push('');
        }
      } catch {
        // ignore parse error
      }
    }

    lines.push('---');
    lines.push('');
  }

  lines.push('');
  lines.push('*本报告由 CodeReviewer AI 评测系统自动生成*');

  return lines.join('\n');
}

export default router;
