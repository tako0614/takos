import { assertEquals } from "jsr:@std/assert";
import executorHost from "@/container-hosts/executor-host";

type ProxyCapability = "control";

type ProxyTokenInfo = {
  runId: string;
  serviceId: string;
  capability: ProxyCapability;
};

type PoolLoad = {
  tier: 1 | 2 | 3;
  containerId: string;
  active: number;
  capacity: number;
};

type MockContainerStub = {
  dispatchStart(body: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    body: string;
  }>;
  getLoad(): Promise<PoolLoad>;
  warm(): Promise<PoolLoad>;
  verifyProxyToken(token: string): Promise<ProxyTokenInfo | null>;
  touchProxyToken(token: string): Promise<void>;
  revokeProxyToken(token: string): Promise<void>;
  revokeProxyTokens(): Promise<void>;
};

function createExecutorContainerNamespace(tier: 1 | 2 | 3) {
  const dispatchBodies: Array<{
    containerId: string;
    body: Record<string, unknown>;
  }> = [];
  const loads = new Map<string, { active: number; capacity: number }>();
  let lastContainerId: string | null = null;
  let lastToken: string | null = null;
  const touchedTokens: string[] = [];
  const revokedTokens: string[] = [];
  let revokeAllCount = 0;
  let warmCount = 0;

  const namespace = {
    getByName(containerId: string): MockContainerStub {
      lastContainerId = containerId;
      return {
        async dispatchStart(body) {
          dispatchBodies.push({ containerId, body });
          return {
            ok: true,
            status: 202,
            body: JSON.stringify({
              accepted: true,
              runId: body.runId,
              tier: body.executorTier ?? body.tier ?? tier,
              executorContainerId: body.executorContainerId,
            }),
          };
        },
        async getLoad() {
          const load = loads.get(containerId) ?? {
            active: 0,
            capacity: tier === 3 ? 32 : tier === 1 ? 4 : 1,
          };
          return { tier, containerId, ...load };
        },
        async warm() {
          warmCount++;
          return await this.getLoad();
        },
        async verifyProxyToken(token) {
          lastToken = token;
          if (token === "control-token") {
            return {
              runId: "run-1",
              serviceId: "svc-1",
              capability: "control",
            };
          }
          return null;
        },
        async touchProxyToken(token) {
          touchedTokens.push(token);
        },
        async revokeProxyToken(token) {
          revokedTokens.push(token);
        },
        async revokeProxyTokens() {
          revokeAllCount++;
        },
      };
    },
  };

  return {
    namespace,
    dispatchBodies,
    setLoad: (
      containerId: string,
      load: { active: number; capacity: number },
    ) => loads.set(containerId, load),
    getLastContainerId: () => lastContainerId,
    getLastToken: () => lastToken,
    getTouchedTokens: () => touchedTokens,
    getRevokedTokens: () => revokedTokens,
    getRevokeAllCount: () => revokeAllCount,
    getWarmCount: () => warmCount,
  };
}

function createEnv(overrides: Partial<Record<string, unknown>> = {}) {
  const tier1 = createExecutorContainerNamespace(1);
  const tier2 = createExecutorContainerNamespace(2);
  const tier3 = createExecutorContainerNamespace(3);
  const controlRequests: Request[] = [];

  const env = {
    EXECUTOR_CONTAINER: tier1.namespace,
    EXECUTOR_CONTAINER_TIER2: tier2.namespace,
    EXECUTOR_CONTAINER_TIER3: tier3.namespace,
    CONTROL_RPC_BASE_URL: "https://executor-host.example",
    EXECUTOR_PROXY_SECRET: "executor-secret",
    TAKOS_CONTROL: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request
          ? input
          : new Request(input, init);
        controlRequests.push(request);
        return new Response(
          JSON.stringify({
            ok: true,
            path: new URL(request.url).pathname,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
    ...overrides,
  };

  return {
    env,
    tier1,
    tier2,
    tier3,
    controlRequests,
  };
}

function createProxyRequest(
  path: string,
  {
    bearerToken,
    body,
    executorContainerId,
    executorTier,
    method = "POST",
    runId = "run-1",
  }: {
    bearerToken?: string;
    body?: Record<string, unknown>;
    executorContainerId?: string;
    executorTier?: 1 | 2 | 3;
    method?: string;
    runId?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (runId) headers.set("X-Takos-Run-Id", runId);
  if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
  if (executorTier) headers.set("X-Takos-Executor-Tier", String(executorTier));
  if (executorContainerId) {
    headers.set("X-Takos-Executor-Container-Id", executorContainerId);
  }
  if (method !== "GET") headers.set("Content-Type", "application/json");
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
}

Deno.test("executorHost fetch returns health status", async () => {
  const { env } = createEnv();
  const response = await executorHost.fetch(
    new Request("http://localhost/health"),
    env as never,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ok",
    service: "takos-executor-host",
  });
});

Deno.test("executorHost dispatch rejects missing runId", async () => {
  const { env } = createEnv();
  const response = await executorHost.fetch(
    new Request("http://localhost/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerId: "svc-1" }),
    }),
    env as never,
  );

  assertEquals(response.status, 400);
});

Deno.test("executorHost dispatch without explicit tier uses the warm tier1 pool", async () => {
  const { env, tier1, tier2, tier3 } = createEnv({
    EXECUTOR_TIER3_POOL_SIZE: "2",
  });
  const response = await executorHost.fetch(
    new Request("http://localhost/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-1", serviceId: "svc-1" }),
    }),
    env as never,
  );

  assertEquals(response.status, 202);
  assertEquals(await response.json(), {
    accepted: true,
    runId: "run-1",
    tier: 1,
    executorContainerId: "tier1-warm-0",
  });
  assertEquals(tier1.dispatchBodies.length, 1);
  assertEquals(tier1.dispatchBodies[0].containerId, "tier1-warm-0");
  assertEquals(tier1.dispatchBodies[0].body.executorTier, 1);
  assertEquals(
    tier1.dispatchBodies[0].body.executorContainerId,
    "tier1-warm-0",
  );
  assertEquals(tier2.dispatchBodies.length, 0);
  assertEquals(tier3.dispatchBodies.length, 0);
});

