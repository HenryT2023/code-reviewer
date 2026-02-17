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
    architect: '🏗️ 架构师视角',
    growth: '📈 增长/分发',
    skeptic: '🔴 质疑者/红队',
    pricing: '💰 定价策略',
    data_metrics: '📊 数据与指标',
    delivery: '🚀 交付经理',
  };

  // Separate regular roles from special (_debate, _orchestrator)
  const regularRoles = roleEvaluations.filter(r => !r.role.startsWith('_'));
  const debateRole = roleEvaluations.find(r => r.role === '_debate');
  const orchestratorRole = roleEvaluations.find(r => r.role === '_orchestrator');

  for (const role of regularRoles) {
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

  // Debate section
  if (debateRole?.details) {
    try {
      const debate = JSON.parse(debateRole.details);
      lines.push('## 🔴 专家对喷摘要');
      lines.push('');
      if (debate.consensus?.length) {
        lines.push('### ✅ 共识');
        lines.push('');
        for (const item of debate.consensus) lines.push(`- ${item}`);
        lines.push('');
      }
      if (debate.disputes?.length) {
        lines.push('### ⚔️ 争议');
        lines.push('');
        for (const d of debate.disputes) {
          lines.push(`**${d.topic}**`);
          if (d.support?.length) lines.push(`  - 支持: ${d.support.join('; ')}`);
          if (d.oppose?.length) lines.push(`  - 反对: ${d.oppose.join('; ')}`);
          if (d.resolution) lines.push(`  - → 裁决: ${d.resolution}`);
          lines.push('');
        }
      }
      if (debate.unresolved?.length) {
        lines.push('### ❓ 未解决');
        lines.push('');
        for (const item of debate.unresolved) lines.push(`- ${item}`);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    } catch { /* ignore */ }
  }

  // Orchestrator Launch-Ready report
  if (orchestratorRole?.details) {
    try {
      const orch = JSON.parse(orchestratorRole.details);
      lines.push('## 🎯 Launch-Ready 行动报告');
      lines.push('');
      lines.push(`**Launch Verdict: ${orch.launch_verdict || 'N/A'}** | 总分: ${orch.overall_score || 'N/A'}`);
      lines.push('');
      if (orch.verdict_conditions?.length) {
        lines.push('前提条件:');
        for (const c of orch.verdict_conditions) lines.push(`- ${c}`);
        lines.push('');
      }

      const sectionTitles: Record<string, string> = {
        A_launch_definition: 'A. Launch 定义与验收标准',
        B_icp_and_market: 'B. ICP 与市场',
        C_core_transaction: 'C. 核心交易与价值主张',
        D_release_scope: 'D. Release Scope',
        E_debate_summary: 'E. 专家对喷摘要',
        F_experiments: 'F. 验证实验',
        G_instrumentation: 'G. 数据埋点与监控',
        H_roadmap: 'H. 迭代路线图',
        I_risks: 'I. 风险登记表',
        J_pricing: 'J. 定价与商业化',
      };

      if (orch.sections) {
        for (const [key, title] of Object.entries(sectionTitles)) {
          const section = orch.sections[key];
          if (section) {
            lines.push(`### ${title}`);
            lines.push('');
            lines.push('```json');
            lines.push(JSON.stringify(section, null, 2));
            lines.push('```');
            lines.push('');
          }
        }
      }

      if (orch.action_items?.length) {
        lines.push('### 📝 Action Items');
        lines.push('');
        lines.push('| ID | 任务 | 优先级 | 负责角色 | 工时 | 验收标准 |');
        lines.push('|----|------|--------|----------|------|----------|');
        for (const a of orch.action_items) {
          lines.push(`| ${a.id || '-'} | ${a.task || '-'} | ${a.priority || '-'} | ${a.owner_role || '-'} | ${a.effort_hours || '-'}h | ${a.acceptance_criteria || '-'} |`);
        }
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    } catch { /* ignore */ }
  }

  lines.push('');
  lines.push('*本报告由 CodeReviewer AI 评测系统自动生成*');

  return lines.join('\n');
}

export default router;
