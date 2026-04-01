import { assert, assertEquals } from "jsr:@std/assert";
import executorHost, {
  validateProxyResourceAccess,
} from "@/container-hosts/executor-host";

type ProxyCapability = "bindings" | "control";

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
};

function createExecutorContainerNamespace() {
  const dispatchBodies: Record<string, unknown>[] = [];
  let lastRunId: string | null = null;
  let lastToken: string | null = null;

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
          if (token === "bindings-token") {
            return { runId, serviceId: "svc-1", capability: "bindings" };
          }
          if (token === "control-token") {
            return { runId, serviceId: "svc-1", capability: "control" };
          }
          return null;
        },
      };
    },
  };

  return {
    namespace,
    dispatchBodies,
    getLastRunId: () => lastRunId,
    getLastToken: () => lastToken,
  };
}

function createEnv(overrides: Partial<Record<string, unknown>> = {}) {
  const tier1 = createExecutorContainerNamespace();
  const tier2 = createExecutorContainerNamespace();
  const runtimeRequests: Request[] = [];
  const browserRequests: Request[] = [];
  const egressRequests: Request[] = [];

  const env = {
    EXECUTOR_CONTAINER: tier1.namespace,
    EXECUTOR_CONTAINER_TIER2: tier2.namespace,
    DB: { prepare: () => ({ bind: () => ({}) }) },
    RUN_NOTIFIER: {
      idFromName: () => ({ toString: () => "do-id" }),
      get: () => ({ fetch: async () => new Response("{}") }),
    },
    TAKOS_OFFLOAD: {
      get: async () => null,
      put: async () => null,
      delete: async () => undefined,
      list: async () => ({ objects: [], truncated: false }),
      head: async () => null,
    },
    TAKOS_EGRESS: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request
          ? input
          : new Request(input, init);
        egressRequests.push(request);
        return new Response("egress-ok", { status: 200 });
      },
    },
    RUNTIME_HOST: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request
          ? input
          : new Request(input, init);
        runtimeRequests.push(request);
        return new Response("runtime-ok", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      },
    },
    BROWSER_HOST: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request
          ? input
          : new Request(input, init);
        browserRequests.push(request);
        return new Response("browser-ok", { status: 200 });
      },
    },
    CONTROL_RPC_BASE_URL: "https://executor-host.example",
    OPENAI_API_KEY: "openai-key",
    ANTHROPIC_API_KEY: "anthropic-key",
    GOOGLE_API_KEY: "google-key",
    ...overrides,
  };

  return {
    env,
    tier1,
    tier2,
    runtimeRequests,
    browserRequests,
    egressRequests,
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

async function readProxyUsageCounts(env: Record<string, unknown>) {
  const response = await executorHost.fetch(
    new Request("http://localhost/internal/proxy-usage", { method: "GET" }),
    env as never,
  );
  assertEquals(response.status, 200);
  const body = await response.json() as { counts?: Record<string, number> };
  return body.counts ?? {};
}

function diffCounts(
  before: Record<string, number>,
  after: Record<string, number>,
) {
  const delta: Record<string, number> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    delta[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return delta;
}

Deno.test("validateProxyResourceAccess allows expected runtime and browser targets", () => {
  assertEquals(
    validateProxyResourceAccess("/proxy/runtime/fetch", { run_id: "run-1" }, {
      url: "https://runtime-host/session/exec",
    }),
    true,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/browser/fetch", { run_id: "run-1" }, {
      url: "https://browser-host.internal/session/session-1/screenshot",
    }),
    true,
  );
});

Deno.test("validateProxyResourceAccess rejects invalid DO, queue, and host targets", () => {
  assertEquals(
    validateProxyResourceAccess("/proxy/do/fetch", { run_id: "run-1" }, {
      namespace: "SESSION_DO",
      name: "run-1",
    }),
    false,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/queue/send", { run_id: "run-1" }, {
      queue: "other",
    }),
    false,
  );
  assertEquals(
    validateProxyResourceAccess("/proxy/runtime/fetch", { run_id: "run-1" }, {
      url: "https://evil.example/session/exec",
    }),
    false,
  );
});

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
    createProxyRequest("/proxy/runtime/fetch", {
      bearerToken: undefined,
      body: { url: "https://runtime-host/status" },
    }),
    env as never,
  );

  assertEquals(response.status, 401);
});

Deno.test("executorHost runtime proxy forwards allowed requests and tracks usage", async () => {
  const { env, runtimeRequests, tier1 } = createEnv();
  const before = await readProxyUsageCounts(env);
  const response = await executorHost.fetch(
    createProxyRequest("/proxy/runtime/fetch", {
      bearerToken: "bindings-token",
      body: {
        runId: "run-1",
        serviceId: "svc-1",
        url: "https://runtime-host/status",
        method: "GET",
      },
    }),
    env as never,
  );
  const after = await readProxyUsageCounts(env);

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "runtime-ok");
  assertEquals(runtimeRequests.length, 1);
  assertEquals(runtimeRequests[0].headers.get("X-Takos-Internal"), "1");
  assertEquals(new URL(runtimeRequests[0].url).pathname, "/status");
  assertEquals(tier1.getLastToken(), "bindings-token");
  assertEquals(diffCounts(before, after)["other-proxy"] ?? 0, 1);
});

Deno.test("executorHost control RPC requires control capability", async () => {
  const { env } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/rpc/control/api-keys", {
      bearerToken: "bindings-token",
      body: { runId: "run-1", serviceId: "svc-1" },
    }),
    env as never,
  );

  assertEquals(response.status, 401);
});

Deno.test("executorHost control RPC returns configured API keys", async () => {
  const { env, tier1 } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/rpc/control/api-keys", {
      bearerToken: "control-token",
      body: { runId: "run-1", serviceId: "svc-1" },
    }),
    env as never,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    openai: "openai-key",
    anthropic: "anthropic-key",
    google: "google-key",
  });
  assertEquals(tier1.getLastToken(), "control-token");
});

Deno.test("executorHost browser proxy rejects disallowed browser targets", async () => {
  const { env, browserRequests } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/proxy/browser/fetch", {
      bearerToken: "bindings-token",
      body: {
        runId: "run-1",
        serviceId: "svc-1",
        url: "https://browser-host.internal/admin",
        method: "GET",
      },
    }),
    env as never,
  );

  assertEquals(response.status, 401);
  assertEquals(browserRequests.length, 0);
});

Deno.test("executorHost egress proxy forwards bindings requests", async () => {
  const { env, egressRequests } = createEnv();
  const response = await executorHost.fetch(
    createProxyRequest("/proxy/egress/fetch", {
      bearerToken: "bindings-token",
      body: {
        runId: "run-1",
        serviceId: "svc-1",
        url: "https://example.com/data",
        method: "GET",
      },
    }),
    env as never,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "egress-ok");
  assertEquals(egressRequests.length, 1);
  assertEquals(new URL(egressRequests[0].url).hostname, "example.com");
  assert(egressRequests[0].headers.get("X-Takos-Internal") === "1");
});
