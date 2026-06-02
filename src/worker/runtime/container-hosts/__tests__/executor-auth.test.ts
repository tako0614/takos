import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  signTakosumiInternalRequest as signTakosInternalRequest,
  TAKOSUMI_INTERNAL_AUDIENCE_HEADER as TAKOS_INTERNAL_AUDIENCE_HEADER,
  TAKOSUMI_INTERNAL_CALLER_HEADER as TAKOS_INTERNAL_CALLER_HEADER,
} from "takosumi-contract/internal/rpc";
import { createAgentControlBackendRouter } from "../../executor-proxy-api.ts";
import {
  claimsMatchRequestBody,
  CONTROL_RPC_ENDPOINTS,
  getRequiredProxyCapability,
  isProxyRequestAuthorized,
} from "../executor-auth.ts";
import {
  AGENT_PROXY_SCOPES,
  agentControlRpcPath,
  forwardToControlPlane,
  isControlRpcPath,
  proxyScopesForRunKind,
  WORKFLOW_PROXY_SCOPES,
} from "../executor-utils.ts";

test("claimsMatchRequestBody passes when body asserts the bound run/service id", () => {
  const claims = { run_id: "run_a", service_id: "svc_a", worker_id: "svc_a" };
  assertEquals(
    claimsMatchRequestBody(claims, { runId: "run_a", serviceId: "svc_a" }),
    true,
  );
  // workerId alias is accepted for the service id.
  assertEquals(
    claimsMatchRequestBody(claims, { runId: "run_a", workerId: "svc_a" }),
    true,
  );
});

test("claimsMatchRequestBody fails closed when the body omits the bound id", () => {
  const claims = { run_id: "run_a", service_id: "svc_a", worker_id: "svc_a" };
  // Historical fail-open: omitting runId/serviceId skipped the comparison.
  assertEquals(claimsMatchRequestBody(claims, {}), false);
  assertEquals(claimsMatchRequestBody(claims, { runId: "run_a" }), false);
  assertEquals(claimsMatchRequestBody(claims, { serviceId: "svc_a" }), false);
});

test("claimsMatchRequestBody fails closed when the body asserts a different id", () => {
  const claims = { run_id: "run_a", service_id: "svc_a", worker_id: "svc_a" };
  assertEquals(
    claimsMatchRequestBody(claims, { runId: "run_b", serviceId: "svc_a" }),
    false,
  );
  assertEquals(
    claimsMatchRequestBody(claims, { runId: "run_a", serviceId: "svc_b" }),
    false,
  );
});

test("executor auth rejects removed binding proxy paths", () => {
  for (
    const path of [
      "/proxy/db/query",
      "/proxy/offload/get",
      "/proxy/git-objects/get",
      "/proxy/do/fetch",
      "/proxy/vectorize/query",
      "/proxy/ai/run",
      "/proxy/egress/fetch",
      "/proxy/runtime/fetch",
      "/proxy/unknown/fetch",
      "/proxy/queue/send",
      "/proxy/heartbeat",
      "/proxy/run/status",
      "/proxy/run/fail",
      "/proxy/run/reset",
      "/proxy/run/usage",
      "/proxy/api-keys",
      "/proxy/billing/run-usage",
      "/rpc/control/heartbeat",
      "/api/internal/v1/agent-control/billing-run-usage",
    ]
  ) {
    assertEquals(getRequiredProxyCapability(path), null);
  }
});

test("executor host recognizes canonical agent-control paths for forwarding", () => {
  assertEquals(
    isControlRpcPath("/api/internal/v1/agent-control/heartbeat"),
    true,
  );
  assertEquals(
    isControlRpcPath("/api/internal/v1/agent-control/tool-execute"),
    true,
  );
  assertEquals(
    isControlRpcPath("/api/internal/v1/agent-control/run-usage"),
    true,
  );
  assertEquals(
    isControlRpcPath("/api/internal/v1/agent-control/unknown"),
    false,
  );
});

test("executor auth maps current dispatch-issued RPC paths to per-purpose scopes", () => {
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/heartbeat"),
    "run-lifecycle",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-event"),
    "run-lifecycle",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/run-usage"),
    "run-lifecycle",
  );
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/update-run-status",
    ),
    "run-lifecycle",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/tool-execute"),
    "tools",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/api-keys"),
    "provider-keys",
  );
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/conversation-history",
    ),
    "conversation",
  );
  assertEquals(
    getRequiredProxyCapability(
      "/api/internal/v1/agent-control/memory-activation",
    ),
    "memory",
  );
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/skill-catalog"),
    "skills",
  );
});

