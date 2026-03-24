import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRunInContainer } from '@takos/agent-core/run-executor';
import { parseStartPayload } from '@takos/agent-core/executor-utils';

describe('agent-core no-LLM fast path', () => {
  const originalEnv = {
    PROXY_BASE_URL: process.env.PROXY_BASE_URL,
  };

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('accepts payloads without a binding proxy token', () => {
    const parsed = parseStartPayload({
      runId: 'run-1',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
    });

    expect(parsed).toEqual({
      ok: true,
      payload: {
        runId: 'run-1',
        workerId: 'worker-1',
        model: undefined,
        controlRpcToken: 'control-token',
        controlRpcBaseUrl: undefined,
      },
    });
  });

  it('completes no-LLM runs without constructing binding proxies', async () => {
    const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      fetchCalls.push({ url, body });

      if (url.endsWith('/rpc/control/api-keys')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.endsWith('/rpc/control/run-context')) {
        return new Response(JSON.stringify({
          status: 'running',
          threadId: 'thread-1',
          sessionId: 'session-1',
          lastUserMessage: 'hello from test',
        }), { status: 200 });
      }
      if (url.endsWith('/rpc/control/no-llm-complete')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const executeRun = vi.fn(async () => {
      throw new Error('executeRun should not be called in no-LLM fast path');
    });
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await executeRunInContainer({
      runId: 'run-1',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'http://control-rpc.internal',
    }, {
      serviceName: 'test-executor',
      logger,
      executeRun,
      runtimeConfig: {
        allowNoLlmFallback: true,
      },
    });

    expect(executeRun).not.toHaveBeenCalled();
    expect(fetchCalls.map((call) => call.url)).toEqual([
      'http://control-rpc.internal/rpc/control/api-keys',
      'http://control-rpc.internal/rpc/control/run-context',
      'http://control-rpc.internal/rpc/control/no-llm-complete',
    ]);
    expect(fetchCalls[2]?.body).toEqual({
      runId: 'run-1',
      workerId: 'worker-1',
      response: expect.stringContaining('hello from test'),
    });
  });

  it('prefers CONTROL_RPC_BASE_URL over PROXY_BASE_URL for the canonical no-LLM path', async () => {
    process.env.PROXY_BASE_URL = 'http://proxy.internal';

    const fetchCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      fetchCalls.push(url);

      if (url.endsWith('/rpc/control/api-keys')) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.endsWith('/rpc/control/run-context')) {
        return new Response(JSON.stringify({
          status: 'running',
          threadId: 'thread-1',
          sessionId: 'session-1',
          lastUserMessage: 'hello from preferred control rpc',
        }), { status: 200 });
      }
      if (url.endsWith('/rpc/control/no-llm-complete')) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await executeRunInContainer({
      runId: 'run-control-rpc-preferred',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'http://control-rpc.internal',
    }, {
      serviceName: 'test-executor',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      executeRun: vi.fn(async () => {
        throw new Error('executeRun should not be called in no-LLM fast path');
      }),
      runtimeConfig: {
        allowNoLlmFallback: true,
      },
    });

    expect(fetchCalls).toEqual([
      'http://control-rpc.internal/rpc/control/api-keys',
      'http://control-rpc.internal/rpc/control/run-context',
      'http://control-rpc.internal/rpc/control/no-llm-complete',
    ]);
    expect(fetchCalls.every((url) => !url.startsWith('http://proxy.internal'))).toBe(true);
  });

  it('executes LLM-enabled runs without binding proxies by default', async () => {
    const fetchCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      fetchCalls.push(url);

      if (url.endsWith('/rpc/control/api-keys')) {
        return new Response(JSON.stringify({ openai: 'sk-test' }), { status: 200 });
      }
      if (url.endsWith('/rpc/control/billing-run-usage')) {
        return new Response(JSON.stringify({ recorded: true }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const executeRun = vi.fn(async (
      env: Record<string, unknown>,
      apiKey: string | undefined,
      runId: string,
      _model: string | undefined,
      options: { abortSignal?: AbortSignal; runIo: unknown },
    ) => {
      expect(apiKey).toBe('sk-test');
      expect(runId).toBe('run-llm');
      expect(env.OPENAI_API_KEY).toBe('sk-test');
      expect(env).not.toHaveProperty('DB');
      expect(env).not.toHaveProperty('TAKOS_OFFLOAD');
      expect(env).not.toHaveProperty('RUN_NOTIFIER');
      expect(options.runIo).toBeDefined();
    });

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await executeRunInContainer({
      runId: 'run-llm',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'http://control-rpc.internal',
    }, {
      serviceName: 'test-executor',
      logger,
      executeRun,
    });

    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(fetchCalls).toEqual([
      'http://control-rpc.internal/rpc/control/api-keys',
      'http://control-rpc.internal/rpc/control/billing-run-usage',
    ]);
  });

  it('requires controlRpcToken in the canonical start payload', () => {
    const parsed = parseStartPayload({
      runId: 'run-missing-token',
      workerId: 'worker-1',
    });

    expect(parsed).toEqual({
      ok: false,
      error: 'Missing required field: controlRpcToken',
    });
  });
});
