import { test } from "bun:test";
import { assertEquals, assertFalse } from "@takos/test/assert";
import { readFile } from "node:fs/promises";
import { handleRunConfig, handleRunEvent } from "../executor-control-rpc.ts";

test("handleRunConfig emits current camelCase fields only", async () => {
  const response = await handleRunConfig({ agentType: "default" }, {
    TAKOS_AGENT_MAX_GRAPH_STEPS: "7",
    TAKOS_AGENT_MAX_TOOL_ROUNDS: "3",
  } as never);
  const body = (await response.json()) as Record<string, unknown>;

  assertEquals(response.status, 200);
  assertEquals(body.agentType, "default");
  assertEquals(body.maxGraphSteps, 7);
  assertEquals(body.maxToolRounds, 3);

  for (const field of [
    "agent_type",
    "system_prompt",
    "max_iterations",
    "max_graph_steps",
    "max_tool_rounds",
    "rate_limit",
    "maxIterations",
    "rateLimit",
    "tools",
    "embeddingProvider",
    "embeddingModel",
    "embeddingBaseUrl",
    "embeddingApiKey",
    "embeddingDimensions",
  ]) {
    assertFalse(field in body, `${field} must not be emitted`);
  }
});

test("handleRunConfig leaves engine defaults explicit when budgets are unset", async () => {
  const response = await handleRunConfig({ agentType: "default" }, {} as never);
  const body = (await response.json()) as Record<string, unknown>;

  assertEquals(response.status, 200);
  assertEquals(body.maxGraphSteps, null);
  assertEquals(body.maxToolRounds, null);
});

test("executor run-config source does not reintroduce snake_case response fields", async () => {
  for (const sourceFile of [
    {
      label: "../executor-control-rpc.ts",
      url: new URL("../executor-control-rpc.ts", import.meta.url),
    },
  ]) {
    const source = await readFile(sourceFile.url, "utf8");
    for (const forbidden of [
      "agent_type:",
      "system_prompt:",
      "max_iterations:",
      "max_graph_steps:",
      "max_tool_rounds:",
      "rate_limit:",
    ]) {
      assertFalse(
        source.includes(forbidden),
        `${sourceFile.label} contains ${forbidden}`,
      );
    }
  }
});

test("handleRunEvent deduplicates replayed run event sequence", async () => {
  const emittedRequests: Request[] = [];
  const env = {
    TAKOS_OFFLOAD: {},
    RUN_NOTIFIER: {
      idFromName(name: string) {
        return name;
      },
      get() {
        return {
          async fetch(request: Request) {
            emittedRequests.push(request);
            return Response.json({ ok: true });
          },
        };
      },
    },
  };
  const body = {
    runId: `run-dedup-${crypto.randomUUID()}`,
    type: "progress",
    sequence: 42,
    skipDb: true,
    data: { message: "halfway" },
  };

  const first = await handleRunEvent(body, env as never);
  const second = await handleRunEvent(body, env as never);

  assertEquals(first.status, 200);
  assertEquals(await first.json(), { success: true });
  assertEquals(second.status, 200);
  assertEquals(await second.json(), { success: true, duplicate: true });
  assertEquals(emittedRequests.length, 1);
  const emittedBody = (await emittedRequests[0].json()) as Record<
    string,
    unknown
  >;
  assertEquals(
    emittedBody.dedup_key,
    `run:${body.runId}:lease:local:sequence:${body.sequence}:type:${body.type}`,
  );
});

test("handleRunEvent keeps the same sequence from a fresh lease", async () => {
  const emittedRequests: Request[] = [];
  const env = {
    TAKOS_OFFLOAD: {},
    RUN_NOTIFIER: {
      idFromName(name: string) {
        return name;
      },
      get() {
        return {
          async fetch(request: Request) {
            emittedRequests.push(request);
            return Response.json({ ok: true });
          },
        };
      },
    },
  };
  const runId = `run-fresh-lease-${crypto.randomUUID()}`;
  const base = {
    runId,
    type: "started",
    sequence: 1,
    data: { message: "started" },
  };

  const oldLease = await handleRunEvent(
    { ...base, leaseVersion: 3 },
    env as never,
  );
  const freshLease = await handleRunEvent(
    { ...base, leaseVersion: 4 },
    env as never,
  );

  assertEquals(oldLease.status, 200);
  assertEquals(freshLease.status, 200);
  assertEquals(emittedRequests.length, 2);
  const keys = await Promise.all(
    emittedRequests.map(async (request) => {
      const payload = (await request.json()) as Record<string, unknown>;
      return payload.dedup_key;
    }),
  );
  assertEquals(keys, [
    `run:${runId}:lease:3:sequence:1:type:started`,
    `run:${runId}:lease:4:sequence:1:type:started`,
  ]);
});

test("handleRunEvent rejects unknown, oversized, and deeply nested payloads", async () => {
  const base = {
    runId: "run-bounded-event",
    type: "progress",
    sequence: 1,
  };
  const unknown = await handleRunEvent(
    { ...base, type: "arbitrary_internal_event", data: {} },
    {} as never,
  );
  assertEquals(unknown.status, 400);

  const oversized = await handleRunEvent(
    { ...base, data: { message: "x".repeat(65 * 1024) } },
    {} as never,
  );
  assertEquals(oversized.status, 413);

  let nested: Record<string, unknown> = {};
  for (let depth = 0; depth < 40; depth++) nested = { nested };
  const tooDeep = await handleRunEvent(
    { ...base, data: nested },
    {} as never,
  );
  assertEquals(tooDeep.status, 400);
});