test("every control endpoint maps to exactly one known scope", () => {
  for (const endpoint of CONTROL_RPC_ENDPOINTS) {
    const scope = getRequiredProxyCapability(agentControlRpcPath(endpoint));
    assertEquals(
      AGENT_PROXY_SCOPES.includes(scope as never),
      true,
      `endpoint ${endpoint} did not map to a known scope (got ${scope})`,
    );
  }
});

test("an agent run token reaches every control endpoint (no regression)", () => {
  const agentCapability = proxyScopesForRunKind("agent");
  // Sanity: the agent scope set is the full scope set.
  assertEquals([...agentCapability].sort(), [...AGENT_PROXY_SCOPES].sort());
  for (const endpoint of CONTROL_RPC_ENDPOINTS) {
    const path = agentControlRpcPath(endpoint);
    assertEquals(
      isProxyRequestAuthorized(path, agentCapability),
      true,
      `agent run was denied endpoint ${endpoint}`,
    );
  }
});

test("legacy 'control' token still reaches all control endpoints", () => {
  for (const endpoint of CONTROL_RPC_ENDPOINTS) {
    const path = agentControlRpcPath(endpoint);
    assertEquals(
      isProxyRequestAuthorized(path, "control"),
      true,
      `legacy control token was denied endpoint ${endpoint}`,
    );
  }
});

test("a workflow run token is denied conversation / memory / skill endpoints", () => {
  const workflowCapability = proxyScopesForRunKind("workflow");
  assertEquals(
    [...workflowCapability].sort(),
    [...WORKFLOW_PROXY_SCOPES].sort(),
  );

  // Granted: run-lifecycle, tools, provider-keys endpoints.
  for (
    const endpoint of [
      "heartbeat",
      "run-status",
      "run-event",
      "update-run-status",
      "tool-execute",
      "tool-catalog",
      "api-keys",
    ]
  ) {
    assertEquals(
      isProxyRequestAuthorized(
        agentControlRpcPath(endpoint),
        workflowCapability,
      ),
      true,
      `workflow run should be allowed ${endpoint}`,
    );
  }

  // Denied: conversation, memory, and skill endpoints a workflow does not need.
  for (
    const endpoint of [
      "conversation-history",
      "current-session",
      "add-message",
      "memory-activation",
      "memory-finalize",
      "skill-catalog",
      "skill-plan",
      "skill-runtime-context",
    ]
  ) {
    assertEquals(
      isProxyRequestAuthorized(
        agentControlRpcPath(endpoint),
        workflowCapability,
      ),
      false,
      `workflow run should be denied ${endpoint}`,
    );
  }
});

test("workflow and agent both receive run-lifecycle + tools + provider-keys", () => {
  for (const scope of WORKFLOW_PROXY_SCOPES) {
    assertEquals(
      proxyScopesForRunKind("agent").includes(scope),
      true,
      `agent must also hold ${scope}`,
    );
    assertEquals(
      proxyScopesForRunKind("workflow").includes(scope),
      true,
      `workflow must hold ${scope}`,
    );
  }
});

test("unknown run kind defaults to the full agent scope set", () => {
  assertEquals(
    [...proxyScopesForRunKind(undefined)].sort(),
    [...AGENT_PROXY_SCOPES].sort(),
  );
});

test("unknown / non-control paths require no scope and are unauthorized", () => {
  assertEquals(getRequiredProxyCapability("/health"), null);
  assertEquals(
    getRequiredProxyCapability("/api/internal/v1/agent-control/unknown"),
    null,
  );
  // Membership check fails closed for an unmapped path regardless of scopes.
  assertEquals(
    isProxyRequestAuthorized(
      "/api/internal/v1/agent-control/unknown",
      "control",
    ),
    false,
  );
});

// Drizzle-like fake DB returning a single run row for the run-active gate on
// /api-keys. getDb() returns objects that expose select/insert/update/delete
// as-is (isDrizzleLikeDb), so the gate reads `.select().from().where().get()`
// straight off this stub.
function createRunStatusDb(status: string | null): unknown {
  const result = {
    from() {
      return this;
    },
    where() {
      return this;
    },
    limit() {
      return this;
    },
    async get() {
      return status === null ? undefined : { status };
    },
  };
  const noop = () => result;
  return { select: noop, insert: noop, update: noop, delete: noop };
}