Deno.test("executorHost dispatch includes pool revision in warm slot ids", async () => {
  const { env, tier1 } = createEnv({
    EXECUTOR_POOL_REVISION: "Tools 128!",
  });
  const response = await executorHost.fetch(
    new Request("http://localhost/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-1", serviceId: "svc-1" }),
    }),
    env as never,
  );

  assertEquals(response.status, 202);
  assertEquals(await response.json(), {
    accepted: true,
    runId: "run-1",
    tier: 1,
    executorContainerId: "tier1-warm-0-tools-128",
  });
  assertEquals(tier1.dispatchBodies[0].containerId, "tier1-warm-0-tools-128");
});

Deno.test("executorHost dispatch spills over to tier3 when the warm tier1 pool is full", async () => {
  const { env, tier1, tier3 } = createEnv({
    EXECUTOR_TIER3_POOL_SIZE: "2",
  });
  tier1.setLoad("tier1-warm-0", { active: 4, capacity: 4 });

  const response = await executorHost.fetch(
    new Request("http://localhost/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-3", serviceId: "svc-1" }),
    }),
    env as never,
  );

  assertEquals(response.status, 202);
  assertEquals(await response.json(), {
    accepted: true,
    runId: "run-3",
    tier: 3,
    executorContainerId: "tier3-scale-0",
  });
  assertEquals(tier3.dispatchBodies.length, 1);
  assertEquals(tier3.dispatchBodies[0].containerId, "tier3-scale-0");
  assertEquals(tier3.dispatchBodies[0].body.executorTier, 3);
});

Deno.test("executorHost dispatch returns 503 when all configured pool slots are full", async () => {
  const { env, tier1, tier3 } = createEnv({
    EXECUTOR_TIER3_POOL_SIZE: "2",
  });
  tier1.setLoad("tier1-warm-0", { active: 4, capacity: 4 });
  tier3.setLoad("tier3-scale-0", { active: 32, capacity: 32 });
  tier3.setLoad("tier3-scale-1", { active: 32, capacity: 32 });

  const response = await executorHost.fetch(
    new Request("http://localhost/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-4", serviceId: "svc-1" }),
    }),
    env as never,
  );

  assertEquals(response.status, 503);
  assertEquals(tier1.dispatchBodies.length, 0);
  assertEquals(tier3.dispatchBodies.length, 0);
});

Deno.test("executorHost dispatch forwards to tier-specific namespace", async () => {
  const { env, tier1, tier2 } = createEnv();
  const response = await executorHost.fetch(
    new Request("http://localhost/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-2", serviceId: "svc-1", tier: 2 }),
    }),
    env as never,
  );

  assertEquals(response.status, 202);
  assertEquals(await response.json(), {
    accepted: true,
    runId: "run-2",
    tier: 2,
    executorContainerId: "run-2",
  });
  assertEquals(tier1.dispatchBodies.length, 0);
  assertEquals(tier2.dispatchBodies.length, 1);
  assertEquals(tier2.getLastContainerId(), "run-2");
});

