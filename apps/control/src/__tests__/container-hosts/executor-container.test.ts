import { TakosAgentExecutorContainer } from '@/container-hosts/executor-host';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

function createMockCtxAndEnv() {
  const storage = new Map<string, unknown>();
  const ctx = {
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
    },
  };

  const env = {
    CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
  };

  return { ctx, env, storage };
}


  let ctx: ReturnType<typeof createMockCtxAndEnv>['ctx'];
  let env: ReturnType<typeof createMockCtxAndEnv>['env'];
  let storage: ReturnType<typeof createMockCtxAndEnv>['storage'];
  Deno.test('TakosAgentExecutorContainer - injects CONTROL_RPC_BASE_URL into container env vars', () => {
  ({ ctx, env, storage } = createMockCtxAndEnv());
  const container = new TakosAgentExecutorContainer(ctx as any, env as any);
    assertEquals(container.envVars, {
      CONTROL_RPC_BASE_URL: 'https://control-rpc.example.internal',
    });
})
  Deno.test('TakosAgentExecutorContainer - dispatchStart forwards the canonical control RPC payload and persists the control token', async () => {
  ({ ctx, env, storage } = createMockCtxAndEnv());
  const container = new TakosAgentExecutorContainer(ctx as any, env as any);

    let capturedRequest: Request | null = null;
    (container as any).container = {
      getTcpPort: (_port: number) => ({
        fetch: async (_url: string, request: Request) => {
          capturedRequest = request;
          return new Response('accepted', { status: 202 });
        },
      }),
    };

    const startAndWaitForPorts = async () => {};
    (container as any).startAndWaitForPorts = startAndWaitForPorts;

    const result = await container.dispatchStart({
      runId: 'run-1',
      workerId: 'worker-1',
      model: 'gpt-5.2',
    });

    assertEquals(result, {
      ok: true,
      status: 202,
      body: 'accepted',
    });
    assertSpyCallArgs(startAndWaitForPorts, 0, [8080]);

    assertNotEquals(capturedRequest, null);
    const payload = await capturedRequest!.json() as Record<string, unknown>;
    assertEquals(payload.runId, 'run-1');
    assertEquals(payload.workerId, 'worker-1');
    assertEquals(payload.model, 'gpt-5.2');
    assertEquals(payload.controlRpcBaseUrl, 'https://control-rpc.example.internal');
    assertEquals(typeof payload.controlRpcToken, 'string');

    const tokenMap = storage.get('proxyTokens') as Record<string, {
      runId: string;
      serviceId: string;
      capability: 'bindings' | 'control';
    }>;
    assert(tokenMap !== undefined);
    assertEquals(Object.keys(tokenMap).length, 1);

    const tokenInfos = Object.values(tokenMap);
    assert(tokenInfos.some((item: any) => JSON.stringify(item) === JSON.stringify({ runId: 'run-1', serviceId: 'worker-1', capability: 'control' })));

    for (const [token, info] of Object.entries(tokenMap)) {
      await assertEquals(await container.verifyProxyToken(token), info);
    }
})
  Deno.test('TakosAgentExecutorContainer - verifyProxyToken loads persisted tokens from storage and rejects unknown token', async () => {
  ({ ctx, env, storage } = createMockCtxAndEnv());
  storage.set('proxyTokens', {
      'persisted-token': { runId: 'run-old', serviceId: 'worker-old', capability: 'bindings' },
    });

    const container = new TakosAgentExecutorContainer(ctx as any, env as any);

    await assertEquals(await container.verifyProxyToken('persisted-token'), {
      runId: 'run-old',
      serviceId: 'worker-old',
      capability: 'bindings',
    });
    await assertEquals(await container.verifyProxyToken('unknown-token'), null);
})