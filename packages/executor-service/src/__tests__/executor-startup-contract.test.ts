import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildExecutorRuntimeConfig,
  buildRuntimeStartPayload,
  createExecutorApp,
  hasControlRpcConfiguration,
} from '../executor-app.js';

const ORIGINAL_ENV = {
  CONTROL_RPC_BASE_URL: process.env.CONTROL_RPC_BASE_URL,
  PROXY_BASE_URL: process.env.PROXY_BASE_URL,
};

function restoreEnv() {
  if (ORIGINAL_ENV.CONTROL_RPC_BASE_URL === undefined) {
    delete process.env.CONTROL_RPC_BASE_URL;
  } else {
    process.env.CONTROL_RPC_BASE_URL = ORIGINAL_ENV.CONTROL_RPC_BASE_URL;
  }

  if (ORIGINAL_ENV.PROXY_BASE_URL === undefined) {
    delete process.env.PROXY_BASE_URL;
  } else {
    process.env.PROXY_BASE_URL = ORIGINAL_ENV.PROXY_BASE_URL;
  }
}

afterEach(() => {
  restoreEnv();
  vi.restoreAllMocks();
});

describe('executor startup control RPC contract', () => {
  it('treats CONTROL_RPC_BASE_URL as the canonical startup requirement', () => {
    expect(hasControlRpcConfiguration(buildExecutorRuntimeConfig({
      CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
    }))).toBe(true);

    expect(hasControlRpcConfiguration(buildExecutorRuntimeConfig({
      PROXY_BASE_URL: 'https://executor-proxy.example.internal',
    }))).toBe(false);
  });

  it('builds runtime payloads from CONTROL_RPC_BASE_URL without proxy fallback', () => {
    const payload = buildRuntimeStartPayload({
      runId: 'run-1',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'https://caller-supplied.example.internal',
    }, buildExecutorRuntimeConfig({
      CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
      PROXY_BASE_URL: 'https://executor-proxy.example.internal',
    }));

    expect(payload.controlRpcBaseUrl).toBe('https://control-rpc.example.internal');
    expect(payload).not.toHaveProperty('proxyBaseUrl');

    const payloadWithoutControlRpc = buildRuntimeStartPayload({
      runId: 'run-2',
      workerId: 'worker-2',
      controlRpcToken: 'control-token',
    }, buildExecutorRuntimeConfig({
      PROXY_BASE_URL: 'https://executor-proxy.example.internal',
    }));

    expect(payloadWithoutControlRpc.controlRpcBaseUrl).toBeUndefined();
    expect(payloadWithoutControlRpc).not.toHaveProperty('proxyBaseUrl');
  });

  it('rejects /start when only PROXY_BASE_URL is configured', async () => {
    delete process.env.CONTROL_RPC_BASE_URL;
    process.env.PROXY_BASE_URL = 'https://executor-proxy.example.internal';

    const executeRunInContainer = vi.fn().mockResolvedValue(undefined);
    const app = createExecutorApp({
      executeRunInContainer,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      runtimeConfig: buildExecutorRuntimeConfig({
        PROXY_BASE_URL: 'https://executor-proxy.example.internal',
      }),
    });

    const response = await app.fetch(new Request('http://localhost/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-1',
        workerId: 'worker-1',
        controlRpcToken: 'control-token',
      }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'CONTROL_RPC_BASE_URL not configured' });
    expect(executeRunInContainer).not.toHaveBeenCalled();
  });

  it('accepts /start when CONTROL_RPC_BASE_URL is configured and forwards it to execution', async () => {
    process.env.CONTROL_RPC_BASE_URL = 'https://control-rpc.example.internal';
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
        CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
      }),
    });

    const response = await app.fetch(new Request('http://localhost/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: 'run-1',
        workerId: 'worker-1',
        controlRpcToken: 'control-token',
      }),
    }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ status: 'accepted', runId: 'run-1' });
    expect(executeRunInContainer).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      workerId: 'worker-1',
      controlRpcToken: 'control-token',
      controlRpcBaseUrl: 'https://control-rpc.example.internal',
    }));
  });
});
