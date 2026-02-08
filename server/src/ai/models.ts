import https from 'https';

export type ModelProvider = 'qwen' | 'openai' | 'claude';

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const MODEL_CONFIGS: Record<ModelProvider, { url: string; defaultModel: string }> = {
  qwen: {
    url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    defaultModel: 'qwen-plus',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4',
  },
  claude: {
    url: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-3-sonnet-20240229',
  },
};

export function getAvailableModels(): { provider: ModelProvider; models: string[]; configured: boolean }[] {
  return [
    {
      provider: 'qwen',
      models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
      configured: !!process.env.DASHSCOPE_API_KEY,
    },
    {
      provider: 'openai',
      models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
      configured: !!process.env.OPENAI_API_KEY,
    },
    {
      provider: 'claude',
      models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
      configured: !!process.env.ANTHROPIC_API_KEY,
    },
  ];
}

export function getDefaultProvider(): ModelProvider {
  if (process.env.DASHSCOPE_API_KEY) return 'qwen';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  return 'qwen';
}

export async function chat(
  messages: ChatMessage[],
  provider?: ModelProvider,
  model?: string
): Promise<ChatResponse> {
  const selectedProvider = provider || getDefaultProvider();
  const config = MODEL_CONFIGS[selectedProvider];
  const selectedModel = model || config.defaultModel;

  switch (selectedProvider) {
    case 'qwen':
      return callQwen(messages, selectedModel);
    case 'openai':
      return callOpenAI(messages, selectedModel);
    case 'claude':
      return callClaude(messages, selectedModel);
    default:
      throw new Error(`Unsupported provider: ${selectedProvider}`);
  }
}

async function callQwen(messages: ChatMessage[], model: string): Promise<ChatResponse> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not configured');

  const requestBody = JSON.stringify({
    model,
    input: { messages },
    parameters: { result_format: 'message' },
  });

  return new Promise((resolve, reject) => {
    const url = new URL(MODEL_CONFIGS.qwen.url);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.code) {
            reject(new Error(`Qwen API error: ${json.message}`));
            return;
          }
          resolve({
            content: json.output?.choices?.[0]?.message?.content || json.output?.text || '',
            model,
            usage: json.usage ? {
              promptTokens: json.usage.input_tokens || 0,
              completionTokens: json.usage.output_tokens || 0,
              totalTokens: json.usage.total_tokens || 0,
            } : undefined,
          });
        } catch (e) {
          reject(new Error(`Failed to parse Qwen response: ${e}`));
        }
      });
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

async function callOpenAI(messages: ChatMessage[], model: string): Promise<ChatResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const requestBody = JSON.stringify({
    model,
    messages,
    temperature: 0.7,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(MODEL_CONFIGS.openai.url);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`OpenAI API error: ${json.error.message}`));
            return;
          }
          resolve({
            content: json.choices?.[0]?.message?.content || '',
            model,
            usage: json.usage ? {
              promptTokens: json.usage.prompt_tokens || 0,
              completionTokens: json.usage.completion_tokens || 0,
              totalTokens: json.usage.total_tokens || 0,
            } : undefined,
          });
        } catch (e) {
          reject(new Error(`Failed to parse OpenAI response: ${e}`));
        }
      });
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

async function callClaude(messages: ChatMessage[], model: string): Promise<ChatResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const systemMessage = messages.find(m => m.role === 'system')?.content || '';
  const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role,
    content: m.content,
  }));

  const requestBody = JSON.stringify({
    model,
    max_tokens: 4096,
    system: systemMessage,
    messages: userMessages,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(MODEL_CONFIGS.claude.url);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(`Claude API error: ${json.error.message}`));
            return;
          }
          resolve({
            content: json.content?.[0]?.text || '',
            model,
            usage: json.usage ? {
              promptTokens: json.usage.input_tokens || 0,
              completionTokens: json.usage.output_tokens || 0,
              totalTokens: (json.usage.input_tokens || 0) + (json.usage.output_tokens || 0),
            } : undefined,
          });
        } catch (e) {
          reject(new Error(`Failed to parse Claude response: ${e}`));
        }
      });
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}
