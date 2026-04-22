import { ExecutorContainerTier1 } from "@/container-hosts/executor-host";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertObjectMatch,
} from "jsr:@std/assert";
import { assertSpyCallArgs, spy } from "jsr:@std/testing/mock";

function createMockCtxAndEnv() {
  const storage = new Map<string, unknown>();
  const ctx = {
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => {
        storage.set(key, value);
      },
      delete: async (key: string) => {
        storage.delete(key);
      },
    },
  };

  const env: Record<string, string> = {
    CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
  };

  return { ctx, env, storage };
}

let ctx: ReturnType<typeof createMockCtxAndEnv>["ctx"];
let env: ReturnType<typeof createMockCtxAndEnv>["env"];
let storage: ReturnType<typeof createMockCtxAndEnv>["storage"];

Deno.test(
  "ExecutorContainerTier1 - injects CONTROL_RPC_BASE_URL and executor tier into container env vars",
  () => {
    ({ ctx, env, storage } = createMockCtxAndEnv());
    const container = new ExecutorContainerTier1(ctx as any, env as any);
    assertEquals(container.envVars, {
      CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
      EXECUTOR_TIER: "1",
      MAX_CONCURRENT_RUNS: "4",
    });
  },
);

Deno.test(
  "ExecutorContainerTier1 - dispatchStart forwards the canonical control RPC payload and persists the control token",
  async () => {
    ({ ctx, env, storage } = createMockCtxAndEnv());
    const container = new ExecutorContainerTier1(ctx as any, env as any);

    let capturedRequest: Request | null = null;
    (container as any).container = {
      getTcpPort: (_port: number) => ({
        fetch: async (_url: string, request: Request) => {
          capturedRequest = request;
          return new Response("accepted", { status: 202 });
        },
      }),
    };

    const startAndWaitForPorts = spy(async (_port: number) => {});
    (container as any).startAndWaitForPorts = startAndWaitForPorts;

    const result = await container.dispatchStart({
      runId: "run-1",
      workerId: "worker-1",
      model: "gpt-5.2",
      executorContainerId: "tier1-warm-0",
    });

    assertEquals(result, {
      ok: true,
      status: 202,
      body: "accepted",
    });
    assertSpyCallArgs(startAndWaitForPorts, 0, [8080]);

    assertNotEquals(capturedRequest, null);
    const payload = await capturedRequest!.json() as Record<string, unknown>;
    assertEquals(payload.runId, "run-1");
    assertEquals(payload.workerId, "worker-1");
    assertEquals(payload.model, "gpt-5.2");
    assertEquals(payload.executorTier, 1);
    assertEquals(payload.executorContainerId, "tier1-warm-0");
    assertEquals(
      payload.controlRpcBaseUrl,
      "https://control-rpc.example.internal",
    );
    assertEquals(typeof payload.controlRpcToken, "string");

    const tokenMap = storage.get("proxyTokens") as Record<
      string,
      {
        runId: string;
        serviceId: string;
        capability: "control";
        executorTier: 1;
        executorContainerId: string;
        startedAt: number;
        lastHeartbeatAt: number;
      }
    >;
    assert(tokenMap !== undefined);
    assertEquals(Object.keys(tokenMap).length, 1);

    const tokenInfo = Object.values(tokenMap)[0];
    assert(tokenInfo !== undefined);
    assertObjectMatch(tokenInfo, {
      runId: "run-1",
      serviceId: "worker-1",
      capability: "control",
      executorTier: 1,
      executorContainerId: "tier1-warm-0",
    });
    assertEquals(typeof tokenInfo.startedAt, "number");
    assertEquals(typeof tokenInfo.lastHeartbeatAt, "number");

    for (const [token, info] of Object.entries(tokenMap)) {
      assertEquals(await container.verifyProxyToken(token), info);
    }
  },
);

Deno.test(
  "ExecutorContainerTier1 - accepts multiple runs up to configured capacity",
  async () => {
    ({ ctx, env, storage } = createMockCtxAndEnv());
    const container = new ExecutorContainerTier1(ctx as any, env as any);

    (container as any).container = {
      getTcpPort: (_port: number) => ({
        fetch: async (_url: string, _request: Request) =>
          new Response("accepted", { status: 202 }),
      }),
    };
    (container as any).startAndWaitForPorts = async (_port: number) => {};

    const first = await container.dispatchStart({
      runId: "run-1",
      workerId: "worker-1",
      executorContainerId: "tier1-warm-0",
    });
    const second = await container.dispatchStart({
      runId: "run-2",
      workerId: "worker-2",
      executorContainerId: "tier1-warm-0",
    });

    assertEquals(first.status, 202);
    assertEquals(second.status, 202);

    const tokenMap = storage.get("proxyTokens") as Record<string, unknown>;
    assertEquals(Object.keys(tokenMap).length, 2);
    assertEquals(await container.getLoad(), {
      tier: 1,
      containerId: "tier1-unknown",
      active: 2,
      capacity: 4,
    });
  },
);

Deno.test(
  "ExecutorContainerTier1 - rejects dispatchStart when token capacity is exhausted",
  async () => {
    ({ ctx, env, storage } = createMockCtxAndEnv());
    env = {
      ...env,
      EXECUTOR_TIER1_MAX_CONCURRENT_RUNS: "1",
    };
    const container = new ExecutorContainerTier1(ctx as any, env as any);

    (container as any).container = {
      getTcpPort: (_port: number) => ({
        fetch: async (_url: string, _request: Request) =>
          new Response("accepted", { status: 202 }),
      }),
    };
    (container as any).startAndWaitForPorts = async (_port: number) => {};

    const first = await container.dispatchStart({
      runId: "run-1",
      workerId: "worker-1",
      executorContainerId: "tier1-warm-0",
    });
    const second = await container.dispatchStart({
      runId: "run-2",
      workerId: "worker-2",
      executorContainerId: "tier1-warm-0",
    });

    assertEquals(first.status, 202);
    assertEquals(second.ok, false);
    assertEquals(second.status, 503);
    assertEquals(JSON.parse(second.body), {
      error: "At capacity",
      tier: 1,
      active: 1,
      capacity: 1,
    });

    const tokenMap = storage.get("proxyTokens") as Record<string, unknown>;
    assertEquals(Object.keys(tokenMap).length, 1);
  },
);

Deno.test(
  "ExecutorContainerTier1 - verifyProxyToken loads persisted tokens from storage and rejects unknown token",
  async () => {
    ({ ctx, env, storage } = createMockCtxAndEnv());
    storage.set("proxyTokens", {
      "persisted-token": {
        runId: "run-old",
        serviceId: "worker-old",
        capability: "control",
      },
    });

    const container = new ExecutorContainerTier1(ctx as any, env as any);

    assertEquals(await container.verifyProxyToken("persisted-token"), {
      runId: "run-old",
      serviceId: "worker-old",
      capability: "control",
    });
    assertEquals(await container.verifyProxyToken("unknown-token"), null);
  },
);
