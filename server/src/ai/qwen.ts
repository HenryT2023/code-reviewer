// Thin legacy wrapper over ai/client.ts.
//
// All LLM calls go through `chat()` in client.ts so they share retry, timeout,
// usage tracking, and (on Claude) prompt caching. This file is kept because
// many call sites still import `callQwen` / `QwenMessage` from here. Once P1
// lands we can migrate callers directly to `chat()` and delete this file.

import {
  chat,
  ChatCallOptions,
  ChatMessage,
  ContentPart,
  Provider,
} from './client';
import { getRolePrompt } from './roles';
import { wrapUserContext, withSafetyFooter } from './prompt-safety';

export type QwenMessage = ChatMessage;

/** @deprecated Legacy response shape — no longer produced by this module. */
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

export interface CallQwenOptions {
  /**
   * Sampling temperature.
   *
   * Discipline (see CLAUDE.md):
   *  - 0.0 for deterministic paths: grounded-judge, reference-builder, MREP
   *    verifier, schema-validation retry.
   *  - 0.3 for reflection synthesis and prompt-override generation.
   *  - 0.7 (default) for creative paths: role evaluation, orchestrator debate,
   *    community searcher, user interviews.
   */
  temperature?: number;
  /** Free-form tag for usage aggregation (e.g. 'judge:coverage'). */
  callSite?: string;
  /** Evaluation ID for per-evaluation usage aggregation. */
  evaluationId?: string;
  /** Override auto-detected provider. */
  provider?: Provider;
}

export async function callQwen(
  messages: QwenMessage[],
  model: string = 'deepseek-chat',
  maxTokens: number = 4000,
  options: CallQwenOptions = {}
): Promise<string> {
  const result = await chat(messages, {
    // Only forward an explicit model override when the caller passed a
    // non-default value. This keeps Claude/OpenAI paths free to pick their
    // own default model instead of being forced onto 'deepseek-chat'.
    ...(options.provider && options.provider !== 'deepseek'
      ? {}
      : { model }),
    maxTokens,
    temperature: options.temperature ?? 0.7,
    callSite: options.callSite,
    evaluationId: options.evaluationId,
    provider: options.provider,
  } satisfies ChatCallOptions);
  return result.content;
}

/**
 * Build the role-evaluation user message with a cache-aware split:
 *   [ cacheable: project analysis ]   ← shared across all roles
 *   [ variable: role-specific suffix ]
 *
 * On Claude this produces a `cache_control: ephemeral` breakpoint on the
 * analysis chunk so role #2…#14 read it from cache. On DeepSeek/OpenAI the
 * parts are concatenated and sent as a plain string.
 *
 * The user-provided `context` is wrapped in <user_context>...</user_context>
 * via prompt-safety.ts so the model can distinguish trusted analysis text
 * from untrusted user input — see P1-4 in CLAUDE.md.
 */
function buildRoleUserContent(
  projectAnalysis: string,
  context: string
): ContentPart[] {
  const wrapped = wrapUserContext(context);
  const backgroundBlock = wrapped
    ? `项目背景（不可信用户输入，边界见标签）：\n${wrapped}`
    : `项目背景：未提供`;

  return [
    {
      // Stable prefix — same across every role in an evaluation. Marked
      // cacheable so Claude can serve subsequent roles from the 5m cache.
      text: `${backgroundBlock}

以下是项目的技术分析报告（由静态分析器产生，可信）：

${projectAnalysis}`,
      cacheable: true,
    },
    {
      // Variable suffix — the role-specific instruction. Not cached.
      text: `

请根据以上信息，从你的专业角度进行评估。请确保返回合法的JSON格式。`,
      cacheable: false,
    },
  ];
}

export async function evaluateWithRole(
  role: string,
  projectAnalysis: string,
  context: string,
  depth: 'quick' | 'deep' = 'quick',
  mode: 'standard' | 'launch-ready' = 'standard',
  customPrompt?: string,
  projectPath?: string,
  evaluationId?: string,
  provider?: Provider
): Promise<string> {
  const isDeep = depth === 'deep';
  const maxTokens = isDeep ? 8000 : 4000;

  // Append the safety footer so the model treats <user_context> as
  // untrusted data. Done at the last possible moment so custom role prompts
  // (from prompt-overrides) still get protected.
  const systemContent = withSafetyFooter(
    getRolePrompt(role, mode, isDeep, customPrompt, projectPath)
  );

  const messages: QwenMessage[] = [
    { role: 'system', content: systemContent },
    {
      role: 'user',
      content: buildRoleUserContent(projectAnalysis, context),
    },
  ];

  return callQwen(messages, 'deepseek-chat', maxTokens, {
    callSite: `role:${role}`,
    evaluationId,
    provider,
  });
}
