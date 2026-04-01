import {
  type AgentExecutorControlConfig,
  type AgentExecutorDispatchStub,
  type AgentExecutorDispatchTarget,
  dispatchAgentExecutorStart,
  forwardAgentExecutorDispatch,
} from "@/runtime/container-hosts/executor-dispatch.ts";
import {
  buildAgentExecutorContainerEnvVars,
  buildAgentExecutorProxyConfig,
  generateProxyToken,
} from "@/runtime/container-hosts/executor-proxy-config.ts";

import { assert, assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, spy } from "jsr:@std/testing/mock";

Deno.test("dispatchAgentExecutorStart - keeps only CONTROL_RPC_BASE_URL in container env vars", () => {
  assertEquals(
    buildAgentExecutorContainerEnvVars({
      CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
    }),
    {
      CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
    },
  );
});

Deno.test("dispatchAgentExecutorStart - allows an empty CONTROL_RPC_BASE_URL for adapter-owned resolution", () => {
  assertEquals(
    buildAgentExecutorContainerEnvVars({
      CONTROL_RPC_BASE_URL: undefined,
    }),
    {
      CONTROL_RPC_BASE_URL: "",
    },
  );
});

Deno.test("dispatchAgentExecutorStart - generates a random control RPC token (not JWT)", () => {
  const controlConfig = buildAgentExecutorProxyConfig({
    CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
  }, {
    runId: "run-secret",
    serviceId: "worker-secret",
  });

  assert(controlConfig.controlRpcToken);
  assertEquals(
    controlConfig.controlRpcBaseUrl,
    "https://control-rpc.example.internal",
  );
  assert(controlConfig.controlRpcToken.length > 20);
});

Deno.test("dispatchAgentExecutorStart - generateProxyToken returns base64url without padding", () => {
  const token = generateProxyToken();
  assert(/^[A-Za-z0-9_-]+$/.test(token));
  assert(token.length > 20);
});

Deno.test("dispatchAgentExecutorStart - forwards only canonical control RPC fields through the /start payload", async () => {
  const startAndWaitForPorts = spy(async () => undefined);
  const fetch = spy(async (_request: Request) =>
    new Response('{"status":"accepted","runId":"run-secret"}', { status: 202 })
  );
  const controlConfig = buildAgentExecutorProxyConfig({
    CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
  }, {
    runId: "run-secret",
    serviceId: "worker-secret",
  });

  await dispatchAgentExecutorStart(
    { startAndWaitForPorts, fetch } as AgentExecutorDispatchTarget,
    {
      runId: "run-secret",
      workerId: "worker-secret",
    },
    controlConfig,
  );

  assertSpyCalls(startAndWaitForPorts, 1);
  const request = fetch.calls[0]!.args[0] as Request;
  const payload = await request.json() as Record<string, unknown>;
  assertObjectMatch(payload, {
    controlRpcBaseUrl: "https://control-rpc.example.internal",
  });
  assert(payload.controlRpcToken);
});

Deno.test("dispatchAgentExecutorStart - waits for port 8080 and posts the start payload inside the container DO", async () => {
  const startAndWaitForPorts = spy(async () => undefined);
  const fetch = spy(async (_request: Request) =>
    new Response('{"status":"accepted","runId":"run-1"}', { status: 202 })
  );
  const controlConfig: AgentExecutorControlConfig = {
    controlRpcBaseUrl: "https://control-rpc.example.internal",
    controlRpcToken: "control-rpc-token",
  };
  const payload = {
    runId: "run-1",
    workerId: "worker-1",
    model: "gpt-5-mini",
  };

  const result = await dispatchAgentExecutorStart(
    { startAndWaitForPorts, fetch } as AgentExecutorDispatchTarget,
    payload,
    controlConfig,
  );

  assertSpyCallArgs(startAndWaitForPorts, 0, [8080]);
  assertSpyCalls(fetch, 1);

  const request = fetch.calls[0]!.args[0] as Request;
  assertEquals(request.url, "https://executor/start");
  assertEquals(request.method, "POST");
  assertEquals(request.headers.get("Content-Type"), "application/json");
  await assertEquals(await request.json(), {
    ...payload,
    serviceId: "worker-1",
    ...controlConfig,
  });

  assertEquals(result, {
    ok: true,
    status: 202,
    body: '{"status":"accepted","runId":"run-1"}',
  });
});

Deno.test("dispatchAgentExecutorStart - preserves non-2xx start failures for host-side logging", async () => {
  const startAndWaitForPorts = spy(async () => undefined);
  const fetch = spy(async (_request: Request) =>
    new Response("Proxy not configured", { status: 503 })
  );
  const controlConfig: AgentExecutorControlConfig = {
    controlRpcBaseUrl: "https://control-rpc.example.internal",
    controlRpcToken: "control-rpc-token",
  };
  const payload = {
    runId: "run-2",
    workerId: "worker-2",
  };

  const result = await dispatchAgentExecutorStart(
    { startAndWaitForPorts, fetch } as AgentExecutorDispatchTarget,
    payload,
    controlConfig,
  );

  assertSpyCallArgs(startAndWaitForPorts, 0, [8080]);
  assertEquals(result, {
    ok: false,
    status: 503,
    body: "Proxy not configured",
  });
});

Deno.test("dispatchAgentExecutorStart - returns the container acceptance response to the caller", async () => {
  const dispatchStart = spy(async () => ({
    ok: true,
    status: 202,
    body: '{"status":"accepted","runId":"run-3"}',
  }));

  const response = await forwardAgentExecutorDispatch(
    { dispatchStart } as AgentExecutorDispatchStub,
    {
      runId: "run-3",
      workerId: "worker-3",
    },
  );

  assertSpyCallArgs(dispatchStart, 0, [{
    runId: "run-3",
    workerId: "worker-3",
  }]);
  assertEquals(response.status, 202);
  await assertEquals(
    await response.text(),
    '{"status":"accepted","runId":"run-3"}',
  );
});

Deno.test("dispatchAgentExecutorStart - turns startup exceptions into dispatch failures so the runner can retry", async () => {
  const dispatchStart = spy(async () => {
    throw new Error("boom");
  });

  const response = await forwardAgentExecutorDispatch(
    { dispatchStart } as AgentExecutorDispatchStub,
    {
      runId: "run-4",
      workerId: "worker-4",
    },
  );

  assertEquals(response.status, 500);
  await assertEquals(await response.json(), {
    error: "Failed to start container: boom",
  });
});
