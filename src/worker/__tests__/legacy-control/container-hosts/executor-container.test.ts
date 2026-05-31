import { ExecutorContainerTier1 } from "@/container-hosts/executor-host";
import type {
  AgentExecutorEnv,
  ProxyTokenInfo,
} from "@/container-hosts/executor-utils";
import type {
  HostContainerInternals,
} from "../../../runtime/container-hosts/container-runtime.ts";
import type {
  DurableObjectStateBinding,
  SqlDatabaseBinding,
} from "../../../shared/types/bindings.ts";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertObjectMatch,
} from "@std/assert";
import { assertSpyCallArgs, spy } from "@std/testing/mock";

// Minimal AgentExecutorEnv shape with just the fields the tests exercise.
// The unused namespace/service-binding fields are stubbed to throw if invoked.
type MinimalEnv = AgentExecutorEnv;

const failingContainerNamespace =
  (): AgentExecutorEnv["EXECUTOR_CONTAINER"] => ({
    idFromName: () => ({}),
    get: () => {
      throw new Error("EXECUTOR_CONTAINER.get should not be called in test");
    },
    getByName: () => {
      throw new Error(
        "EXECUTOR_CONTAINER.getByName should not be called in test",
      );
    },
  });

const failingFetchBinding = (label: string) => ({
  fetch: () => {
    throw new Error(`${label}.fetch should not be called in test`);
  },
});

const failingDbBinding = (): SqlDatabaseBinding => {
  const fail = (m: string) => () => {
    throw new Error(`DB.${m} should not be called in test`);
  };
  return {
    prepare: fail("prepare"),
    batch: () => Promise.reject(new Error("DB.batch should not be called")),
    exec: () => Promise.reject(new Error("DB.exec should not be called")),
    withSession: fail("withSession"),
    dump: () => Promise.reject(new Error("DB.dump should not be called")),
  };
};

function createMockCtxAndEnv() {
  const storage = new Map<string, unknown>();
  const ctx: DurableObjectStateBinding<Record<string, never>> = {
    storage: {
      get: <T>(key: string): Promise<T | undefined> =>
        Promise.resolve(storage.get(key) as T | undefined),
      put: (key: string, value: unknown) => {
        storage.set(key, value);
        return Promise.resolve();
      },
      delete: (key: string) => {
        const had = storage.delete(key);
        return Promise.resolve(had);
      },
      list: () => Promise.resolve(new Map()),
      getAlarm: () => Promise.resolve(null),
      setAlarm: () => Promise.resolve(),
      deleteAlarm: () => Promise.resolve(),
    },
    blockConcurrencyWhile: <R>(cb: () => Promise<R>) => cb(),
    getWebSockets: () => [],
    getTags: () => [],
    acceptWebSocket: () => {},
  };

  const env: MinimalEnv = {
    DB: failingDbBinding(),
    EXECUTOR_CONTAINER: failingContainerNamespace(),
    TAKOS_WORKER: failingFetchBinding("TAKOS_WORKER"),
    EXECUTOR_PROXY_SECRET: "test-secret",
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
  };

  return { ctx, env, storage };
}

let ctx: ReturnType<typeof createMockCtxAndEnv>["ctx"];
let env: ReturnType<typeof createMockCtxAndEnv>["env"];
let storage: ReturnType<typeof createMockCtxAndEnv>["storage"];

// Mutable test-only view onto the executor container's container/startAndWaitForPorts
// internals. These are inherited from LocalHostContainerRuntime in test
// environments and are reassigned in tests to inject mock behavior.
type ContainerInternals = HostContainerInternals & {
  startAndWaitForPorts(ports?: number | number[]): Promise<void>;
};

Deno.test(
  "ExecutorContainerTier1 - injects TAKOS_AGENT_CONTROL_RPC_BASE_URL and executor tier into container env vars",
  () => {
    ({ ctx, env, storage } = createMockCtxAndEnv());
    const container = new ExecutorContainerTier1(ctx, env);
    assertEquals(container.envVars, {
      TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
      EXECUTOR_TIER: "1",
      MAX_CONCURRENT_RUNS: "4",
    });
  },
);

Deno.test(
  "ExecutorContainerTier1 - dispatchStart forwards the canonical control RPC payload and persists the control token",
  async () => {
    ({ ctx, env, storage } = createMockCtxAndEnv());
    const container = new ExecutorContainerTier1(ctx, env);
    const internals = container as ContainerInternals;

    let capturedRequest: Request | null = null;
    internals.container = {
      getTcpPort: (_port: number) => ({
        fetch: async (_url: string, request: Request) => {
          capturedRequest = request;
          return new Response("accepted", { status: 202 });
        },
      }),
    };

    const startAndWaitForPorts = spy((_port: number) => Promise.resolve());
    internals.startAndWaitForPorts = startAndWaitForPorts;

    const result = await container.dispatchStart({
      runId: "run-1",
      serviceId: "worker-1",
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
      ProxyTokenInfo
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
    const container = new ExecutorContainerTier1(ctx, env);
    const internals = container as ContainerInternals;

    internals.container = {
      getTcpPort: (_port: number) => ({
        fetch: (_url: string, _request: Request) =>
          Promise.resolve(new Response("accepted", { status: 202 })),
      }),
    };
    internals.startAndWaitForPorts = (_port?: number | number[]) =>
      Promise.resolve();

    const first = await container.dispatchStart({
      runId: "run-1",
      serviceId: "worker-1",
      workerId: "worker-1",
      executorContainerId: "tier1-warm-0",
    });
    const second = await container.dispatchStart({
      runId: "run-2",
      serviceId: "worker-2",
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
    const container = new ExecutorContainerTier1(ctx, env);
    const internals = container as ContainerInternals;

    internals.container = {
      getTcpPort: (_port: number) => ({
        fetch: (_url: string, _request: Request) =>
          Promise.resolve(new Response("accepted", { status: 202 })),
      }),
    };
    internals.startAndWaitForPorts = (_port?: number | number[]) =>
      Promise.resolve();

    const first = await container.dispatchStart({
      runId: "run-1",
      serviceId: "worker-1",
      workerId: "worker-1",
      executorContainerId: "tier1-warm-0",
    });
    const second = await container.dispatchStart({
      runId: "run-2",
      serviceId: "worker-2",
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

    const container = new ExecutorContainerTier1(ctx, env);

    assertEquals(await container.verifyProxyToken("persisted-token"), {
      runId: "run-old",
      serviceId: "worker-old",
      capability: "control",
    });
    assertEquals(await container.verifyProxyToken("unknown-token"), null);
  },
);
