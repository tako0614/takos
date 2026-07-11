import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { dispatchAgentExecutorStart } from "../executor-dispatch.ts";

test("per-run control URL wins over a stale container host URL", async () => {
  let startPayload: Record<string, unknown> | undefined;

  const result = await dispatchAgentExecutorStart(
    {
      async startAndWaitForPorts() {},
      async fetch(request) {
        startPayload = await request.json() as Record<string, unknown>;
        return Response.json({ ok: true });
      },
    },
    {
      runId: "run_1",
      workerId: "worker_1",
      serviceId: "service_1",
      controlRpcBaseUrl: "https://current.example",
    },
    {
      controlRpcBaseUrl: "https://stale.example",
      controlRpcToken: "fresh-run-token",
    },
  );

  assertEquals(result.ok, true);
  assertEquals(startPayload?.controlRpcBaseUrl, "https://current.example");
  assertEquals(startPayload?.controlRpcToken, "fresh-run-token");
});

test("container host control URL remains the fallback", async () => {
  let startPayload: Record<string, unknown> | undefined;

  await dispatchAgentExecutorStart(
    {
      async startAndWaitForPorts() {},
      async fetch(request) {
        startPayload = await request.json() as Record<string, unknown>;
        return Response.json({ ok: true });
      },
    },
    {
      runId: "run_1",
      workerId: "worker_1",
      serviceId: "service_1",
    },
    {
      controlRpcBaseUrl: "https://fallback.example",
      controlRpcToken: "fresh-run-token",
    },
  );

  assertEquals(startPayload?.controlRpcBaseUrl, "https://fallback.example");
});
