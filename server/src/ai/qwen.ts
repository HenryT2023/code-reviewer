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
  model: string = 'qwen-max'
): Promise<string> {
  const requestBody = JSON.stringify({
    model,
    input: {
      messages,
    },
    parameters: {
      result_format: 'text',
      temperature: 0.7,
      max_tokens: 4000,
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

export async function evaluateWithRole(
  role: 'boss' | 'merchant' | 'operator',
  projectAnalysis: string,
  context: string
): Promise<string> {
  const systemPrompts: Record<string, string> = {
    boss: `你是一位拥有20年香港分销行业经验的企业老板，精通供应链管理和B2B业务。
请从以下角度评估这个项目，并给出1-100的评分和详细分析：
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
    "roi": { "score": 分数, "comment": "评价" },
    "marketPosition": { "score": 分数, "comment": "评价" },
    "risks": { "score": 分数, "comment": "评价" },
    "scalability": { "score": 分数, "comment": "评价" },
    "execution": { "score": 分数, "comment": "评价" }
  },
  "opportunities": ["机会1", "机会2"],
  "risks": ["风险1", "风险2"],
  "recommendations": ["建议1", "建议2"]
}`,

    merchant: `你是一位香港中小餐厅的采购经理，每天需要订购净菜食材，对供应商平台有丰富的使用经验。
请从以下角度评估这个B2B平台，并给出1-100的评分和详细分析：
1. 下单流程是否便捷
2. 价格是否透明、有竞争力
3. 配送时效能否满足需求
4. 售后服务是否完善
5. 与现有供应商相比的优劣势

请用JSON格式返回，包含：
{
  "score": 总分(1-100),
  "summary": "一句话总结",
  "dimensions": {
    "orderFlow": { "score": 分数, "comment": "评价" },
    "pricing": { "score": 分数, "comment": "评价" },
    "delivery": { "score": 分数, "comment": "评价" },
    "afterSales": { "score": 分数, "comment": "评价" },
    "competitive": { "score": 分数, "comment": "评价" }
  },
  "painPoints": ["痛点1", "痛点2"],
  "highlights": ["亮点1", "亮点2"],
  "suggestions": ["建议1", "建议2"]
}`,

    operator: `你是一位供应链公司的运营主管，负责日常订单处理和客户服务，对后台管理系统有丰富的使用经验。
请从以下角度评估这个管理后台，并给出1-100的评分和详细分析：
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
    "efficiency": { "score": 分数, "comment": "评价" },
    "reporting": { "score": 分数, "comment": "评价" },
    "exceptionHandling": { "score": 分数, "comment": "评价" },
    "stability": { "score": 分数, "comment": "评价" },
    "completeness": { "score": 分数, "comment": "评价" }
  },
  "gaps": ["缺失功能1", "缺失功能2"],
  "strengths": ["优势1", "优势2"],
  "improvements": ["改进建议1", "改进建议2"]
}`,
  };

  const messages: QwenMessage[] = [
    { role: 'system', content: systemPrompts[role] },
    {
      role: 'user',
      content: `项目背景：${context}

以下是项目的技术分析报告：

${projectAnalysis}

请根据以上信息，从你的专业角度进行评估。`,
    },
  ];

  return callQwen(messages);
}
