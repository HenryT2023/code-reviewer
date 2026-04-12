// Centralized AI client.
//
// P0-3..P0-5 deliverables from CLAUDE.md. This is the one entry point every
// LLM call should go through.
//
// Features:
//   - Multi-provider routing: deepseek (default), claude, openai
//   - Retry on 429 / 5xx with exponential backoff + jitter
//   - Per-request timeout
//   - Usage tracking keyed by evaluationId and callSite
//   - Prompt caching for Claude (P0-4): content parts marked `cacheable: true`
//     get `cache_control: { type: 'ephemeral' }` emitted into the request
//
// The Claude and OpenAI paths use the official SDKs (@anthropic-ai/sdk, openai).
// The DeepSeek path stays on a hand-rolled `https.request` because DeepSeek is
// OpenAI-compatible but exposed at a non-standard base URL and we don't want to
// pull a third configuration just to route through the OpenAI SDK. (If this
// changes, the openai SDK supports `baseURL` override and we can collapse.)

import https from 'https';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// ─── Types ──────────────────────────────────────────────────────────

export type Provider = 'deepseek' | 'claude' | 'openai';

/**
 * A chat message content part.
 *
 * `cacheable: true` is a HINT to the Claude provider that this chunk should
 * get a `cache_control: { type: 'ephemeral' }` breakpoint. Non-Claude providers
 * ignore the hint and flatten content parts into a single string.
 *
 * Callers that don't care about caching can pass a plain string for `content`
 * — internally it is normalized to `[{ text, cacheable: false }]`.
 */
export interface ContentPart {
  text: string;
  cacheable?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from a previously-written cache breakpoint. Claude only. */
  cacheReadInputTokens?: number;
  /** Tokens that created a new cache breakpoint entry. Claude only. */
  cacheCreationInputTokens?: number;
}

export interface ChatCallOptions {
  /**
   * LLM provider. Defaults via env detection:
   *   1. process.env.AI_PROVIDER (if set)
   *   2. deepseek if DEEPSEEK_API_KEY present
   *   3. claude if ANTHROPIC_API_KEY present
   *   4. openai if OPENAI_API_KEY present
   *   5. otherwise throws
   */
  provider?: Provider;
  /** Sampling temperature. See CLAUDE.md "Temperature discipline". */
  temperature?: number;
  /** Max output tokens. Default 4000. */
  maxTokens?: number;
  /**
   * Provider-specific model ID. If omitted, each provider picks a sensible
   * default (deepseek-chat, claude-sonnet-4-6, gpt-4o-mini).
   */
  model?: string;
  /**
   * Optional call site tag for usage aggregation. Free-form string like
   * 'judge:coverage', 'role:architect', 'orchestrator:debate'.
   */
  callSite?: string;
  /**
   * Evaluation ID for per-evaluation usage aggregation. Lets the trace UI
   * sum up total tokens per evaluation across every sub-call.
   */
  evaluationId?: string;
  /** Request timeout in ms. Default 120000. */
  timeoutMs?: number;
  /** Max retry attempts on 429/5xx. Default 3. */
  maxRetries?: number;
}

export interface ChatResult {
  content: string;
  provider: Provider;
  model: string;
  usage: ChatUsage;
  /** Number of retry attempts before success (0 = first try). */
  retries: number;
}

// ─── Provider selection ─────────────────────────────────────────────

export function selectProvider(explicit?: Provider): Provider {
  if (explicit) return explicit;
  const envProvider = process.env.AI_PROVIDER?.toLowerCase();
  if (envProvider === 'deepseek' || envProvider === 'claude' || envProvider === 'openai') {
    return envProvider;
  }
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.OPENAI_API_KEY) return 'openai';
  throw new Error(
    'No LLM provider configured. Set DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.'
  );
}

function defaultModelFor(provider: Provider): string {
  switch (provider) {
    case 'deepseek':
      return 'deepseek-chat';
    case 'claude':
      return 'claude-sonnet-4-6';
    case 'openai':
      return 'gpt-4o-mini';
  }
}

// ─── Content normalization ───────────────────────────────────────────

/** Convert a message's content to a uniform ContentPart[]. */
function normalizeContent(content: string | ContentPart[]): ContentPart[] {
  if (typeof content === 'string') {
    return [{ text: content, cacheable: false }];
  }
  return content;
}

/** Flatten parts back to a plain string for providers that don't cache. */
function flattenContent(parts: ContentPart[]): string {
  return parts.map(p => p.text).join('');
}

