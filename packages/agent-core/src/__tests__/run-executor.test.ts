import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { shouldResetRunToQueuedOnContainerError } from '../run-executor.js';
import type { RunStatus } from '../run-executor.js';

// ---------------------------------------------------------------------------
// shouldResetRunToQueuedOnContainerError
// ---------------------------------------------------------------------------

describe('shouldResetRunToQueuedOnContainerError', () => {
  it('returns true for "running" status', () => {
    expect(shouldResetRunToQueuedOnContainerError('running')).toBe(true);
  });

  it('returns false for "completed" status', () => {
    expect(shouldResetRunToQueuedOnContainerError('completed')).toBe(false);
  });

  it('returns false for "failed" status', () => {
    expect(shouldResetRunToQueuedOnContainerError('failed')).toBe(false);
  });

  it('returns false for "cancelled" status', () => {
    expect(shouldResetRunToQueuedOnContainerError('cancelled')).toBe(false);
  });

  it('returns false for "pending" status', () => {
    expect(shouldResetRunToQueuedOnContainerError('pending')).toBe(false);
  });

  it('returns false for "queued" status', () => {
    expect(shouldResetRunToQueuedOnContainerError('queued')).toBe(false);
  });

  it('returns false for null', () => {
    expect(shouldResetRunToQueuedOnContainerError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(shouldResetRunToQueuedOnContainerError(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeRunInContainer - integration-style tests with mocked fetch
// ---------------------------------------------------------------------------

describe('executeRunInContainer', () => {
  let fetchSpy: any;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  function mockFetchSequence(responses: Array<{ path: string; body: unknown; status?: number }>) {
    let callIndex = 0;
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const expectedResponse = responses[callIndex];
      callIndex++;
      if (!expectedResponse) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(
        JSON.stringify(expectedResponse.body),
        { status: expectedResponse.status ?? 200 },
      );
    });
  }

  it('throws when controlRpcToken is missing', async () => {
    const { executeRunInContainer } = await import('../run-executor.js');
    await expect(
      executeRunInContainer(
        { runId: 'r-1', workerId: 'w-1' },
        {
          serviceName: 'test',
          logger: mockLogger,
          executeRun: vi.fn(),
        },
      ),
    ).rejects.toThrow('Missing control RPC token');
  });

  it('throws when controlRpcBaseUrl is missing', async () => {
    const { executeRunInContainer } = await import('../run-executor.js');
    await expect(
      executeRunInContainer(
        { runId: 'r-1', workerId: 'w-1', controlRpcToken: 'tok' },
        {
          serviceName: 'test',
          logger: mockLogger,
          executeRun: vi.fn(),
        },
      ),
    ).rejects.toThrow('Missing CONTROL_RPC_BASE_URL');
  });

  it('resets run and throws when no API keys are available', async () => {
    const { executeRunInContainer } = await import('../run-executor.js');

    // Mock: fetchApiKeys returns no keys
    mockFetchSequence([
      { path: '/rpc/control/api-keys', body: { openai: null, anthropic: null, google: null } },
      { path: '/rpc/control/run-reset', body: {} },
    ]);

    await expect(
      executeRunInContainer(
        {
          runId: 'r-1',
          workerId: 'w-1',
          controlRpcToken: 'tok',
          controlRpcBaseUrl: 'https://control.example.com',
        },
        {
          serviceName: 'test',
          logger: mockLogger,
          executeRun: vi.fn(),
        },
      ),
    ).rejects.toThrow('No LLM API keys available');
  });

  it('invokes no-LLM fast path when allowNoLlmFallback is true', async () => {
    const { executeRunInContainer } = await import('../run-executor.js');

    mockFetchSequence([
      { path: '/rpc/control/api-keys', body: { openai: null, anthropic: null, google: null } },
      { path: '/rpc/control/run-context', body: { lastUserMessage: 'hello' } },
      { path: '/rpc/control/no-llm-complete', body: {} },
    ]);

    await executeRunInContainer(
      {
        runId: 'r-1',
        workerId: 'w-1',
        controlRpcToken: 'tok',
        controlRpcBaseUrl: 'https://control.example.com',
      },
      {
        serviceName: 'test',
        logger: mockLogger,
        executeRun: vi.fn(),
        runtimeConfig: {
          allowNoLlmFallback: true,
        },
      },
    );

    // Should have called no-llm-complete
    const urls = fetchSpy.mock.calls.map((c: any) => c[0] as string);
    expect(urls.some((u: string) => u.includes('/rpc/control/no-llm-complete'))).toBe(true);
  });

  it('calls executeRun and records billing on success', async () => {
    const { executeRunInContainer } = await import('../run-executor.js');

    const executeRun = vi.fn().mockResolvedValue(undefined);

    mockFetchSequence([
      { path: '/rpc/control/api-keys', body: { openai: 'sk-test', anthropic: null, google: null } },
      { path: '/rpc/control/billing-run-usage', body: {} },
    ]);

    await executeRunInContainer(
      {
        runId: 'r-1',
        workerId: 'w-1',
        controlRpcToken: 'tok',
        controlRpcBaseUrl: 'https://control.example.com',
      },
      {
        serviceName: 'test',
        logger: mockLogger,
        executeRun,
        runtimeConfig: {
          maxRunDurationMs: 60000,
        },
      },
    );

    expect(executeRun).toHaveBeenCalledTimes(1);
    const [env, apiKey, runId, model] = executeRun.mock.calls[0];
    expect(env.OPENAI_API_KEY).toBe('sk-test');
    expect(apiKey).toBe('sk-test');
    expect(runId).toBe('r-1');
  });

  it('resets run when executeRun fails and status is running', async () => {
    const { executeRunInContainer } = await import('../run-executor.js');

    const executeRun = vi.fn().mockRejectedValue(new Error('Agent crash'));

    mockFetchSequence([
      { path: '/rpc/control/api-keys', body: { openai: 'sk-test', anthropic: null, google: null } },
      { path: '/rpc/control/run-status', body: { status: 'running' } },
      { path: '/rpc/control/run-reset', body: {} },
    ]);

    await executeRunInContainer(
      {
        runId: 'r-1',
        workerId: 'w-1',
        controlRpcToken: 'tok',
        controlRpcBaseUrl: 'https://control.example.com',
      },
      {
        serviceName: 'test',
        logger: mockLogger,
        executeRun,
        runtimeConfig: {
          maxRunDurationMs: 60000,
        },
      },
    );

    // run-reset should have been called
    const urls = fetchSpy.mock.calls.map((c: any) => c[0] as string);
    expect(urls.some((u: string) => u.includes('/rpc/control/run-reset'))).toBe(true);
  });

  it('preserves terminal status when executeRun fails', async () => {
    const { executeRunInContainer } = await import('../run-executor.js');

    const executeRun = vi.fn().mockRejectedValue(new Error('Agent crash'));

    mockFetchSequence([
      { path: '/rpc/control/api-keys', body: { openai: 'sk-test', anthropic: null, google: null } },
      { path: '/rpc/control/run-status', body: { status: 'completed' } },
    ]);

    await executeRunInContainer(
      {
        runId: 'r-1',
        workerId: 'w-1',
        controlRpcToken: 'tok',
        controlRpcBaseUrl: 'https://control.example.com',
      },
      {
        serviceName: 'test',
        logger: mockLogger,
        executeRun,
        runtimeConfig: {
          maxRunDurationMs: 60000,
        },
      },
    );

    // run-reset should NOT have been called
    const urls = fetchSpy.mock.calls.map((c: any) => c[0] as string);
    expect(urls.some((u: string) => u.includes('/rpc/control/run-reset'))).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Preserving run r-1 status completed'),
    );
  });

  it('resets run when fetchApiKeys fails', async () => {
    const { executeRunInContainer } = await import('../run-executor.js');

    fetchSpy.mockRejectedValue(new Error('Network error'));

    await expect(
      executeRunInContainer(
        {
          runId: 'r-1',
          workerId: 'w-1',
          controlRpcToken: 'tok',
          controlRpcBaseUrl: 'https://control.example.com',
        },
        {
          serviceName: 'test',
          logger: mockLogger,
          executeRun: vi.fn(),
        },
      ),
    ).rejects.toThrow('Network error');
  });
});
