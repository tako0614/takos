import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock workspace dependencies
vi.mock('@takoserver/common/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

vi.mock('@takoserver/agent-core/executor-utils', async () => {
  const actual = await vi.importActual<typeof import('@takoserver/agent-core/executor-utils')>('@takoserver/agent-core/executor-utils');
  return actual;
});

import {
  buildExecutorRuntimeConfig,
  hasControlRpcConfiguration,
  buildRuntimeStartPayload,
  createExecutorApp,
} from '../executor-config.js';
import { createConcurrencyGuard } from '@takoserver/agent-core/executor-utils';

// ---------------------------------------------------------------------------
// buildExecutorRuntimeConfig
// ---------------------------------------------------------------------------

describe('buildExecutorRuntimeConfig', () => {
  it('builds config from environment variables', () => {
    const config = buildExecutorRuntimeConfig({
      CONTROL_RPC_BASE_URL: 'https://control.example.com',
      ADMIN_DOMAIN: 'admin.takos.dev',
      TENANT_BASE_DOMAIN: 'app.takos.dev',
      MAX_AGENT_ITERATIONS: '50',
      AGENT_TEMPERATURE: '0.7',
      AGENT_RATE_LIMIT: '10',
      AGENT_ITERATION_TIMEOUT: '120000',
      AGENT_TOTAL_TIMEOUT: '3600000',
      TOOL_EXECUTION_TIMEOUT: '300000',
      LANGGRAPH_TIMEOUT: '86400000',
      SERPER_API_KEY: 'sk-serper',
    });

    expect(config.controlRpcBaseUrl).toBe('https://control.example.com');
    expect(config.executionEnv?.ADMIN_DOMAIN).toBe('admin.takos.dev');
    expect(config.executionEnv?.TENANT_BASE_DOMAIN).toBe('app.takos.dev');
    expect(config.executionEnv?.MAX_AGENT_ITERATIONS).toBe('50');
    expect(config.executionEnv?.AGENT_TEMPERATURE).toBe('0.7');
    expect(config.executionEnv?.AGENT_RATE_LIMIT).toBe('10');
    expect(config.executionEnv?.AGENT_ITERATION_TIMEOUT).toBe('120000');
    expect(config.executionEnv?.AGENT_TOTAL_TIMEOUT).toBe('3600000');
    expect(config.executionEnv?.TOOL_EXECUTION_TIMEOUT).toBe('300000');
    expect(config.executionEnv?.LANGGRAPH_TIMEOUT).toBe('86400000');
    expect(config.executionEnv?.SERPER_API_KEY).toBe('sk-serper');
    expect(config.maxRunDurationMs).toBe(3600000);
  });

  it('handles missing environment variables', () => {
    const config = buildExecutorRuntimeConfig({});

    expect(config.controlRpcBaseUrl).toBeUndefined();
    expect(config.executionEnv?.ADMIN_DOMAIN).toBeUndefined();
    expect(config.allowNoLlmFallback).toBe(false);
    expect(config.maxRunDurationMs).toBeUndefined();
  });

  it('parses allowNoLlmFallback from TAKOS_ALLOW_NO_LLM', () => {
    expect(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: 'true' }).allowNoLlmFallback).toBe(true);
    expect(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: '1' }).allowNoLlmFallback).toBe(true);
    expect(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: 'yes' }).allowNoLlmFallback).toBe(true);
    expect(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: 'on' }).allowNoLlmFallback).toBe(true);
    expect(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: 'false' }).allowNoLlmFallback).toBe(false);
    expect(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: '0' }).allowNoLlmFallback).toBe(false);
    expect(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: '' }).allowNoLlmFallback).toBe(false);
  });

  it('falls back to TAKOS_LOCAL_ALLOW_NO_LLM', () => {
    expect(buildExecutorRuntimeConfig({ TAKOS_LOCAL_ALLOW_NO_LLM: 'true' }).allowNoLlmFallback).toBe(true);
  });

  it('prefers TAKOS_ALLOW_NO_LLM over TAKOS_LOCAL_ALLOW_NO_LLM', () => {
    expect(buildExecutorRuntimeConfig({
      TAKOS_ALLOW_NO_LLM: 'false',
      TAKOS_LOCAL_ALLOW_NO_LLM: 'true',
    }).allowNoLlmFallback).toBe(false);
  });

  it('handles non-numeric AGENT_TOTAL_TIMEOUT', () => {
    const config = buildExecutorRuntimeConfig({ AGENT_TOTAL_TIMEOUT: 'not-a-number' });
    expect(config.maxRunDurationMs).toBeUndefined();
  });

  it('handles boolean env values with whitespace', () => {
    expect(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: ' TRUE ' }).allowNoLlmFallback).toBe(true);
    expect(buildExecutorRuntimeConfig({ TAKOS_ALLOW_NO_LLM: ' Yes ' }).allowNoLlmFallback).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasControlRpcConfiguration
