import { assertEquals } from "jsr:@std/assert";
import executorHost from "@/container-hosts/executor-host";

type ProxyCapability = "control";

type MockContainerStub = {
  dispatchStart(body: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    body: string;
  }>;
  verifyProxyToken(token: string): Promise<
    {
      runId: string;
      serviceId: string;
      capability: ProxyCapability;
    } | null
  >;
  revokeProxyTokens(): Promise<void>;
};

function createExecutorContainerNamespace() {
  const dispatchBodies: Record<string, unknown>[] = [];
  let lastRunId: string | null = null;
  let lastToken: string | null = null;
  let revokeCount = 0;

  const namespace = {
    getByName(runId: string): MockContainerStub {
      lastRunId = runId;
      return {
        async dispatchStart(body) {
          dispatchBodies.push(body);
          return {
            ok: true,
            status: 202,
            body: JSON.stringify({
              accepted: true,
              runId,
              tier: body.tier ?? 1,
            }),
          };
        },
        async verifyProxyToken(token) {
          lastToken = token;
          if (token === "control-token") {
            return { runId, serviceId: "svc-1", capability: "control" };
          }
          return null;
        },
        async revokeProxyTokens() {
          revokeCount++;
        },
      };
    },
  };

  return {
    namespace,
    dispatchBodies,
    getLastRunId: () => lastRunId,
    getLastToken: () => lastToken,
    getRevokeCount: () => revokeCount,
  };
}

function createEnv(overrides: Partial<Record<string, unknown>> = {}) {
  const tier1 = createExecutorContainerNamespace();
  const tier2 = createExecutorContainerNamespace();
  const controlRequests: Request[] = [];

  const env = {
    EXECUTOR_CONTAINER: tier1.namespace,
    EXECUTOR_CONTAINER_TIER2: tier2.namespace,
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
    controlRequests,
  };
}

function createProxyRequest(
  path: string,
  {
    bearerToken,
    body,
    method = "POST",
    runId = "run-1",
  }: {
    bearerToken?: string;
    body?: Record<string, unknown>;
    method?: string;
    runId?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (runId) headers.set("X-Takos-Run-Id", runId);
  if (bearerToken) headers.set("Authorization", `Bearer ${bearerToken}`);
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
  });
  assertEquals(tier1.dispatchBodies.length, 0);
  assertEquals(tier2.dispatchBodies.length, 1);
  assertEquals(tier2.getLastRunId(), "run-2");
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

Deno.test("executorHost revokes control token after terminal forwarded RPC", async () => {
  const { env, tier1 } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/rpc/control/update-run-status", {
      bearerToken: "control-token",
      body: {
        runId: "run-1",
        serviceId: "svc-1",
        status: "completed",
      },
    }),
    env as never,
  );

  assertEquals(response.status, 200);
  assertEquals(tier1.getRevokeCount(), 1);
});
