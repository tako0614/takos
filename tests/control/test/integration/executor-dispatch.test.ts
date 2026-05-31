import { strict as assert } from "node:assert";
import { mock, test } from "bun:test";
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

test("dispatchAgentExecutorStart - keeps only TAKOS_AGENT_CONTROL_RPC_BASE_URL in container env vars", () => {
  assert.deepStrictEqual(
    buildAgentExecutorContainerEnvVars({
      TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
    }),
    {
      TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
    },
  );
});

test("dispatchAgentExecutorStart - allows an empty TAKOS_AGENT_CONTROL_RPC_BASE_URL for adapter-owned resolution", () => {
  assert.deepStrictEqual(
    buildAgentExecutorContainerEnvVars({
      TAKOS_AGENT_CONTROL_RPC_BASE_URL: undefined,
    }),
    {
      TAKOS_AGENT_CONTROL_RPC_BASE_URL: "",
    },
  );
});

test("dispatchAgentExecutorStart - generates a random control RPC token (not JWT)", () => {
  const controlConfig = buildAgentExecutorProxyConfig({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
  });

  assert.ok(controlConfig.controlRpcToken);
  assert.deepStrictEqual(
    controlConfig.controlRpcBaseUrl,
    "https://control-rpc.example.internal",
  );
  assert.ok(controlConfig.controlRpcToken.length > 20);
});

test("dispatchAgentExecutorStart - generateProxyToken returns base64url without padding", () => {
  const token = generateProxyToken();
  assert.ok(/^[A-Za-z0-9_-]+$/.test(token));
  assert.ok(token.length > 20);
});

test("dispatchAgentExecutorStart - forwards only canonical control RPC fields through the /start payload", async () => {
  const startAndWaitForPorts = mock(async () => undefined);
  const fetch = mock(async (_request: Request) =>
    new Response('{"status":"accepted","runId":"run-secret"}', { status: 202 })
  );
  const controlConfig = buildAgentExecutorProxyConfig({
    TAKOS_AGENT_CONTROL_RPC_BASE_URL: "https://control-rpc.example.internal",
  });

  await dispatchAgentExecutorStart(
    { startAndWaitForPorts, fetch } as AgentExecutorDispatchTarget,
    {
      runId: "run-secret",
      serviceId: "worker-secret",
      workerId: "worker-secret",
    },
    controlConfig,
  );

  assert.deepStrictEqual(startAndWaitForPorts.mock.calls.length, 1);
  const request = fetch.mock.calls[0]![0] as Request;
  const payload = await request.json() as Record<string, unknown>;
  assert.deepStrictEqual(payload.controlRpcBaseUrl, controlConfig.controlRpcBaseUrl);
  assert.ok(payload.controlRpcToken);
});

test("dispatchAgentExecutorStart - waits for port 8080 and posts the start payload inside the container DO", async () => {
  const startAndWaitForPorts = mock(async () => undefined);
  const fetch = mock(async (_request: Request) =>
    new Response('{"status":"accepted","runId":"run-1"}', { status: 202 })
  );
  const controlConfig: AgentExecutorControlConfig = {
    controlRpcBaseUrl: "https://control-rpc.example.internal",
    controlRpcToken: "control-rpc-token",
  };
  const payload = {
    runId: "run-1",
    serviceId: "worker-1",
    workerId: "worker-1",
    model: "gpt-5-mini",
  };

  const result = await dispatchAgentExecutorStart(
    { startAndWaitForPorts, fetch } as AgentExecutorDispatchTarget,
    payload,
    controlConfig,
  );

  assert.deepStrictEqual(startAndWaitForPorts.mock.calls[0], [8080]);
  assert.deepStrictEqual(fetch.mock.calls.length, 1);

  const request = fetch.mock.calls[0]![0] as Request;
  assert.deepStrictEqual(request.url, "https://executor/start");
  assert.deepStrictEqual(request.method, "POST");
  assert.deepStrictEqual(request.headers.get("Content-Type"), "application/json");
  assert.deepStrictEqual(await request.json(), {
    ...payload,
    serviceId: "worker-1",
    ...controlConfig,
  });

  assert.deepStrictEqual(result, {
    ok: true,
    status: 202,
    body: '{"status":"accepted","runId":"run-1"}',
  });
});

test("dispatchAgentExecutorStart - preserves non-2xx start failures for host-side logging", async () => {
  const startAndWaitForPorts = mock(async () => undefined);
  const fetch = mock(async (_request: Request) =>
    new Response("Proxy not configured", { status: 503 })
  );
  const controlConfig: AgentExecutorControlConfig = {
    controlRpcBaseUrl: "https://control-rpc.example.internal",
    controlRpcToken: "control-rpc-token",
  };
  const payload = {
    runId: "run-2",
    serviceId: "worker-2",
    workerId: "worker-2",
  };

  const result = await dispatchAgentExecutorStart(
    { startAndWaitForPorts, fetch } as AgentExecutorDispatchTarget,
    payload,
    controlConfig,
  );

  assert.deepStrictEqual(startAndWaitForPorts.mock.calls[0], [8080]);
  assert.deepStrictEqual(result, {
    ok: false,
    status: 503,
    body: "Proxy not configured",
  });
});

test("dispatchAgentExecutorStart - returns the container acceptance response to the caller", async () => {
  const dispatchStart = mock(async () => ({
    ok: true,
    status: 202,
    body: '{"status":"accepted","runId":"run-3"}',
  }));

  const response = await forwardAgentExecutorDispatch(
    { dispatchStart } as AgentExecutorDispatchStub,
    {
      runId: "run-3",
      serviceId: "worker-3",
      workerId: "worker-3",
    },
  );

  assert.deepStrictEqual(dispatchStart.mock.calls[0], [{
    runId: "run-3",
    serviceId: "worker-3",
    workerId: "worker-3",
  }]);
  assert.deepStrictEqual(response.status, 202);
  assert.deepStrictEqual(
    await response.text(),
    '{"status":"accepted","runId":"run-3"}',
  );
});

test("dispatchAgentExecutorStart - turns startup exceptions into dispatch failures so the runner can retry", async () => {
  const dispatchStart = mock(async () => {
    throw new Error("boom");
  });

  const response = await forwardAgentExecutorDispatch(
    { dispatchStart } as AgentExecutorDispatchStub,
    {
      runId: "run-4",
      serviceId: "worker-4",
      workerId: "worker-4",
    },
  );

  assert.deepStrictEqual(response.status, 500);
  assert.deepStrictEqual(await response.json(), {
    error: "Failed to start container: boom",
  });
});
