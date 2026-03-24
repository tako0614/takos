import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TakosAgentExecutorContainer } from '@/container-hosts/executor-host';

function createMockCtxAndEnv() {
  const storage = new Map<string, unknown>();
  const ctx = {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value);
      }),
    },
  };

  const env = {
    CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
  };

  return { ctx, env, storage };
}

describe('TakosAgentExecutorContainer', () => {
  let ctx: ReturnType<typeof createMockCtxAndEnv>['ctx'];
  let env: ReturnType<typeof createMockCtxAndEnv>['env'];
  let storage: ReturnType<typeof createMockCtxAndEnv>['storage'];

  beforeEach(() => {
    ({ ctx, env, storage } = createMockCtxAndEnv());
  });

  it('injects CONTROL_RPC_BASE_URL into container env vars', () => {
    const container = new TakosAgentExecutorContainer(ctx as any, env as any);
    expect(container.envVars).toEqual({
      CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
    });
  });

  it('dispatchStart forwards the canonical control RPC payload and persists the control token', async () => {
    const container = new TakosAgentExecutorContainer(ctx as any, env as any);

    let capturedRequest: Request | null = null;
    (container as any).container = {
      getTcpPort: vi.fn((_port: number) => ({
        fetch: vi.fn(async (_url: string, request: Request) => {
          capturedRequest = request;
          return new Response('accepted', { status: 202 });
        }),
      })),
    };

    const startAndWaitForPorts = vi.fn(async () => {});
    (container as any).startAndWaitForPorts = startAndWaitForPorts;

    const result = await container.dispatchStart({
      runId: 'run-1',
      workerId: 'worker-1',
      model: 'gpt-5.2',
    });

    expect(result).toEqual({
      ok: true,
      status: 202,
      body: 'accepted',
    });
    expect(startAndWaitForPorts).toHaveBeenCalledWith(8080);

    expect(capturedRequest).not.toBeNull();
    const payload = await capturedRequest!.json() as Record<string, unknown>;
    expect(payload.runId).toBe('run-1');
    expect(payload.workerId).toBe('worker-1');
    expect(payload.model).toBe('gpt-5.2');
    expect(payload.controlRpcBaseUrl).toBe('https://control-rpc.example.internal');
    expect(typeof payload.controlRpcToken).toBe('string');

    const tokenMap = storage.get('proxyTokens') as Record<string, {
      runId: string;
      serviceId: string;
      capability: 'bindings' | 'control';
    }>;
    expect(tokenMap).toBeDefined();
    expect(Object.keys(tokenMap)).toHaveLength(1);

    const tokenInfos = Object.values(tokenMap);
    expect(tokenInfos).toContainEqual({ runId: 'run-1', serviceId: 'worker-1', capability: 'control' });

    for (const [token, info] of Object.entries(tokenMap)) {
      await expect(container.verifyProxyToken(token)).resolves.toEqual(info);
    }
  });

  it('verifyProxyToken loads persisted tokens from storage and rejects unknown token', async () => {
    storage.set('proxyTokens', {
      'persisted-token': { runId: 'run-old', serviceId: 'worker-old', capability: 'bindings' },
    });

    const container = new TakosAgentExecutorContainer(ctx as any, env as any);

    await expect(container.verifyProxyToken('persisted-token')).resolves.toEqual({
      runId: 'run-old',
      serviceId: 'worker-old',
      capability: 'bindings',
    });
    await expect(container.verifyProxyToken('unknown-token')).resolves.toBeNull();
  });
});