// ---------------------------------------------------------------------------

describe('hasControlRpcConfiguration', () => {
  it('returns true when controlRpcBaseUrl is set', () => {
    expect(hasControlRpcConfiguration({ controlRpcBaseUrl: 'https://control.example.com' })).toBe(true);
  });

  it('returns false when controlRpcBaseUrl is undefined', () => {
    expect(hasControlRpcConfiguration({})).toBe(false);
  });

  it('returns false when controlRpcBaseUrl is empty string', () => {
    expect(hasControlRpcConfiguration({ controlRpcBaseUrl: '' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeStartPayload
// ---------------------------------------------------------------------------

describe('buildRuntimeStartPayload', () => {
  it('merges payload with runtime config base URL', () => {
    const payload = {
      runId: 'run-1',
      workerId: 'w-1',
      controlRpcToken: 'tok',
    };
    const config = { controlRpcBaseUrl: 'https://control.example.com' };

    const result = buildRuntimeStartPayload(payload, config);
    expect(result.controlRpcBaseUrl).toBe('https://control.example.com');
    expect(result.runId).toBe('run-1');
    expect(result.workerId).toBe('w-1');
    expect(result.controlRpcToken).toBe('tok');
  });

  it('attaches shutdown signal', () => {
    const controller = new AbortController();
    const payload = { runId: 'run-1', workerId: 'w-1' };
    const config = {};

    const result = buildRuntimeStartPayload(payload, config, controller.signal);
    expect(result.shutdownSignal).toBe(controller.signal);
  });

  it('preserves original payload fields', () => {
    const payload = {
      runId: 'run-1',
      workerId: 'w-1',
      model: 'gpt-4',
      leaseVersion: 3,
      controlRpcToken: 'tok',
      controlRpcBaseUrl: 'https://original.example.com',
    };
    const config = { controlRpcBaseUrl: 'https://override.example.com' };

    const result = buildRuntimeStartPayload(payload, config);
    // The runtime config base URL overrides the payload's
    expect(result.controlRpcBaseUrl).toBe('https://override.example.com');
    expect(result.model).toBe('gpt-4');
    expect(result.leaseVersion).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// createExecutorApp - HTTP endpoint tests
// ---------------------------------------------------------------------------

describe('createExecutorApp', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createApp(overrides: {
    executeRunInContainer?: (payload: any) => Promise<void>;
    concurrency?: ReturnType<typeof createConcurrencyGuard>;
    runtimeConfig?: ReturnType<typeof buildExecutorRuntimeConfig>;
  } = {}) {
    const config = overrides.runtimeConfig ?? buildExecutorRuntimeConfig({
      CONTROL_RPC_BASE_URL: 'https://control.example.com',
    });
    return createExecutorApp({
      executeRunInContainer: overrides.executeRunInContainer ?? vi.fn().mockResolvedValue(undefined),
      logger: mockLogger,
      concurrency: overrides.concurrency,
      runtimeConfig: config,
    });
  }

  describe('GET /health', () => {
    it('returns status ok with concurrency info', async () => {
      const concurrency = createConcurrencyGuard(5);
      const app = createApp({ concurrency });

      const req = new Request('http://localhost/health');
      const res = await app.fetch(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.runs.active).toBe(0);
      expect(body.runs.max).toBe(5);
      expect(body.runs.available).toBe(5);
    });

    it('reflects active runs after acquire', async () => {
      const concurrency = createConcurrencyGuard(3);
      concurrency.tryAcquire();
      concurrency.tryAcquire();
      const app = createApp({ concurrency });

      const req = new Request('http://localhost/health');
      const res = await app.fetch(req);
      const body = await res.json();
      expect(body.runs.active).toBe(2);
      expect(body.runs.available).toBe(1);
    });
  });

  describe('POST /start', () => {
    it('returns 400 for malformed JSON', async () => {
      const app = createApp();
      const req = new Request('http://localhost/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Malformed JSON body');
    });

    it('returns 400 for invalid payload', async () => {
      const app = createApp();
      const req = new Request('http://localhost/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Missing required field');
    });

    it('returns 503 when at capacity', async () => {
      const concurrency = createConcurrencyGuard(1);
      concurrency.tryAcquire(); // fill capacity
      const app = createApp({ concurrency });

      const req = new Request('http://localhost/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-1',
          workerId: 'w-1',
          controlRpcToken: 'tok',
        }),
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('At capacity');
    });

    it('returns 503 when CONTROL_RPC_BASE_URL is not configured', async () => {
      const config = buildExecutorRuntimeConfig({});
      const app = createApp({ runtimeConfig: config });

      const req = new Request('http://localhost/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-1',
          workerId: 'w-1',
          controlRpcToken: 'tok',
        }),
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe('CONTROL_RPC_BASE_URL not configured');
    });

    it('returns 202 for valid payload', async () => {
      const executeRunInContainer = vi.fn().mockResolvedValue(undefined);
      const app = createApp({ executeRunInContainer });

      const req = new Request('http://localhost/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-1',
          workerId: 'w-1',
          controlRpcToken: 'tok',
        }),
      });
      const res = await app.fetch(req);
      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.status).toBe('accepted');
      expect(body.runId).toBe('run-1');
    });

    it('releases concurrency slot after executeRunInContainer completes', async () => {
      let resolveRun: () => void;
      const runPromise = new Promise<void>((resolve) => { resolveRun = resolve; });
      const executeRunInContainer = vi.fn().mockReturnValue(runPromise);
      const concurrency = createConcurrencyGuard(2);
      const app = createApp({ executeRunInContainer, concurrency });

      const req = new Request('http://localhost/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-1',
          workerId: 'w-1',
          controlRpcToken: 'tok',
        }),
      });
      await app.fetch(req);

      expect(concurrency.activeRuns).toBe(1);

      resolveRun!();
      // Allow microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(concurrency.activeRuns).toBe(0);
    });

    it('releases concurrency slot when executeRunInContainer throws', async () => {
      const executeRunInContainer = vi.fn().mockRejectedValue(new Error('boom'));
      const concurrency = createConcurrencyGuard(2);
      const app = createApp({ executeRunInContainer, concurrency });

      const req = new Request('http://localhost/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-1',
          workerId: 'w-1',
          controlRpcToken: 'tok',
        }),
      });
      await app.fetch(req);

      // Allow microtask to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(concurrency.activeRuns).toBe(0);
    });

    it('logs error when executeRunInContainer throws', async () => {
      const executeRunInContainer = vi.fn().mockRejectedValue(new Error('agent-crash'));
      const app = createApp({ executeRunInContainer });

      const req = new Request('http://localhost/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: 'run-1',
          workerId: 'w-1',
          controlRpcToken: 'tok',
        }),
      });
      await app.fetch(req);

      // Allow the fire-and-forget promise to settle
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled error for run run-1'),
        expect.any(Object),
      );
    });
  });
});
