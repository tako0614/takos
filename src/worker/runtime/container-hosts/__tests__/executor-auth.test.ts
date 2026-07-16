import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  dispatchControlRpc,
  resolveRunOpenAiRuntimeCredential,
} from "../../executor-proxy-api.ts";
import {
  claimsMatchRequestBody,
  CONTROL_RPC_ENDPOINT_NAMES,
  getRequiredProxyCapability,
  isProxyRequestAuthorized,
} from "../executor-auth.ts";
import {
  AGENT_PROXY_SCOPES,
  agentControlRpcPath,
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
  for (const path of [
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
  ]) {
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
    getRequiredProxyCapability("/api/internal/v1/agent-control/skill-catalog"),
    "skills",
  );
});

test("every control endpoint maps to exactly one known scope", () => {
  for (const endpoint of CONTROL_RPC_ENDPOINT_NAMES) {
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
  for (const endpoint of CONTROL_RPC_ENDPOINT_NAMES) {
    const path = agentControlRpcPath(endpoint);
    assertEquals(
      isProxyRequestAuthorized(path, agentCapability),
      true,
      `agent run was denied endpoint ${endpoint}`,
    );
  }
});

test("unknown proxy capability is denied for all control endpoints", () => {
  for (const endpoint of CONTROL_RPC_ENDPOINT_NAMES) {
    const path = agentControlRpcPath(endpoint);
    assertEquals(
      isProxyRequestAuthorized(path, "control" as never),
      false,
      `unknown control capability reached endpoint ${endpoint}`,
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
  for (const endpoint of [
    "heartbeat",
    "run-status",
    "run-event",
    "update-run-status",
    "tool-execute",
    "tool-catalog",
    "api-keys",
  ]) {
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
  for (const endpoint of [
    "conversation-history",
    "add-message",
    "skill-catalog",
    "skill-plan",
    "skill-runtime-context",
  ]) {
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
      AGENT_PROXY_SCOPES,
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

// The executor-host verifies the per-run proxy token + scope, then dispatches
// the api-keys RPC in-process. These tests exercise that in-process dispatch
// directly with an already-token-bound body, mirroring the executor-host call.
function apiKeysDispatch(
  body: Record<string, unknown>,
  env: Record<string, unknown>,
): Promise<Response> {
  const dispatched = dispatchControlRpc(
    agentControlRpcPath("api-keys"),
    body,
    env as never,
  );
  if (!dispatched) throw new Error("api-keys path is not a control-RPC path");
  return Promise.resolve(dispatched);
}

test("api-keys hands out provider keys for an active token-bound run", async () => {
  const res = await apiKeysDispatch(
    { runId: "run_1" },
    {
      OPENAI_API_KEY: "openai-test-key",
      TAKOS_AGENT_ALLOW_SHARED_PROVIDER_KEY: "true",
      DB: createRunStatusDb("running"),
    },
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    openai: "openai-test-key",
    openaiEndpoint: null,
  });
});

test("api-keys projects a configured OpenAI-compatible base URL", async () => {
  const res = await apiKeysDispatch(
    { runId: "run_direct" },
    {
      OPENAI_API_KEY: "openai-test-key",
      TAKOS_AGENT_ALLOW_SHARED_PROVIDER_KEY: "true",
      OPENAI_BASE_URL: "https://models.example.test/v1/",
      DB: createRunStatusDb("running"),
    },
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    openai: "openai-test-key",
    openaiEndpoint: "https://models.example.test/v1/chat/completions",
  });
});

test("api-keys denies deployment-global provider keys by default", async () => {
  const res = await apiKeysDispatch(
    { runId: "run_secure_default" },
    {
      OPENAI_API_KEY: "openai-test-key",
      DB: createRunStatusDb("running"),
    },
  );

  assertEquals(res.status, 503);
  assertEquals(
    ((await res.json()) as { error?: string }).error,
    "Shared provider-key handout is disabled; configure short-lived AI Gateway credentials",
  );
});

test("runtime AI credential uses the exact authorized InterfaceBinding", async () => {
  const requests: Request[] = [];
  const credential = await resolveRunOpenAiRuntimeCredential(
    {
      runId: "run_gateway",
      env: {
        DB: {} as never,
        RUN_QUEUE: {} as never,
        RUN_NOTIFIER: {} as never,
        HOSTNAME_ROUTING: {} as never,
        ADMIN_DOMAIN: "takos.example.test",
        TENANT_BASE_DOMAIN: "takos.example.test",
        OIDC_ISSUER_URL: "https://app.takosumi.test",
        OIDC_CLIENT_ID: "toc_takos",
        ENCRYPTION_KEY: "encryption-key",
        TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://internal-app.takosumi.test",
        TAKOSUMI_ACCOUNTS_URL: "https://app.takosumi.test",
      },
    },
    {
      getRunBootstrap: async (_env, runId) => ({
        status: "running",
        spaceId: "takos-space",
        threadId: "thread",
        userId: "takos-user",
        agentType: "default",
        ...(runId === "run_gateway" ? {} : { installationId: "wrong" }),
      }),
      accountsDelegatedAuthorization: async (input) => {
        assertEquals(input.userId, "takos-user");
        assertEquals(input.access, "read");
        return {
          accessToken: "delegated-accounts-token",
          workspaceId: "workspace_owner",
          subjectId: "pairwise-user",
        };
      },
      fetch: (async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        const url = new URL(request.url);
        if (url.pathname === "/v1/interfaces") {
          return Response.json({
            interfaces: [
              {
                apiVersion: "takosumi.dev/v1alpha1",
                kind: "Interface",
                metadata: {
                  id: "if_ai_gateway",
                  workspaceId: "workspace_owner",
                  name: "default-ai",
                  ownerRef: { kind: "Workspace", id: "workspace_owner" },
                  generation: 1,
                  createdAt: "2026-07-13T00:00:00.000Z",
                  updatedAt: "2026-07-13T00:00:00.000Z",
                },
                spec: {
                  type: "takosumi.ai.gateway",
                  version: "v1",
                  document: { protocol: "openai-compatible" },
                  inputs: {
                    endpoint: {
                      source: "literal",
                      value: "https://app.takosumi.test/gateway/ai/v1",
                    },
                  },
                  access: {
                    visibility: "workspace",
                    resourceUriInput: "endpoint",
                  },
                },
                status: {
                  phase: "Resolved",
                  observedGeneration: 1,
                  resolvedRevision: 3,
                  resolvedInputs: {
                    endpoint: "https://app.takosumi.test/gateway/ai/v1",
                  },
                },
              },
            ],
          });
        }
        if (url.pathname === "/v1/interfaces/if_ai_gateway/bindings") {
          return Response.json({
            bindings: [
              {
                apiVersion: "takosumi.dev/v1alpha1",
                kind: "InterfaceBinding",
                metadata: {
                  id: "ifb_ai_gateway",
                  workspaceId: "workspace_owner",
                  generation: 2,
                  createdAt: "2026-07-13T00:00:00.000Z",
                  updatedAt: "2026-07-13T00:00:00.000Z",
                },
                spec: {
                  interfaceId: "if_ai_gateway",
                  subjectRef: { kind: "Principal", id: "pairwise-user" },
                  permissions: ["ai.chat"],
                  delivery: { type: "oauth2" },
                },
                status: {
                  phase: "Ready",
                  observedInterfaceRevision: 3,
                },
              },
            ],
          });
        }
        return Response.json({
          access_token: "runtime-interface-token",
          token_type: "Bearer",
          expires_in: 30,
          expires_at: new Date(Date.now() + 30_000).toISOString(),
          scope: "ai.chat",
          resource: "https://app.takosumi.test/gateway/ai/v1",
        });
      }) as typeof fetch,
    },
  );

  assertEquals(credential, {
    apiKey: "runtime-interface-token",
    endpoint: "https://app.takosumi.test/gateway/ai/v1/chat/completions",
  });
  assertEquals(requests.length, 3);
  assertEquals(
    requests[0]?.url,
    "https://internal-app.takosumi.test/v1/interfaces?workspaceId=workspace_owner&type=takosumi.ai.gateway&phase=Resolved&permission=ai.chat",
  );
  assertEquals(
    requests[1]?.url,
    "https://internal-app.takosumi.test/v1/interfaces/if_ai_gateway/bindings?permission=ai.chat",
  );
  assertEquals(
    requests[2]?.headers.get("authorization"),
    "Bearer delegated-accounts-token",
  );
  assertEquals(await requests[2]?.json(), {
    permission: "ai.chat",
  });
});

test("api-keys rejects a terminal token-bound run", async () => {
  for (const status of ["completed", "failed", "cancelled"]) {
    const res = await apiKeysDispatch(
      { runId: "run_term" },
      {
        OPENAI_API_KEY: "openai-test-key",
        DB: createRunStatusDb(status),
      },
    );
    assertEquals(res.status, 403);
  }
});

test("api-keys rejects a missing token-bound run", async () => {
  const res = await apiKeysDispatch(
    { runId: "run_gone" },
    {
      OPENAI_API_KEY: "openai-test-key",
      DB: createRunStatusDb(null),
    },
  );
  assertEquals(res.status, 403);
});

test("api-keys rejects when the body omits the token-bound runId", async () => {
  const res = await apiKeysDispatch(
    {},
    {
      OPENAI_API_KEY: "openai-test-key",
      DB: createRunStatusDb("running"),
    },
  );
  assertEquals(res.status, 400);
});
