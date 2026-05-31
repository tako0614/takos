import { assertEquals } from "@std/assert";
import {
  signTakosumiInternalRequest as signTakosInternalRequest,
  TAKOSUMI_INTERNAL_AUDIENCE_HEADER as TAKOS_INTERNAL_AUDIENCE_HEADER,
  TAKOSUMI_INTERNAL_CALLER_HEADER as TAKOS_INTERNAL_CALLER_HEADER,
} from "takosumi-contract/internal/rpc";
import { createAgentControlBackendRouter } from "../../executor-proxy-api.ts";
import {
  claimsMatchRequestBody,
  getRequiredProxyCapability,
} from "../executor-auth.ts";
import { forwardToControlPlane, isControlRpcPath } from "../executor-utils.ts";

Deno.test("claimsMatchRequestBody passes when body asserts the bound run/service id", () => {
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

Deno.test("claimsMatchRequestBody fails closed when the body omits the bound id", () => {
  const claims = { run_id: "run_a", service_id: "svc_a", worker_id: "svc_a" };
  // Historical fail-open: omitting runId/serviceId skipped the comparison.
  assertEquals(claimsMatchRequestBody(claims, {}), false);
  assertEquals(claimsMatchRequestBody(claims, { runId: "run_a" }), false);
  assertEquals(claimsMatchRequestBody(claims, { serviceId: "svc_a" }), false);
});

Deno.test("claimsMatchRequestBody fails closed when the body asserts a different id", () => {
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

Deno.test("executor auth rejects removed binding proxy paths", () => {
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

Deno.test("executor host recognizes canonical agent-control paths for forwarding", () => {
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

Deno.test("executor auth maps current dispatch-issued RPC paths to control capability", () => {
  for (
    const path of [
      "/api/internal/v1/agent-control/heartbeat",
      "/api/internal/v1/agent-control/run-event",
      "/api/internal/v1/agent-control/run-usage",
      "/api/internal/v1/agent-control/update-run-status",
      "/api/internal/v1/agent-control/tool-execute",
    ]
  ) {
    assertEquals(getRequiredProxyCapability(path), "control");
  }
});

Deno.test("agent-control backend bridge requires signed Takosumi internal auth", async () => {
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
  const authorized = await router.request(
    "/api-keys",
    {
      method: "POST",
      headers: {
        ...signed.headers,
        "content-type": "application/json",
      },
      body,
    },
    {
      TAKOS_INTERNAL_SERVICE_SECRET: secret,
      OPENAI_API_KEY: "openai-test-key",
    },
  );

  assertEquals(authorized.status, 200);
  assertEquals(await authorized.json(), {
    openai: "openai-test-key",
    anthropic: null,
    google: null,
  });
});

Deno.test("executor host forwards mapped control RPC to Takosumi canonical agent-control when binding is configured", async () => {
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
