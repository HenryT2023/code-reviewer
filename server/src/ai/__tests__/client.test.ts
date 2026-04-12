// Tests for ai/client.ts.
//
// We deliberately do NOT hit the network. All network paths are tested
// elsewhere in an integration suite. What we lock in here are the pure
// decisions that govern how messages are shaped and how providers are
// selected — these are the things a future refactor could silently break.

import {
  __resetUsageLogForTest,
  buildClaudeRequest,
  ChatMessage,
  getGlobalUsage,
  getUsageForEvaluation,
  selectProvider,
} from '../client';

describe('ai/client usage aggregator', () => {
  beforeEach(() => {
    __resetUsageLogForTest();
  });

  test('global summary is empty after reset', () => {
    const summary = getGlobalUsage();
    expect(summary.totalCalls).toBe(0);
    expect(summary.totalInputTokens).toBe(0);
    expect(summary.totalOutputTokens).toBe(0);
  });

  test('per-evaluation summary returns zeros when no records match', () => {
    const summary = getUsageForEvaluation('nonexistent');
    expect(summary.totalCalls).toBe(0);
  });

  test('summary shape is stable for empty log', () => {
    const summary = getGlobalUsage();
    expect(summary).toEqual({
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadInputTokens: 0,
      byCallSite: {},
    });
  });
});

describe('ai/client selectProvider', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AI_PROVIDER;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  test('explicit provider wins over env', () => {
    process.env.DEEPSEEK_API_KEY = 'x';
    process.env.ANTHROPIC_API_KEY = 'y';
    expect(selectProvider('claude')).toBe('claude');
    expect(selectProvider('openai')).toBe('openai');
  });

  test('AI_PROVIDER env overrides key-based detection', () => {
    process.env.DEEPSEEK_API_KEY = 'x';
    process.env.AI_PROVIDER = 'claude';
    expect(selectProvider()).toBe('claude');
  });

  test('invalid AI_PROVIDER falls through to key-based detection', () => {
    process.env.AI_PROVIDER = 'bogus';
    process.env.OPENAI_API_KEY = 'x';
    expect(selectProvider()).toBe('openai');
  });

  test('key detection prefers deepseek, then claude, then openai', () => {
    process.env.DEEPSEEK_API_KEY = 'x';
    process.env.ANTHROPIC_API_KEY = 'y';
    process.env.OPENAI_API_KEY = 'z';
    expect(selectProvider()).toBe('deepseek');

    delete process.env.DEEPSEEK_API_KEY;
    expect(selectProvider()).toBe('claude');

    delete process.env.ANTHROPIC_API_KEY;
    expect(selectProvider()).toBe('openai');
  });

  test('throws when no key configured and no explicit provider', () => {
    expect(() => selectProvider()).toThrow(/No LLM provider/);
  });
});

describe('ai/client buildClaudeRequest', () => {
  test('string content is turned into a single text block', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys text' },
      { role: 'user', content: 'user text' },
    ];
    const req = buildClaudeRequest(messages);

    expect(req.system).toEqual([{ type: 'text', text: 'sys text' }]);
    expect(req.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'text', text: 'user text' }],
      },
    ]);
  });

  test('cacheable content parts get cache_control: ephemeral', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { text: 'long analysis', cacheable: true },
          { text: 'variable suffix', cacheable: false },
        ],
      },
    ];
    const req = buildClaudeRequest(messages);

    expect(req.messages[0].content).toEqual([
      {
        type: 'text',
        text: 'long analysis',
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: 'variable suffix' },
    ]);
  });

  test('system-role cacheable parts produce system array with cache_control', () => {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [{ text: 'shared role prompt', cacheable: true }],
      },
      { role: 'user', content: 'question' },
    ];
    const req = buildClaudeRequest(messages);

    expect(req.system).toEqual([
      {
        type: 'text',
        text: 'shared role prompt',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  test('system is omitted when there are no system messages', () => {
    const req = buildClaudeRequest([{ role: 'user', content: 'hi' }]);
    expect(req.system).toBeUndefined();
  });

  test('non-cacheable parts do not emit cache_control', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [{ text: 'plain', cacheable: false }],
      },
    ];
    const req = buildClaudeRequest(messages);
    const block = req.messages[0].content[0];
    expect(block).not.toHaveProperty('cache_control');
  });
});