async function signedApiKeysRequest(
  router: ReturnType<typeof createAgentControlBackendRouter>,
  secret: string,
  body: string,
  env: Record<string, unknown>,
): Promise<Response> {
  const signed = await signTakosInternalRequest({
    method: "POST",
    path: "/api-keys",
    body,
    timestamp: new Date().toISOString(),
    actor: {
      actorAccountId: "takosumi",
      roles: ["service"],
      requestId: "req_backend_bridge",
      principalKind: "service",
      serviceId: "takosumi",
    },
    caller: "takosumi",
    audience: "takos-worker",
    capabilities: ["app.agent-control.backend"],
    secret,
  });
  return await router.request(
    "/api-keys",
    {
      method: "POST",
      headers: { ...signed.headers, "content-type": "application/json" },
      body,
    },
    env as never,
  );
}

test("agent-control backend bridge requires signed Takosumi internal auth", async () => {
  const router = createAgentControlBackendRouter();
  const secret = "backend-secret";
  const body = JSON.stringify({ runId: "run_1" });
  const unsigned = await router.request(
    "/api-keys",
    { method: "POST", body },
    {
      TAKOS_INTERNAL_SERVICE_SECRET: secret,
    },
  );
  assertEquals(unsigned.status, 401);

  const authorized = await signedApiKeysRequest(router, secret, body, {
    TAKOS_INTERNAL_SERVICE_SECRET: secret,
    OPENAI_API_KEY: "openai-test-key",
    DB: createRunStatusDb("running"),
  });

  assertEquals(authorized.status, 200);
  assertEquals(await authorized.json(), {
    openai: "openai-test-key",
    anthropic: null,
    google: null,
  });
});

test("api-keys rejects a terminal token-bound run", async () => {
  const router = createAgentControlBackendRouter();
  const secret = "backend-secret";
  const body = JSON.stringify({ runId: "run_term" });
  for (const status of ["completed", "failed", "cancelled"]) {
    const res = await signedApiKeysRequest(router, secret, body, {
      TAKOS_INTERNAL_SERVICE_SECRET: secret,
      OPENAI_API_KEY: "openai-test-key",
      DB: createRunStatusDb(status),
    });
    assertEquals(res.status, 403);
  }
});

test("api-keys rejects a missing token-bound run", async () => {
  const router = createAgentControlBackendRouter();
  const secret = "backend-secret";
  const body = JSON.stringify({ runId: "run_gone" });
  const res = await signedApiKeysRequest(router, secret, body, {
    TAKOS_INTERNAL_SERVICE_SECRET: secret,
    OPENAI_API_KEY: "openai-test-key",
    DB: createRunStatusDb(null),
  });
  assertEquals(res.status, 403);
});

test("api-keys rejects when the body omits the token-bound runId", async () => {
  const router = createAgentControlBackendRouter();
  const secret = "backend-secret";
  const body = JSON.stringify({});
  const res = await signedApiKeysRequest(router, secret, body, {
    TAKOS_INTERNAL_SERVICE_SECRET: secret,
    OPENAI_API_KEY: "openai-test-key",
    DB: createRunStatusDb("running"),
  });
  assertEquals(res.status, 400);
});

test("executor host forwards mapped control RPC to Takosumi canonical agent-control when binding is configured", async () => {
  const requests: Request[] = [];
  const response = await forwardToControlPlane(
    "/api/internal/v1/agent-control/heartbeat",
    { runId: "run_1", spaceId: "space_1" },
    {
      TAKOS_INTERNAL_SERVICE_SECRET: "takosumi-secret",
      TAKOSUMI_INTERNAL_URL: "https://takosumi.internal/",
      TAKOSUMI: {
        fetch(input: RequestInfo | URL, init?: RequestInit) {
          requests.push(new Request(input, init));
          return Promise.resolve(Response.json({ ok: true }));
        },
      },
      TAKOS_WORKER: {
        fetch() {
          throw new Error("legacy fallback must not be used");
        },
      },
      EXECUTOR_PROXY_SECRET: "legacy-secret",
    } as never,
  );

  assertEquals(response?.status, 200);
  assertEquals(requests.length, 1);
  assertEquals(
    requests[0].url,
    "https://takosumi.internal/api/internal/v1/agent-control/heartbeat",
  );
  assertEquals(
    requests[0].headers.get(TAKOS_INTERNAL_CALLER_HEADER),
    "takos-worker",
  );
  assertEquals(
    requests[0].headers.get(TAKOS_INTERNAL_AUDIENCE_HEADER),
    "takosumi",
  );
});
