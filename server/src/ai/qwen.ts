import https from 'https';

const DASHSCOPE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';

function getApiKey(): string {
  return process.env.DASHSCOPE_API_KEY || '';
}

export interface QwenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface QwenResponse {
  output: {
    text: string;
    finish_reason: string;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export async function callQwen(
  messages: QwenMessage[],
  model: string = 'qwen-max',
  maxTokens: number = 4000
): Promise<string> {
  const requestBody = JSON.stringify({
    model,
    input: {
      messages,
    },
    parameters: {
      result_format: 'text',
      temperature: 0.7,
      max_tokens: maxTokens,
    },
  });

  return new Promise((resolve, reject) => {
    const url = new URL(DASHSCOPE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Length': Buffer.byteLength(requestBody),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.output?.text) {
            resolve(response.output.text);
          } else if (response.message) {
            reject(new Error(`Qwen API error: ${response.message}`));
          } else {
            reject(new Error(`Unexpected response: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Request failed: ${e.message}`));
    });

    req.write(requestBody);
    req.end();
  });
}

const DEEP_INSTRUCTION = `
注意：这是一次深度评测。你收到的分析报告包含了实际代码样本、架构模式、Spec设计文档、跨服务依赖等详细信息。
请基于这些具体证据给出评分，而不是笼统推测。对于你在代码样本中看到的具体优点或问题，请引用说明。
评分标准：
- 90-100: 行业标杆级别，几乎无可挑剔
- 80-89: 优秀，少量可改进项
- 70-79: 良好，有明确的改进空间
- 60-69: 及格，存在较多需要改进的地方
- 50-59: 不足，有明显的缺陷
- 40-49: 较差，存在严重问题
- 0-39: 严重不足，需要大幅重构
`;

export async function evaluateWithRole(
  role: 'boss' | 'merchant' | 'operator' | 'architect',
  projectAnalysis: string,
  context: string,
  depth: 'quick' | 'deep' = 'quick',
  customPrompt?: string
): Promise<string> {
  const isDeep = depth === 'deep';
  const maxTokens = isDeep ? 8000 : 4000;

  const defaultSystemPrompts: Record<string, string> = {
    boss: `你是一位拥有15年互联网创业和投资经验的产品负责人/CEO，精通商业模式分析、技术投资决策和产品市场匹配。
${isDeep ? DEEP_INSTRUCTION : ''}
请根据项目的实际业务领域和技术分析报告，从以下角度评估，给出1-100的评分和详细分析：
1. 投资回报率 (ROI) 潜力
2. 市场定位与竞争优势
3. 技术风险与业务风险
4. 扩展性与长期价值
5. 团队执行力评估（基于代码质量）

请用JSON格式返回，包含：
{
  "score": 总分(1-100),
  "summary": "一句话总结",
  "dimensions": {
    "roi": { "score": 百分制分数, "comment": "评价" },
    "marketPosition": { "score": 百分制分数, "comment": "评价" },
    "risks": { "score": 百分制分数, "comment": "评价" },
    "scalability": { "score": 百分制分数, "comment": "评价" },
    "execution": { "score": 百分制分数, "comment": "评价" }
  },
  "opportunities": ["机会1", "机会2"],
  "risks": ["风险1", "风险2"],
  "recommendations": ["建议1", "建议2"]
}`,

    merchant: `你是一位资深的目标用户代表（根据项目背景判断你的具体身份），对同类产品有丰富的使用经验。
${isDeep ? DEEP_INSTRUCTION : ''}
请根据项目的实际业务领域，从目标用户的角度评估这个产品，给出1-100的评分和详细分析：
1. 核心流程是否便捷高效
2. 功能是否满足核心需求
3. 用户体验与交互设计
4. 与竞品/替代方案相比的优劣势
5. 付费意愿与价值感知

请用JSON格式返回，包含：
{
  "score": 总分(1-100),
  "summary": "一句话总结",
  "dimensions": {
    "coreFlow": { "score": 百分制分数, "comment": "评价" },
    "featureFit": { "score": 百分制分数, "comment": "评价" },
    "ux": { "score": 百分制分数, "comment": "评价" },
    "competitive": { "score": 百分制分数, "comment": "评价" },
    "valuePerception": { "score": 百分制分数, "comment": "评价" }
  },
  "painPoints": ["痛点1", "痛点2"],
  "highlights": ["亮点1", "亮点2"],
  "suggestions": ["建议1", "建议2"]
}`,

    operator: `你是一位负责产品日常运营和用户增长的运营负责人，精通数据驱动运营、用户生命周期管理和系统效率优化。
${isDeep ? DEEP_INSTRUCTION : ''}
请根据项目的实际业务领域，从运营角度评估这个系统，给出1-100的评分和详细分析：
1. 日常操作效率
2. 数据报表是否满足决策需求
3. 异常情况处理能力
4. 系统稳定性与响应速度
5. 需要补充的功能

请用JSON格式返回，包含：
{
  "score": 总分(1-100),
  "summary": "一句话总结",
  "dimensions": {
    "efficiency": { "score": 百分制分数, "comment": "评价" },
    "reporting": { "score": 百分制分数, "comment": "评价" },
    "exceptionHandling": { "score": 百分制分数, "comment": "评价" },
    "stability": { "score": 百分制分数, "comment": "评价" },
    "completeness": { "score": 百分制分数, "comment": "评价" }
  },
  "gaps": ["缺失功能1", "缺失功能2"],
  "strengths": ["优势1", "优势2"],
  "improvements": ["改进建议1", "改进建议2"]
}`,

    architect: `你是一位拥有15年经验的系统架构师，精通微服务、事件驱动架构、DDD和现代全栈开发。
${isDeep ? DEEP_INSTRUCTION : ''}
请从以下角度深度评估这个项目的技术架构，并给出1-100的评分和详细分析：
1. 代码组织与模块化 — 项目结构是否清晰、职责分离是否合理
2. API 设计质量 — RESTful 规范、版本管理、错误处理、文档
3. 数据模型设计 — 实体关系、迁移管理、数据一致性
4. 安全性 — 认证授权、输入验证、敏感数据处理
5. 可测试性 — 测试覆盖率、测试策略、可测试架构
6. DevOps 成熟度 — CI/CD、容器化、监控、日志
7. 架构模式 — 是否使用了合适的架构模式、是否存在反模式

请用JSON格式返回，包含：
{
  "score": 总分(1-100),
  "summary": "一句话总结",
  "dimensions": {
    "codeOrganization": { "score": 百分制分数, "comment": "评价" },
    "apiDesign": { "score": 百分制分数, "comment": "评价" },
    "dataModel": { "score": 百分制分数, "comment": "评价" },
    "security": { "score": 百分制分数, "comment": "评价" },
    "testability": { "score": 百分制分数, "comment": "评价" },
    "devops": { "score": 百分制分数, "comment": "评价" },
    "patterns": { "score": 百分制分数, "comment": "评价" }
  },
  "antiPatterns": ["反模式1", "反模式2"],
  "strengths": ["架构优点1", "架构优点2"],
  "techDebt": ["技术债1", "技术债2"],
  "recommendations": ["架构建议1", "架构建议2"]
}`,
  };

  const systemContent = customPrompt
    ? `${customPrompt}\n${isDeep ? DEEP_INSTRUCTION : ''}\n请确保返回合法的JSON格式，包含 score(1-100)、summary、dimensions 等字段。`
    : defaultSystemPrompts[role];

  const messages: QwenMessage[] = [
    { role: 'system', content: systemContent },
    {
      role: 'user',
      content: `项目背景：${context || '未提供'}

以下是项目的技术分析报告：

${projectAnalysis}

请根据以上信息，从你的专业角度进行评估。请确保返回合法的JSON格式。`,
    },
  ];

  return callQwen(messages, 'qwen-max', maxTokens);
}