Deno.test("executorHost reports executor pool load", async () => {
  const { env, tier1, tier3 } = createEnv({
    EXECUTOR_TIER3_POOL_SIZE: "2",
  });
  tier1.setLoad("tier1-warm-0", { active: 2, capacity: 4 });
  tier3.setLoad("tier3-scale-1", { active: 5, capacity: 32 });

  const response = await executorHost.fetch(
    new Request("http://localhost/internal/executor-pool"),
    env as never,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    status: "ok",
    service: "takos-executor-host",
    pools: [
      { tier: 1, containerId: "tier1-warm-0", active: 2, capacity: 4 },
      { tier: 3, containerId: "tier3-scale-0", active: 0, capacity: 32 },
      { tier: 3, containerId: "tier3-scale-1", active: 5, capacity: 32 },
    ],
  });
});

Deno.test("executorHost proxy rejects missing auth headers", async () => {
  const { env } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/rpc/control/api-keys", {
      bearerToken: undefined,
      body: { runId: "run-1", serviceId: "svc-1" },
    }),
    env as never,
  );

  assertEquals(response.status, 401);
});

Deno.test("executorHost rejects removed binding proxy paths", async () => {
  const { env, controlRequests, tier1 } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/proxy/runtime/fetch", {
      bearerToken: "control-token",
      body: {
        runId: "run-1",
        serviceId: "svc-1",
        url: "https://runtime-host/status",
        method: "GET",
      },
    }),
    env as never,
  );

  assertEquals(response.status, 401);
  assertEquals(controlRequests.length, 0);
  assertEquals(tier1.getLastToken(), "control-token");
});

Deno.test("executorHost control RPC rejects invalid proxy tokens", async () => {
  const { env, controlRequests } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/rpc/control/api-keys", {
      bearerToken: "invalid-token",
      body: { runId: "run-1", serviceId: "svc-1" },
    }),
    env as never,
  );

  assertEquals(response.status, 401);
  assertEquals(controlRequests.length, 0);
});

Deno.test("executorHost control RPC forwards to TAKOS_CONTROL", async () => {
  const { env, controlRequests, tier1 } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/rpc/control/api-keys", {
      bearerToken: "control-token",
      body: { runId: "run-1", serviceId: "svc-1" },
    }),
    env as never,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    ok: true,
    path: "/internal/executor-rpc/api-keys",
  });
  assertEquals(controlRequests.length, 1);
  assertEquals(
    controlRequests[0].headers.get("X-Takos-Internal"),
    "executor-secret",
  );
  assertEquals(tier1.getLastToken(), "control-token");
});

Deno.test("executorHost control RPC uses executor container id instead of run id", async () => {
  const { env, tier1 } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/rpc/control/api-keys", {
      bearerToken: "control-token",
      executorContainerId: "tier1-warm-0",
      body: { runId: "run-1", serviceId: "svc-1" },
    }),
    env as never,
  );

  assertEquals(response.status, 200);
  assertEquals(tier1.getLastContainerId(), "tier1-warm-0");
  assertEquals(tier1.getLastToken(), "control-token");
});

Deno.test("executorHost control RPC routes tier3 proxy traffic to the tier3 namespace", async () => {
  const { env, tier1, tier3 } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/rpc/control/api-keys", {
      bearerToken: "control-token",
      executorTier: 3,
      executorContainerId: "tier3-scale-0",
      body: { runId: "run-1", serviceId: "svc-1" },
    }),
    env as never,
  );

  assertEquals(response.status, 200);
  assertEquals(tier1.getLastContainerId(), null);
  assertEquals(tier3.getLastContainerId(), "tier3-scale-0");
});

Deno.test("executorHost heartbeat touches the active control token", async () => {
  const { env, tier1 } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/rpc/control/heartbeat", {
      bearerToken: "control-token",
      executorContainerId: "tier1-warm-0",
      body: { runId: "run-1", serviceId: "svc-1" },
    }),
    env as never,
  );

  assertEquals(response.status, 200);
  assertEquals(tier1.getTouchedTokens(), ["control-token"]);
});

Deno.test("executorHost keeps the control token after terminal status update so the terminal event can be emitted", async () => {
  const { env, tier1 } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/rpc/control/update-run-status", {
      bearerToken: "control-token",
      executorContainerId: "tier1-warm-0",
      body: {
        runId: "run-1",
        serviceId: "svc-1",
        status: "completed",
      },
    }),
    env as never,
  );

  assertEquals(response.status, 200);
  assertEquals(tier1.getRevokedTokens(), []);
  assertEquals(tier1.getRevokeAllCount(), 0);

  const eventResponse = await executorHost.fetch(
    createProxyRequest("/rpc/control/run-event", {
      bearerToken: "control-token",
      executorContainerId: "tier1-warm-0",
      body: {
        runId: "run-1",
        serviceId: "svc-1",
        type: "error",
        data: { run: { status: "failed" } },
        sequence: 2,
      },
    }),
    env as never,
  );

  assertEquals(eventResponse.status, 200);
  assertEquals(tier1.getRevokedTokens(), ["control-token"]);
  assertEquals(tier1.getRevokeAllCount(), 0);
});
