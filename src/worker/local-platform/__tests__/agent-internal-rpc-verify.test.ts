import { assertEquals } from "@std/assert";

import {
  canonicalAgentInternalRequest,
  TAKOS_INTERNAL_RPC_VERSION,
  verifyAgentInternalRpcFromHeaders,
} from "../agent-internal-rpc-verify.ts";
import { buildLocalExecutorHostFetch } from "../executor-control-rpc.ts";
import type {
  LocalExecutorGatewayStub,
  ProxyTokenInfo,
} from "../runtime-types.ts";

const textEncoder = new TextEncoder();
const SECRET = "test-internal-rpc-secret";
const RUN_ID = "run_test_1";
const SERVICE_ID = "svc_test_1";

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string): Promise<string> {
  return toHex(
    await crypto.subtle.digest("SHA-256", textEncoder.encode(value)),
  );
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", key, textEncoder.encode(message)),
  );
}

interface SignOptions {
  readonly method?: string;
  readonly path: string;
  readonly body: string;
  readonly caller?: string;
  readonly audience?: string;
  readonly capabilities?: readonly string[];
  readonly nonce?: string;
  readonly requestId?: string;
  readonly timestamp?: string;
  readonly secret?: string;
}

// Mirrors the Rust `sign_internal_rpc` envelope so the test exercises the real
// canonical message construction against the real verifier.
async function signEnvelope(
  options: SignOptions,
): Promise<Record<string, string>> {
  const method = options.method ?? "POST";
  const caller = options.caller ?? "takos-agent";
  const audience = options.audience ?? "takos-worker";
  const capabilities = options.capabilities ?? ["agent-control.rpc"];
  const nonce = options.nonce ?? "nonce-1";
  const requestId = options.requestId ?? "agent-req-1";
  const timestamp = options.timestamp ?? new Date().toISOString();
  const secret = options.secret ?? SECRET;
  const actor = {
    actorAccountId: caller,
    roles: ["agent"],
    requestId,
    principalKind: "service",
    serviceId: SERVICE_ID,
    agentId: RUN_ID,
  };
  const actorContextHeader = btoa(JSON.stringify(actor));
  const bodyDigest = await sha256Hex(options.body);
  const signature = await hmacSha256Hex(
    secret,
    canonicalAgentInternalRequest({
      method,
      path: options.path,
      bodyDigest,
      actorContextHeader,
      caller,
      audience,
      capabilities,
      requestId,
      nonce,
      timestamp,
    }),
  );
  return {
    "x-takos-internal-version": TAKOS_INTERNAL_RPC_VERSION,
    "x-takos-actor-context": actorContextHeader,
    "x-takos-body-digest": bodyDigest,
    "x-takos-nonce": nonce,
    "x-takos-request-id": requestId,
    "x-takos-internal-timestamp": timestamp,
    "x-takos-caller": caller,
    "x-takos-audience": audience,
    "x-takos-capabilities": [...capabilities].join(","),
    "x-takos-internal-signature": signature,
  };
}

Deno.test("verifier accepts a valid takos-internal-v3 envelope", async () => {
  const body = JSON.stringify({ runId: RUN_ID, serviceId: SERVICE_ID });
  const path = "/api/internal/v1/agent-control/heartbeat";
  const headers = await signEnvelope({ path, body });
  const verified = await verifyAgentInternalRpcFromHeaders({
    method: "POST",
    path,
    body,
    secret: SECRET,
    headers,
    expectedCaller: "takos-agent",
    expectedAudience: "takos-worker",
    requiredCapabilities: ["agent-control.rpc"],
  });
  assertEquals(verified?.caller, "takos-agent");
  assertEquals(verified?.audience, "takos-worker");
  assertEquals(verified?.capabilities, ["agent-control.rpc"]);
  assertEquals(verified?.actor.agentId, RUN_ID);
});

Deno.test("verifier rejects a tampered body (digest mismatch)", async () => {
  const body = JSON.stringify({ runId: RUN_ID, serviceId: SERVICE_ID });
  const path = "/api/internal/v1/agent-control/heartbeat";
  const headers = await signEnvelope({ path, body });
  const verified = await verifyAgentInternalRpcFromHeaders({
    method: "POST",
    path,
    body: JSON.stringify({ runId: RUN_ID, serviceId: "attacker" }),
    secret: SECRET,
    headers,
  });
  assertEquals(verified, undefined);
});