// ─── Usage aggregator (in-memory) ────────────────────────────────────

interface UsageRecord {
  evaluationId?: string;
  callSite?: string;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  at: number;
}

const usageLog: UsageRecord[] = [];
const MAX_USAGE_LOG = 10_000;

function recordUsage(rec: UsageRecord): void {
  usageLog.push(rec);
  if (usageLog.length > MAX_USAGE_LOG) {
    usageLog.splice(0, usageLog.length - MAX_USAGE_LOG);
  }
}

export interface UsageSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadInputTokens: number;
  byCallSite: Record<
    string,
    { calls: number; inputTokens: number; outputTokens: number }
  >;
}

export function getUsageForEvaluation(evaluationId: string): UsageSummary {
  const records = usageLog.filter(r => r.evaluationId === evaluationId);
  return summarize(records);
}

export function getGlobalUsage(): UsageSummary {
  return summarize(usageLog);
}

function summarize(records: UsageRecord[]): UsageSummary {
  const summary: UsageSummary = {
    totalCalls: records.length,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadInputTokens: 0,
    byCallSite: {},
  };
  for (const r of records) {
    summary.totalInputTokens += r.inputTokens;
    summary.totalOutputTokens += r.outputTokens;
    summary.totalCacheReadInputTokens += r.cacheReadInputTokens ?? 0;
    const key = r.callSite ?? 'unknown';
    const bucket = summary.byCallSite[key] ?? {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
    bucket.calls += 1;
    bucket.inputTokens += r.inputTokens;
    bucket.outputTokens += r.outputTokens;
    summary.byCallSite[key] = bucket;
  }
  return summary;
}

// Exposed for tests only.
export function __resetUsageLogForTest(): void {
  usageLog.length = 0;
}

// ─── Retry + timeout plumbing ────────────────────────────────────────

class RetryableError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'RetryableError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter. attempt is 1-indexed. */
function backoffDelayMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
  const jitter = Math.random() * 250;
  return base + jitter;
}

// ─── DeepSeek provider (hand-rolled, OpenAI-compatible) ──────────────

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

