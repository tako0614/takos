import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildExecutorRuntimeConfig,
  buildRuntimeStartPayload,
  createExecutorApp,
  hasControlRpcConfiguration,
} from '../executor-app.js';

const ORIGINAL_ENV = {
  PROXY_BASE_URL: process.env.PROXY_BASE_URL,
  CONTROL_RPC_BASE_URL: process.env.CONTROL_RPC_BASE_URL,
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe.sequential('executor startup assumptions', () => {
  it('treats CONTROL_RPC_BASE_URL as sufficient canonical startup configuration', () => {
    expect(hasControlRpcConfiguration(buildExecutorRuntimeConfig({ CONTROL_RPC_BASE_URL: 'http://control-rpc.internal' }))).toBe(true);
    expect(hasControlRpcConfiguration(buildExecutorRuntimeConfig({ PROXY_BASE_URL: 'http://proxy.internal' }))).toBe(false);
    expect(hasControlRpcConfiguration(buildExecutorRuntimeConfig({}))).toBe(false);
  });

  it('builds start payloads with canonical Control RPC routing', () => {
    expect(buildRuntimeStartPayload({
      runId: 'run-1',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
    }, buildExecutorRuntimeConfig({
      CONTROL_RPC_BASE_URL: 'http://control-rpc.internal',
    }))).toEqual({
      runId: 'run-1',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'http://control-rpc.internal',
      shutdownSignal: undefined,
    });

    expect(buildRuntimeStartPayload({
      runId: 'run-2',
      workerId: 'worker-2',
      controlRpcToken: 'control-token',
    }, buildExecutorRuntimeConfig({
      PROXY_BASE_URL: 'http://proxy.internal',
      CONTROL_RPC_BASE_URL: 'http://control-rpc.internal',
    }))).toEqual({
      runId: 'run-2',
      workerId: 'worker-2',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'http://control-rpc.internal',
      shutdownSignal: undefined,
    });

    expect(buildRuntimeStartPayload({
      runId: 'run-3',
      workerId: 'worker-3',
      controlRpcToken: 'control-token',
    }, buildExecutorRuntimeConfig({
      PROXY_BASE_URL: 'http://proxy.internal',
    }))).toEqual({
      runId: 'run-3',
      workerId: 'worker-3',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: undefined,
      shutdownSignal: undefined,
    });
  });

  it('rejects /start when neither CONTROL_RPC_BASE_URL nor PROXY_BASE_URL is configured', async () => {
    delete process.env.CONTROL_RPC_BASE_URL;
    delete process.env.PROXY_BASE_URL;

    const executeRunInContainer = vi.fn().mockResolvedValue(undefined);
    const app = createExecutorApp({
      executeRunInContainer,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      runtimeConfig: buildExecutorRuntimeConfig({}),
    });

    const response = await app.fetch(new Request('http://localhost/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-1',
        workerId: 'worker-1',
        controlRpcToken: 'control-token',
      }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'CONTROL_RPC_BASE_URL not configured',
    });
    expect(executeRunInContainer).not.toHaveBeenCalled();
  });

  it('accepts /start with CONTROL_RPC_BASE_URL only and keeps the payload proxyless', async () => {
    process.env.CONTROL_RPC_BASE_URL = 'http://control-rpc.internal';
    delete process.env.PROXY_BASE_URL;

    const executeRunInContainer = vi.fn().mockResolvedValue(undefined);
    const app = createExecutorApp({
      executeRunInContainer,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      runtimeConfig: buildExecutorRuntimeConfig({
        CONTROL_RPC_BASE_URL: 'http://control-rpc.internal',
      }),
    });

    const response = await app.fetch(new Request('http://localhost/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-2',
        workerId: 'worker-2',
        controlRpcToken: 'control-token',
      }),
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: 'accepted',
      runId: 'run-2',
    });
    expect(executeRunInContainer).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-2',
      workerId: 'worker-2',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'http://control-rpc.internal',
    }));
  });

  it('rejects /start when only PROXY_BASE_URL is configured', async () => {
    process.env.PROXY_BASE_URL = 'http://proxy.internal';
    delete process.env.CONTROL_RPC_BASE_URL;

    const executeRunInContainer = vi.fn().mockResolvedValue(undefined);
    const app = createExecutorApp({
      executeRunInContainer,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      runtimeConfig: buildExecutorRuntimeConfig({
        PROXY_BASE_URL: 'http://proxy.internal',
      }),
    });

    const response = await app.fetch(new Request('http://localhost/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-3',
        workerId: 'worker-3',
        controlRpcToken: 'control-token',
      }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: 'CONTROL_RPC_BASE_URL not configured',
    });
    expect(executeRunInContainer).not.toHaveBeenCalled();
  });
});
