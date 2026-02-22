// User Interview Role: 8 personas based on Enneagram personality types
// Simulates real user interviews from multiple perspectives

export interface UserPersona {
  id: string;
  enneagramType: number;
  name: string;
  role: string;
  background: string;
  focusAreas: string[];
  catchphrase: string;
  painPoints: string[];
}

export const USER_PERSONAS: UserPersona[] = [
  {
    id: 'perfectionist',
    enneagramType: 1,
    name: '王主管',
    role: '合规经理',
    background: '10年合规经验，对流程规范极度敏感',
    focusAreas: ['数据准确性', '审计追溯', '合规风险', '流程规范'],
    catchphrase: '这个有没有日志？出了问题怎么追溯？',
    painPoints: ['操作无记录', '数据不一致', '缺少审计功能'],
  },
  {
    id: 'helper',
    enneagramType: 2,
    name: '李姐',
    role: '客户经理',
    background: '8年客户服务经验，以客户满意为最高目标',
    focusAreas: ['客户体验', '沟通效率', '关系维护', '服务响应'],
    catchphrase: '客户用起来方便吗？会不会觉得麻烦？',
    painPoints: ['客户投诉多', '响应不及时', '沟通记录分散'],
  },
  {
    id: 'achiever',
    enneagramType: 3,
    name: '张总',
    role: '销售总监',
    background: '15年销售管理经验，KPI导向',
    focusAreas: ['业绩指标', '转化率', 'ROI', '销售效率'],
    catchphrase: '这个功能能帮我多签几单？',
    painPoints: ['转化率低', '线索质量差', '跟进效率低'],
  },
  {
    id: 'investigator',
    enneagramType: 5,
    name: '陈工',
    role: '数据分析师',
    background: '5年数据分析经验，技术背景',
    focusAreas: ['数据洞察', 'API集成', '报表功能', '数据导出'],
    catchphrase: '数据能导出吗？有没有API？',
    painPoints: ['数据孤岛', '报表不灵活', '缺少API'],
  },
  {
    id: 'loyalist',
    enneagramType: 6,
    name: '刘经理',
    role: '风控主管',
    background: '12年风控经验，安全意识强',
    focusAreas: ['数据安全', '系统稳定性', '备份恢复', '权限控制'],
    catchphrase: '数据会不会泄露？系统挂了怎么办？',
    painPoints: ['安全漏洞', '系统不稳定', '数据丢失风险'],
  },
  {
    id: 'enthusiast',
    enneagramType: 7,
    name: '小周',
    role: '创业老板',
    background: '3年创业经验，追求效率和创新',
    focusAreas: ['快速上手', '新功能', '移动端', '效率提升'],
    catchphrase: '能不能手机上用？学习成本高不高？',
    painPoints: ['上手困难', '功能复杂', '不支持移动端'],
  },
  {
    id: 'challenger',
    enneagramType: 8,
    name: '赵总',
    role: '公司老板',
    background: '20年行业经验，决策者',
    focusAreas: ['全局视图', '决策支持', '成本控制', '投资回报'],
    catchphrase: '一年要花多少钱？能省多少人力？',
    painPoints: ['成本不透明', '缺少决策数据', 'ROI不清晰'],
  },
  {
    id: 'peacemaker',
    enneagramType: 9,
    name: '小林',
    role: '运营专员',
    background: '2年运营经验，执行层',
    focusAreas: ['易用性', '学习成本', '团队协作', '日常操作'],
    catchphrase: '我能学会吗？同事们会用吗？',
    painPoints: ['操作复杂', '培训成本高', '协作困难'],
  },
];

// Pain points organized by business stage (based on customer interview template)
export const PAIN_POINT_CATEGORIES = {
  获客: [
    { id: 'lead_efficiency', desc: '找客户效率低', severity: 5 },
    { id: 'lead_quality', desc: '线索质量差', severity: 4 },
    { id: 'lead_cost', desc: '获客成本高', severity: 4 },
  ],
  跟进: [
    { id: 'followup_miss', desc: '跟进遗漏丢单', severity: 5 },
    { id: 'followup_slow', desc: '响应不及时', severity: 4 },
    { id: 'followup_history', desc: '沟通记录分散', severity: 3 },
  ],
  报价: [
    { id: 'quote_slow', desc: '报价慢', severity: 4 },
    { id: 'quote_error', desc: '报价计算出错', severity: 5 },
    { id: 'quote_compare', desc: '历史报价难对比', severity: 3 },
  ],
  物流: [
    { id: 'logistics_track', desc: '物流状态难追踪', severity: 4 },
    { id: 'logistics_complaint', desc: '客户频繁询问', severity: 3 },
  ],
  收款: [
    { id: 'payment_delay', desc: '账期管理混乱', severity: 4 },
    { id: 'payment_bad', desc: '坏账风险', severity: 5 },
    { id: 'payment_remind', desc: '催款靠记忆', severity: 3 },
  ],
};

// Generate persona descriptions for the prompt
export function generatePersonaDescriptions(): string {
  return USER_PERSONAS.map(p => `
### ${p.enneagramType}号-${getEnneagramName(p.enneagramType)}：${p.role} ${p.name}
- 背景：${p.background}
- 关注：${p.focusAreas.join('、')}
- 口头禅："${p.catchphrase}"
`).join('\n');
}

function getEnneagramName(type: number): string {
  const names: Record<number, string> = {
    1: '完美型',
    2: '助人型',
    3: '成就型',
    5: '理智型',
    6: '忠诚型',
    7: '活跃型',
    8: '领袖型',
    9: '和平型',
  };
  return names[type] || '未知型';
}

// Generate pain points description for the prompt
export function generatePainPointsDescription(): string {
  return Object.entries(PAIN_POINT_CATEGORIES)
    .map(([category, points]) => {
      const pointsStr = points.map(p => p.desc).join('、');
      return `- **${category}**：${pointsStr}`;
    })
    .join('\n');
}
