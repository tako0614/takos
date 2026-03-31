import { assertEquals, assert, assertThrows } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  createProvider: ((..._args: any[]) => undefined) as any,
  getProviderFromModel: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/agent/providers'
import {
  LLMClient,
  createLLMClientFromEnv,
  VALID_PROVIDERS,
} from '@/services/agent/llm';


  const mockProvider = {
    chat: async () => ({
      content: 'hello',
      stopReason: 'stop' as const,
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
  };
  Deno.test('LLMClient - creates a provider with default model when none specified', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  new LLMClient({ apiKey: 'test-key' });
    assertSpyCallArgs(mocks.createProvider, 0, [
      ({
        provider: 'openai',
        model: 'gpt-5.4-nano',
        apiKey: 'test-key',
        maxTokens: 4096,
        temperature: 1,
      }),
    ]);
})
  Deno.test('LLMClient - uses explicit provider from config', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  new LLMClient({ apiKey: 'test-key', provider: 'anthropic', model: 'claude-4-sonnet' });
    assertSpyCallArgs(mocks.createProvider, 0, [
      ({ provider: 'anthropic', model: 'claude-4-sonnet' }),
    ]);
})
  Deno.test('LLMClient - uses anthropicApiKey when provider is anthropic', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  new LLMClient({ apiKey: 'openai-key', anthropicApiKey: 'ant-key', provider: 'anthropic', model: 'claude-4-sonnet' });
    assertSpyCallArgs(mocks.createProvider, 0, [
      ({ apiKey: 'ant-key' }),
    ]);
})
  Deno.test('LLMClient - uses googleApiKey when provider is google', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  new LLMClient({ apiKey: 'openai-key', googleApiKey: 'goog-key', provider: 'google', model: 'gemini-2.0-flash' });
    assertSpyCallArgs(mocks.createProvider, 0, [
      ({ apiKey: 'goog-key' }),
    ]);
})
  Deno.test('LLMClient - respects custom maxTokens and temperature', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  new LLMClient({ apiKey: 'key', maxTokens: 8192, temperature: 0.3 });
    assertSpyCallArgs(mocks.createProvider, 0, [
      ({ maxTokens: 8192, temperature: 0.3 }),
    ]);
})
  Deno.test('LLMClient - preserves temperature=0 (uses ?? not ||)', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  new LLMClient({ apiKey: 'key', temperature: 0 });
    assertSpyCallArgs(mocks.createProvider, 0, [
      ({ temperature: 0 }),
    ]);
})
  Deno.test('LLMClient - defaults temperature to 1 when undefined', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  new LLMClient({ apiKey: 'key', temperature: undefined });
    assertSpyCallArgs(mocks.createProvider, 0, [
      ({ temperature: 1 }),
    ]);
})
  Deno.test('LLMClient - defaults temperature to 1 when not provided', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  new LLMClient({ apiKey: 'key' });
    assertSpyCallArgs(mocks.createProvider, 0, [
      ({ temperature: 1 }),
    ]);
})
  Deno.test('LLMClient - treats temperature=null as nullish — defaults to 1', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  new LLMClient({ apiKey: 'key', temperature: null as unknown as number });
    assertSpyCallArgs(mocks.createProvider, 0, [
      ({ temperature: 1 }),
    ]);
})
  Deno.test('LLMClient - getConfig returns the original config', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  const config = { apiKey: 'key', model: 'gpt-5.4-mini' };
    const client = new LLMClient(config);
    assertEquals(client.getConfig(), config);
})
  Deno.test('LLMClient - chat delegates to provider.chat', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => mockProvider) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  const client = new LLMClient({ apiKey: 'key' });
    const msgs = [{ role: 'user' as const, content: 'hi' }];
    const tools = [{ name: 'test', description: 'test tool', parameters: { type: 'object' as const, properties: {} } }];
    const signal = new AbortController().signal;

    const result = await client.chat(msgs, tools, signal);
    assertSpyCallArgs(mockProvider.chat, 0, [msgs, tools, signal]);
    assertEquals(result.content, 'hello');
})

  Deno.test('createLLMClientFromEnv - creates a client using OPENAI_API_KEY', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => ({ chat: ((..._args: any[]) => undefined) as any })) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  const client = createLLMClientFromEnv({ OPENAI_API_KEY: 'oai-key' });
    assert(client instanceof LLMClient);
})
  Deno.test('createLLMClientFromEnv - creates a client using ANTHROPIC_API_KEY with claude model', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => ({ chat: ((..._args: any[]) => undefined) as any })) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  mocks.getProviderFromModel = (() => 'anthropic') as any;
    const client = createLLMClientFromEnv({
      ANTHROPIC_API_KEY: 'ant-key',
      AI_MODEL: 'claude-4-sonnet',
    });
    assert(client instanceof LLMClient);
})
  Deno.test('createLLMClientFromEnv - creates a client using GOOGLE_API_KEY with gemini model', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => ({ chat: ((..._args: any[]) => undefined) as any })) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  mocks.getProviderFromModel = (() => 'google') as any;
    const client = createLLMClientFromEnv({
      GOOGLE_API_KEY: 'goog-key',
      AI_MODEL: 'gemini-2.0-flash',
    });
    assert(client instanceof LLMClient);
})
  Deno.test('createLLMClientFromEnv - throws when no API key is available for the provider', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => ({ chat: ((..._args: any[]) => undefined) as any })) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  assertThrows(() => { () => createLLMClientFromEnv({}); }, 'OpenAI API key');
})
  Deno.test('createLLMClientFromEnv - throws for anthropic provider without key', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => ({ chat: ((..._args: any[]) => undefined) as any })) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  mocks.getProviderFromModel = (() => 'anthropic') as any;
    assertThrows(() => { () => createLLMClientFromEnv({ AI_MODEL: 'claude-4-sonnet' }); }, 'Anthropic API key');
})
  Deno.test('createLLMClientFromEnv - uses AI_PROVIDER env when specified', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => ({ chat: ((..._args: any[]) => undefined) as any })) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  mocks.getProviderFromModel = (() => 'openai') as any;
    const client = createLLMClientFromEnv({
      OPENAI_API_KEY: 'oai-key',
      AI_PROVIDER: 'openai',
    });
    assert(client instanceof LLMClient);
})
  Deno.test('createLLMClientFromEnv - ignores invalid AI_PROVIDER value', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.createProvider = (() => ({ chat: ((..._args: any[]) => undefined) as any })) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;
  mocks.getProviderFromModel = (() => 'openai') as any;
    const client = createLLMClientFromEnv({
      OPENAI_API_KEY: 'oai-key',
      AI_PROVIDER: 'invalid-provider',
    });
    assert(client instanceof LLMClient);
})

  Deno.test('constants - exports VALID_PROVIDERS containing openai, anthropic, google', () => {
  assertEquals(VALID_PROVIDERS, ['openai', 'anthropic', 'google']);
})