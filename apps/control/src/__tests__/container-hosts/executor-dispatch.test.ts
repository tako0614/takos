import {
  dispatchAgentExecutorStart,
  forwardAgentExecutorDispatch,
} from "@/container-hosts/executor-dispatch";
import type {
  AgentExecutorControlConfig,
  AgentExecutorDispatchPayload,
  AgentExecutorDispatchStub,
  AgentExecutorDispatchTarget,
} from "@/container-hosts/executor-dispatch";

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, spy } from "jsr:@std/testing/mock";

Deno.test(
  "dispatchAgentExecutorStart - starts container, waits for ports, then dispatches start",
  async () => {
    const startAndWaitForPorts = spy(async (_port: number) => undefined);
    const fetchFn = spy(async (_request: Request) =>
      new Response('{"status":"started"}', { status: 200 })
    );

    const target: AgentExecutorDispatchTarget = {
      startAndWaitForPorts,
      fetch: fetchFn,
    };

    const body: AgentExecutorDispatchPayload = {
      runId: "run-1",
      workerId: "worker-1",
      model: "gpt-4",
    };

    const controlConfig: AgentExecutorControlConfig = {
      controlRpcBaseUrl: "https://control.internal",
      controlRpcToken: "token-abc",
    };

    const result = await dispatchAgentExecutorStart(
      target,
      body,
      controlConfig,
    );

    assertSpyCallArgs(startAndWaitForPorts, 0, [8080]);
    assertSpyCalls(fetchFn, 1);

    const requestArg = fetchFn.calls[0]?.args[0] as Request;
    assertEquals(requestArg.url, "https://executor/start");
    assertEquals(requestArg.method, "POST");

    const sentBody = JSON.parse(await requestArg.text());
    assertEquals(sentBody.runId, "run-1");
    assertEquals(sentBody.workerId, "worker-1");
    assertEquals(sentBody.model, "gpt-4");
    assertEquals(sentBody.controlRpcBaseUrl, "https://control.internal");
    assertEquals(sentBody.controlRpcToken, "token-abc");

    assertEquals(result.ok, true);
    assertEquals(result.status, 200);
    assertEquals(result.body, '{"status":"started"}');
  },
);

Deno.test(
  "dispatchAgentExecutorStart - returns error result when container returns non-ok response",
  async () => {
    const target: AgentExecutorDispatchTarget = {
      startAndWaitForPorts: spy(async (_port: number) => undefined),
      fetch: spy(async (_request: Request) =>
        new Response('{"error":"failed to start"}', { status: 500 })
      ),
    };

    const result = await dispatchAgentExecutorStart(
      target,
      { runId: "run-1", workerId: "worker-1" },
      { controlRpcToken: "token" },
    );

    assertEquals(result.ok, false);
    assertEquals(result.status, 500);
    assertStringIncludes(result.body, "failed to start");
  },
);

Deno.test(
  "dispatchAgentExecutorStart - includes leaseVersion when provided",
  async () => {
    const fetchFn = spy(async (_request: Request) =>
      new Response("ok", { status: 200 })
    );
    const target: AgentExecutorDispatchTarget = {
      startAndWaitForPorts: spy(async (_port: number) => undefined),
      fetch: fetchFn,
    };

    await dispatchAgentExecutorStart(
      target,
      { runId: "run-1", workerId: "worker-1", leaseVersion: 3 },
      { controlRpcToken: "token" },
    );

    const sentBody = JSON.parse(
      await ((fetchFn.calls[0]?.args[0] as Request).text()),
    );
    assertEquals(sentBody.leaseVersion, 3);
  },
);

Deno.test(
  "forwardAgentExecutorDispatch - forwards dispatch and returns response",
  async () => {
    const stub: AgentExecutorDispatchStub = {
      dispatchStart: async () => ({
        ok: true,
        status: 200,
        body: '{"dispatched":true}',
      }),
    };

    const response = await forwardAgentExecutorDispatch(stub, {
      runId: "run-1",
      workerId: "worker-1",
    });

    assertEquals(response.status, 200);
    const body = await response.text();
    assertEquals(body, '{"dispatched":true}');
  },
);

Deno.test(
  "forwardAgentExecutorDispatch - returns 500 response when dispatch throws",
  async () => {
    const stub: AgentExecutorDispatchStub = {
      dispatchStart: async () => {
        throw new Error("Container startup failed");
      },
    };

    const response = await forwardAgentExecutorDispatch(stub, {
      runId: "run-1",
      workerId: "worker-1",
    });

    assertEquals(response.status, 500);
    const body = await response.json() as { error: string };
    assertStringIncludes(body.error, "Failed to start container");
    assertStringIncludes(body.error, "Container startup failed");
  },
);

Deno.test(
  "forwardAgentExecutorDispatch - handles non-Error throw values",
  async () => {
    const stub: AgentExecutorDispatchStub = {
      dispatchStart: async () => {
        throw "string error";
      },
    };

    const response = await forwardAgentExecutorDispatch(stub, {
      runId: "run-1",
      workerId: "worker-1",
    });

    assertEquals(response.status, 500);
    const body = await response.json() as { error: string };
    assertStringIncludes(body.error, "string error");
  },
);