Deno.test("verifier rejects a wrong signature (wrong key)", async () => {
  const body = JSON.stringify({ runId: RUN_ID });
  const path = "/api/internal/v1/agent-control/heartbeat";
  const headers = await signEnvelope({ path, body, secret: "other-secret" });
  const verified = await verifyAgentInternalRpcFromHeaders({
    method: "POST",
    path,
    body,
    secret: SECRET,
    headers,
  });
  assertEquals(verified, undefined);
});

Deno.test("verifier rejects an expired timestamp", async () => {
  const body = JSON.stringify({ runId: RUN_ID });
  const path = "/api/internal/v1/agent-control/heartbeat";
  const headers = await signEnvelope({
    path,
    body,
    timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  const verified = await verifyAgentInternalRpcFromHeaders({
    method: "POST",
    path,
    body,
    secret: SECRET,
    headers,
  });
  assertEquals(verified, undefined);
});

Deno.test("verifier returns undefined when no envelope headers are present", async () => {
  const verified = await verifyAgentInternalRpcFromHeaders({
    method: "POST",
    path: "/api/internal/v1/agent-control/heartbeat",
    body: "{}",
    secret: SECRET,
    headers: {},
  });
  assertEquals(verified, undefined);
});

// --- Integration through the executor host fetch ---------------------------

function createExecutorNamespace(stub: LocalExecutorGatewayStub) {
  return {
    getByName: () => stub,
    idFromName: () => "singleton",
    get: () => stub,
  };
}

function controlStub(): LocalExecutorGatewayStub {
  const tokenInfo: ProxyTokenInfo = {
    runId: RUN_ID,
    serviceId: SERVICE_ID,
    capability: "control",
  };
  return {
    dispatchStart: async () => ({ ok: true, status: 200, body: "{}" }),
    verifyProxyToken: async (token: string) =>
      token === "proxy-token" ? tokenInfo : null,
  };
}

function executorEnv(internalRpcKey?: string) {
  return {
    EXECUTOR_CONTAINER: createExecutorNamespace(controlStub()),
    ...(internalRpcKey ? { TAKOS_AGENT_INTERNAL_RPC_KEY: internalRpcKey } : {}),
    // run-config with body.agentType resolves without DB.
    DB: undefined,
  } as never;
}

const RUN_CONFIG_PATH = "/api/internal/v1/agent-control/run-config";

function controlRequest(body: string, extraHeaders: Record<string, string>) {
  return new Request(`http://executor-host${RUN_CONFIG_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer proxy-token",
      "X-Takos-Run-Id": RUN_ID,
      ...extraHeaders,
    },
    body,
  });
}

Deno.test("executor host rejects agent-control RPC when key set but envelope missing", async () => {
  const fetch = await buildLocalExecutorHostFetch(executorEnv(SECRET));
  const response = await fetch(
    controlRequest(JSON.stringify({ agentType: "default" }), {}),
  );
  assertEquals(response.status, 401);
});

Deno.test("executor host rejects agent-control RPC with invalid envelope when key set", async () => {
  const body = JSON.stringify({ agentType: "default" });
  const headers = await signEnvelope({
    path: RUN_CONFIG_PATH,
    body,
    secret: "wrong-key",
  });
  const fetch = await buildLocalExecutorHostFetch(executorEnv(SECRET));
  const response = await fetch(controlRequest(body, headers));
  assertEquals(response.status, 401);
});

Deno.test("executor host accepts agent-control RPC with valid envelope when key set", async () => {
  const body = JSON.stringify({ agentType: "default" });
  const headers = await signEnvelope({ path: RUN_CONFIG_PATH, body });
  const fetch = await buildLocalExecutorHostFetch(executorEnv(SECRET));
  const response = await fetch(controlRequest(body, headers));
  assertEquals(response.status, 200);
  await response.body?.cancel();
});

Deno.test("executor host allows agent-control RPC without envelope when key unset", async () => {
  const body = JSON.stringify({ agentType: "default" });
  const fetch = await buildLocalExecutorHostFetch(executorEnv());
  const response = await fetch(controlRequest(body, {}));
  assertEquals(response.status, 200);
  await response.body?.cancel();
});
