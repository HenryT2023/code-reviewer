import https from 'https';
import { getRolePrompt } from './roles';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

function getApiKey(): string {
  return process.env.DEEPSEEK_API_KEY || '';
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
  model: string = 'deepseek-chat',
  maxTokens: number = 4000
): Promise<string> {
  const requestBody = JSON.stringify({
    model,
    messages,
    temperature: 0.7,
    max_tokens: maxTokens,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(DEEPSEEK_URL);
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
          if (response.choices?.[0]?.message?.content) {
            resolve(response.choices[0].message.content);
          } else if (response.error?.message) {
            reject(new Error(`DeepSeek API error: ${response.error.message}`));
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
  role: string,
  projectAnalysis: string,
  context: string,
  depth: 'quick' | 'deep' = 'quick',
  mode: 'standard' | 'launch-ready' = 'standard',
  customPrompt?: string
): Promise<string> {
  const isDeep = depth === 'deep';
  const maxTokens = isDeep ? 8000 : 4000;

  const systemContent = getRolePrompt(role, mode, isDeep, customPrompt);

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

  return callQwen(messages, 'deepseek-chat', maxTokens);
}
