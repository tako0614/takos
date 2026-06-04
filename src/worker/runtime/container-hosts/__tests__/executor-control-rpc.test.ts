import { test } from "bun:test";
import { assertEquals, assertFalse } from "@takos/test/assert";
import { readFile } from "node:fs/promises";
import { handleRunConfig, handleRunEvent } from "../executor-control-rpc.ts";

test("handleRunConfig emits current camelCase fields only", async () => {
  const response = await handleRunConfig(
    { agentType: "default" },
    { MAX_AGENT_ITERATIONS: "7", AGENT_RATE_LIMIT: "3" } as never,
  );
  const body = await response.json() as Record<string, unknown>;

  assertEquals(response.status, 200);
  assertEquals(body.agentType, "default");
  assertEquals(body.maxIterations, 7);
  assertEquals(body.maxGraphSteps, 7);
  assertEquals(body.maxToolRounds, 7);
  assertEquals(body.rateLimit, 3);

  for (
    const field of [
      "agent_type",
      "system_prompt",
      "max_iterations",
      "max_graph_steps",
      "max_tool_rounds",
      "rate_limit",
    ]
  ) {
    assertFalse(field in body, `${field} must not be emitted`);
  }
});

test("executor run-config source does not reintroduce snake_case response fields", async () => {
  for (
    const sourceFile of [
      {
        label: "../executor-control-rpc.ts",
        url: new URL("../executor-control-rpc.ts", import.meta.url),
      },
    ]
  ) {
    const source = await readFile(sourceFile.url, "utf8");
    for (
      const forbidden of [
        "agent_type:",
        "system_prompt:",
        "max_iterations:",
        "max_graph_steps:",
        "max_tool_rounds:",
        "rate_limit:",
      ]
    ) {
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
  const emittedBody = await emittedRequests[0].json() as Record<
    string,
    unknown
  >;
  assertEquals(
    emittedBody.dedup_key,
    `run:${body.runId}:sequence:${body.sequence}:type:${body.type}`,
  );
});
