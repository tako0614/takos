import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createProvider: vi.fn(),
  getProviderFromModel: vi.fn(),
}));

vi.mock('@/services/agent/providers', () => ({
  createProvider: mocks.createProvider,
  getProviderFromModel: mocks.getProviderFromModel,
  DEFAULT_MODEL_ID: 'gpt-5.4-nano',
}));

import {
  LLMClient,
  createLLMClient,
  createMultiModelClient,
  createLLMClientFromEnv,
  VALID_PROVIDERS,
} from '@/services/agent/llm';

describe('LLMClient', () => {
  const mockProvider = {
    chat: vi.fn(async () => ({
      content: 'hello',
      stopReason: 'stop' as const,
      usage: { inputTokens: 10, outputTokens: 5 },
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProvider.mockReturnValue(mockProvider);
    mocks.getProviderFromModel.mockReturnValue('openai');
  });

  it('creates a provider with default model when none specified', () => {
    new LLMClient({ apiKey: 'test-key' });
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.4-nano',
        apiKey: 'test-key',
        maxTokens: 4096,
        temperature: 1,
      }),
    );
  });

  it('uses explicit provider from config', () => {
    new LLMClient({ apiKey: 'test-key', provider: 'anthropic', model: 'claude-4-sonnet' });
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', model: 'claude-4-sonnet' }),
    );
  });

  it('uses anthropicApiKey when provider is anthropic', () => {
    new LLMClient({ apiKey: 'openai-key', anthropicApiKey: 'ant-key', provider: 'anthropic', model: 'claude-4-sonnet' });
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'ant-key' }),
    );
  });

  it('uses googleApiKey when provider is google', () => {
    new LLMClient({ apiKey: 'openai-key', googleApiKey: 'goog-key', provider: 'google', model: 'gemini-2.0-flash' });
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'goog-key' }),
    );
  });

  it('respects custom maxTokens and temperature', () => {
    new LLMClient({ apiKey: 'key', maxTokens: 8192, temperature: 0.3 });
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ maxTokens: 8192, temperature: 0.3 }),
    );
  });

  it('preserves temperature=0 (uses ?? not ||)', () => {
    new LLMClient({ apiKey: 'key', temperature: 0 });
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0 }),
    );
  });

  it('defaults temperature to 1 when undefined', () => {
    new LLMClient({ apiKey: 'key', temperature: undefined });
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 1 }),
    );
  });

  it('defaults temperature to 1 when not provided', () => {
    new LLMClient({ apiKey: 'key' });
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 1 }),
    );
  });

  it('treats temperature=null as nullish — defaults to 1', () => {
    new LLMClient({ apiKey: 'key', temperature: null as unknown as number });
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 1 }),
    );
  });

  it('getConfig returns the original config', () => {
    const config = { apiKey: 'key', model: 'gpt-5.4-mini' };
    const client = new LLMClient(config);
    expect(client.getConfig()).toEqual(config);
  });

  it('chat delegates to provider.chat', async () => {
    const client = new LLMClient({ apiKey: 'key' });
    const msgs = [{ role: 'user' as const, content: 'hi' }];
    const tools = [{ name: 'test', description: 'test tool', parameters: { type: 'object' as const, properties: {} } }];
    const signal = new AbortController().signal;

    const result = await client.chat(msgs, tools, signal);
    expect(mockProvider.chat).toHaveBeenCalledWith(msgs, tools, signal);
    expect(result.content).toBe('hello');
  });
});

describe('createLLMClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProvider.mockReturnValue({ chat: vi.fn() });
    mocks.getProviderFromModel.mockReturnValue('openai');
  });

  it('creates a client with apiKey and optional config', () => {
    const client = createLLMClient('my-key', { model: 'gpt-5.4-mini' });
    expect(client).toBeInstanceOf(LLMClient);
    expect(client.getConfig()).toEqual(expect.objectContaining({ apiKey: 'my-key', model: 'gpt-5.4-mini' }));
  });
});

describe('createMultiModelClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProvider.mockReturnValue({ chat: vi.fn() });
    mocks.getProviderFromModel.mockReturnValue('openai');
  });

  it('creates a client from full config', () => {
    const config = { apiKey: 'key', model: 'gpt-5.4-mini', provider: 'openai' as const };
    const client = createMultiModelClient(config);
    expect(client).toBeInstanceOf(LLMClient);
  });
});

describe('createLLMClientFromEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProvider.mockReturnValue({ chat: vi.fn() });
    mocks.getProviderFromModel.mockReturnValue('openai');
  });

  it('creates a client using OPENAI_API_KEY', () => {
    const client = createLLMClientFromEnv({ OPENAI_API_KEY: 'oai-key' });
    expect(client).toBeInstanceOf(LLMClient);
  });

  it('creates a client using ANTHROPIC_API_KEY with claude model', () => {
    mocks.getProviderFromModel.mockReturnValue('anthropic');
    const client = createLLMClientFromEnv({
      ANTHROPIC_API_KEY: 'ant-key',
      AI_MODEL: 'claude-4-sonnet',
    });
    expect(client).toBeInstanceOf(LLMClient);
  });

  it('creates a client using GOOGLE_API_KEY with gemini model', () => {
    mocks.getProviderFromModel.mockReturnValue('google');
    const client = createLLMClientFromEnv({
      GOOGLE_API_KEY: 'goog-key',
      AI_MODEL: 'gemini-2.0-flash',
    });
    expect(client).toBeInstanceOf(LLMClient);
  });

  it('throws when no API key is available for the provider', () => {
    expect(() => createLLMClientFromEnv({})).toThrow('OpenAI API key');
  });

  it('throws for anthropic provider without key', () => {
    mocks.getProviderFromModel.mockReturnValue('anthropic');
    expect(() => createLLMClientFromEnv({ AI_MODEL: 'claude-4-sonnet' })).toThrow('Anthropic API key');
  });

  it('uses AI_PROVIDER env when specified', () => {
    mocks.getProviderFromModel.mockReturnValue('openai');
    const client = createLLMClientFromEnv({
      OPENAI_API_KEY: 'oai-key',
      AI_PROVIDER: 'openai',
    });
    expect(client).toBeInstanceOf(LLMClient);
  });

  it('ignores invalid AI_PROVIDER value', () => {
    mocks.getProviderFromModel.mockReturnValue('openai');
    const client = createLLMClientFromEnv({
      OPENAI_API_KEY: 'oai-key',
      AI_PROVIDER: 'invalid-provider',
    });
    expect(client).toBeInstanceOf(LLMClient);
  });
});

describe('constants', () => {
  it('exports VALID_PROVIDERS containing openai, anthropic, google', () => {
    expect(VALID_PROVIDERS).toEqual(['openai', 'anthropic', 'google']);
  });
});