async function callDeepSeekOnce(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  timeoutMs: number
): Promise<{ content: string; usage: ChatUsage }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY not configured');
  }

  // Flatten content parts — DeepSeek has no caching support.
  const flatMessages = messages.map(m => ({
    role: m.role,
    content: flattenContent(normalizeContent(m.content)),
  }));

  const requestBody = JSON.stringify({
    model,
    messages: flatMessages,
    temperature,
    max_tokens: maxTokens,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(DEEPSEEK_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(requestBody),
        },
        timeout: timeoutMs,
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status === 429 || (status >= 500 && status < 600)) {
            reject(new RetryableError(`DeepSeek HTTP ${status}: ${data}`, status));
            return;
          }
          try {
            const response = JSON.parse(data);
            if (response.error?.message) {
              reject(new Error(`DeepSeek API error: ${response.error.message}`));
              return;
            }
            const content = response.choices?.[0]?.message?.content;
            if (typeof content !== 'string') {
              reject(new Error(`DeepSeek unexpected response: ${data}`));
              return;
            }
            resolve({
              content,
              usage: {
                inputTokens: response.usage?.prompt_tokens ?? 0,
                outputTokens: response.usage?.completion_tokens ?? 0,
                cacheReadInputTokens: response.usage?.prompt_cache_hit_tokens,
                cacheCreationInputTokens: response.usage?.prompt_cache_miss_tokens,
              },
            });
          } catch (e) {
            reject(new Error(`DeepSeek parse failed: ${(e as Error).message}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new RetryableError(`DeepSeek request timed out after ${timeoutMs}ms`));
    });

    req.on('error', e => {
      reject(new RetryableError(`DeepSeek request failed: ${e.message}`));
    });

    req.write(requestBody);
    req.end();
  });
}

// ─── Claude provider (via @anthropic-ai/sdk, with prompt caching) ───

/**
 * Convert our generic ChatMessage[] to the Anthropic request shape.
 *
 * Exported for testing — lets us lock in the cache_control marking logic
 * without hitting the network.
 */
export function buildClaudeRequest(
  messages: ChatMessage[]
): {
  system?: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
} {
  const systemBlocks: Anthropic.TextBlockParam[] = [];
  const userAssistantMessages: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    const parts = normalizeContent(msg.content);
    if (msg.role === 'system') {
      // Claude takes `system` as a top-level parameter, not inside messages.
      for (const part of parts) {
        const block: Anthropic.TextBlockParam = { type: 'text', text: part.text };
        if (part.cacheable) {
          block.cache_control = { type: 'ephemeral' };
        }
        systemBlocks.push(block);
      }
    } else {
      // user / assistant messages accept an array of content blocks.
      const content: Anthropic.TextBlockParam[] = parts.map(part => {
        const block: Anthropic.TextBlockParam = { type: 'text', text: part.text };
        if (part.cacheable) {
          block.cache_control = { type: 'ephemeral' };
        }
        return block;
      });
      userAssistantMessages.push({
        role: msg.role,
        content,
      });
    }
  }

  return {
    system: systemBlocks.length > 0 ? systemBlocks : undefined,
    messages: userAssistantMessages,
  };
}

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

async function callClaudeOnce(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  timeoutMs: number
): Promise<{ content: string; usage: ChatUsage }> {
  const client = getAnthropicClient();
  const { system, messages: claudeMessages } = buildClaudeRequest(messages);

  try {
    const response = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: claudeMessages,
      },
      { timeout: timeoutMs }
    );

    // Concatenate all text blocks in the response.
    const content = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    return {
      content,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
      },
    };
  } catch (err) {
    // The SDK throws typed errors — map retryable ones.
    if (err instanceof Anthropic.APIError) {
      const status = err.status ?? 0;
      if (status === 429 || (status >= 500 && status < 600)) {
        throw new RetryableError(`Claude HTTP ${status}: ${err.message}`, status);
      }
    }
    throw err;
  }
}

// ─── OpenAI provider (via openai SDK) ────────────────────────────────

let openaiClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

async function callOpenAIOnce(
  messages: ChatMessage[],
  model: string,
  temperature: number,
  maxTokens: number,
  timeoutMs: number
): Promise<{ content: string; usage: ChatUsage }> {
  const client = getOpenAIClient();

  // Flatten content parts — OpenAI has prompt caching but it's automatic and
  // does not require explicit markers, so we flatten for simplicity.
  const flatMessages = messages.map(m => ({
    role: m.role,
    content: flattenContent(normalizeContent(m.content)),
  }));

  try {
    const response = await client.chat.completions.create(
      {
        model,
        messages: flatMessages,
        temperature,
        max_tokens: maxTokens,
      },
      { timeout: timeoutMs }
    );

    const content = response.choices[0]?.message?.content ?? '';
    const usage = response.usage;
    return {
      content,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        // OpenAI includes cached_tokens inside prompt_tokens_details.
        cacheReadInputTokens: usage?.prompt_tokens_details?.cached_tokens,
      },
    };
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      const status = err.status ?? 0;
      if (status === 429 || (status >= 500 && status < 600)) {
        throw new RetryableError(`OpenAI HTTP ${status}: ${err.message}`, status);
      }
    }
    throw err;
  }
}

// ─── Public entry point ──────────────────────────────────────────────

/**
 * Call an LLM with retry, timeout, and usage tracking.
 *
 * This is the one place LLM calls should go through. Provider is picked
 * via options.provider, env AI_PROVIDER, or auto-detected from available
 * API keys.
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatCallOptions = {}
): Promise<ChatResult> {
  const provider = selectProvider(options.provider);
  const model = options.model ?? defaultModelFor(provider);
  const temperature = options.temperature ?? 0.7;
  const maxTokens = options.maxTokens ?? 4000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxRetries = options.maxRetries ?? 3;

  const callOnce = (): Promise<{ content: string; usage: ChatUsage }> => {
    switch (provider) {
      case 'deepseek':
        return callDeepSeekOnce(messages, model, temperature, maxTokens, timeoutMs);
      case 'claude':
        return callClaudeOnce(messages, model, temperature, maxTokens, timeoutMs);
      case 'openai':
        return callOpenAIOnce(messages, model, temperature, maxTokens, timeoutMs);
    }
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const { content, usage } = await callOnce();
      recordUsage({
        evaluationId: options.evaluationId,
        callSite: options.callSite,
        provider,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        at: Date.now(),
      });
      return { content, provider, model, usage, retries: attempt - 1 };
    } catch (err) {
      lastError = err;
      const retryable = err instanceof RetryableError;
      if (!retryable || attempt > maxRetries) {
        throw err;
      }
      await sleep(backoffDelayMs(attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
