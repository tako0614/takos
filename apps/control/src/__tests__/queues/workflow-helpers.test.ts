import type { D1Database } from "@cloudflare/workers-types";

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { spy } from "jsr:@std/testing/mock";

import {
  buildSkippedWorkflowStepResultsFromDb,
  failJobWithResults,
  getRunContext,
  getRunStatus,
  getSpaceIdFromRepoId,
  getStepDisplayName,
  markJobFailed,
  markJobSkipped,
  runtimeDelete,
  runtimeJson,
} from "@/queues/workflow-runtime-client";
import type { WorkflowQueueEnv } from "@/queues/workflow-types";

type FakeQuery = {
  rows?: unknown;
  first?: unknown;
  runChanges?: number;
};

function createFakeD1(queries: FakeQuery[] = []) {
  const pending = [...queries];
  const prepareCalls: string[] = [];
  const db = {
    prepare(sql: string) {
      prepareCalls.push(sql);
      const query = pending.shift() ?? {};
      return {
        bind(..._args: unknown[]) {
          return {
            raw: async () => query.rows ?? [],
            first: async () => query.first ?? null,
            all: async () => ({ results: query.rows ?? [] }),
            run: async () => ({
              success: true,
              meta: { changes: query.runChanges ?? 1 },
            }),
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, prepareCalls };
}

function _createEnv(
  overrides: Partial<WorkflowQueueEnv> = {},
): WorkflowQueueEnv {
  const fetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );

  return {
    DB: createFakeD1().db,
    GIT_OBJECTS: {} as WorkflowQueueEnv["GIT_OBJECTS"],
    RUN_NOTIFIER: {} as WorkflowQueueEnv["RUN_NOTIFIER"],
    RUNTIME_HOST: { fetch },
    ...overrides,
  } as WorkflowQueueEnv;
}

Deno.test("runtimeJson - sends a POST request with space_id and parses JSON", async () => {
  const fetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({ result: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  const env = {
    DB: createFakeD1().db,
    RUN_NOTIFIER: {} as WorkflowQueueEnv["RUN_NOTIFIER"],
    RUNTIME_HOST: { fetch },
  } as WorkflowQueueEnv;

  const result = await runtimeJson(env, "/test/endpoint", "space-1", {
    key: "value",
  });

  assertEquals(result, { result: "ok" });
  const request = fetch.calls[0]?.args[0] as Request;
  assertEquals(request.method, "POST");
  assertEquals(request.url, "https://runtime-host/test/endpoint");
  assertEquals(request.headers.get("X-Takos-Internal"), "1");
  assertEquals(await request.json(), {
    key: "value",
    space_id: "space-1",
  });
});

Deno.test("runtimeJson - uses the specified HTTP method", async () => {
  const fetch = spy(async (_request: Request) =>
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  const env = {
    DB: createFakeD1().db,
    RUN_NOTIFIER: {} as WorkflowQueueEnv["RUN_NOTIFIER"],
    RUNTIME_HOST: { fetch },
  } as WorkflowQueueEnv;

  await runtimeJson(env, "/endpoint", "space-1", {}, "PUT");

  assertEquals(fetch.calls[0]?.args[0] instanceof Request, true);
  assertEquals((fetch.calls[0]?.args[0] as Request).method, "PUT");
});

Deno.test("runtimeJson - throws when response is not ok", async () => {
  const env = {
    DB: createFakeD1().db,
    RUN_NOTIFIER: {} as WorkflowQueueEnv["RUN_NOTIFIER"],
    RUNTIME_HOST: {
      fetch: async () =>
        new Response("server error", { status: 500, statusText: "Error" }),
    },
  } as WorkflowQueueEnv;

  await assertRejects(
    () => runtimeJson(env, "/endpoint", "space-1"),
    Error,
    "Runtime request failed (500): server error",
  );
});

Deno.test("runtimeDelete - swallows 404s and failures", async () => {
  const fetch404 = spy(async () => new Response("", { status: 404 }));
  const fetch500 = spy(async () => new Response("fail", { status: 500 }));
  const env404 = {
    DB: createFakeD1().db,
    RUN_NOTIFIER: {} as WorkflowQueueEnv["RUN_NOTIFIER"],
    RUNTIME_HOST: { fetch: fetch404 },
  } as WorkflowQueueEnv;
  const env500 = {
    DB: createFakeD1().db,
    RUN_NOTIFIER: {} as WorkflowQueueEnv["RUN_NOTIFIER"],
    RUNTIME_HOST: { fetch: fetch500 },
  } as WorkflowQueueEnv;

  await runtimeDelete(env404, "/endpoint", "space-1");
  await runtimeDelete(env500, "/endpoint", "space-1");

  assertEquals(fetch404.calls.length, 1);
  assertEquals(fetch500.calls.length, 1);
});

Deno.test("getStepDisplayName - prefers explicit names and falls back cleanly", () => {
  assertEquals(getStepDisplayName({ name: "Build" } as any, 1), "Build");
  assertEquals(
    getStepDisplayName({ uses: "actions/checkout@v4" } as any, 1),
    "actions/checkout@v4",
  );
  assertEquals(getStepDisplayName({ run: "echo ok" } as any, 1), "echo ok");
  assertEquals(getStepDisplayName({} as any, 3), "Step 3");
});

Deno.test("getRunContext - returns workflow path and parsed inputs", async () => {
  const { db } = createFakeD1([
    {
      rows: [[".takos/workflows/ci.yml", '{"env":"prod"}']],
    },
  ]);

  const result = await getRunContext(db, "run-1");

  assertEquals(result.workflowPath, ".takos/workflows/ci.yml");
  assertEquals(result.inputs, { env: "prod" });
});

Deno.test("getRunStatus - returns the run status", async () => {
  const { db } = createFakeD1([
    {
      rows: [["running"]],
    },
  ]);

  const result = await getRunStatus(db, "run-1");
  assertEquals(result, "running");
});

Deno.test("getSpaceIdFromRepoId - returns the repository accountId", async () => {
  const { db } = createFakeD1([
    {
      rows: [["ws-123"]],
    },
  ]);

  const result = await getSpaceIdFromRepoId(db, "repo-1");
  assertEquals(result, "ws-123");
});

Deno.test("markJobSkipped - updates both job and step records", async () => {
  const { db, prepareCalls } = createFakeD1([
    { runChanges: 1 },
    { runChanges: 1 },
  ]);

  await markJobSkipped(db, "job-1", "2024-01-01T00:00:00Z");

  assertEquals(prepareCalls.length, 2);
  assertStringIncludes(prepareCalls[0].toLowerCase(), '"workflow_jobs"');
  assertStringIncludes(prepareCalls[1].toLowerCase(), '"workflow_steps"');
});

Deno.test("buildSkippedWorkflowStepResultsFromDb - returns results from DB rows", async () => {
  const { db } = createFakeD1([
    {
      rows: [
        [1, "Build"],
        [2, "Test"],
      ],
    },
  ]);

  const results = await buildSkippedWorkflowStepResultsFromDb(
    db,
    "job-1",
    "fallback",
  );

  assertEquals(results[0], {
    stepNumber: 1,
    name: "Build",
    status: "skipped",
    conclusion: "skipped",
    error: undefined,
    outputs: {},
  });
  assertEquals(results[1], {
    stepNumber: 2,
    name: "Test",
    status: "skipped",
    conclusion: "skipped",
    error: undefined,
    outputs: {},
  });
});

Deno.test("buildSkippedWorkflowStepResultsFromDb - uses the first error only once", async () => {
  const { db } = createFakeD1([
    {
      rows: [
        [1, "Step 1"],
        [2, "Step 2"],
      ],
    },
  ]);

  const results = await buildSkippedWorkflowStepResultsFromDb(
    db,
    "job-1",
    "fallback",
    "Something broke",
  );

  assertEquals(results[0].error, "Something broke");
  assertEquals(results[1].error, undefined);
});

Deno.test("buildSkippedWorkflowStepResultsFromDb - returns a fallback when no rows exist", async () => {
  const { db } = createFakeD1([
    { rows: [] },
  ]);

  const results = await buildSkippedWorkflowStepResultsFromDb(
    db,
    "job-1",
    "fallback-name",
    "error msg",
  );

  assertEquals(results, [{
    stepNumber: 1,
    name: "fallback-name",
    status: "skipped",
    conclusion: "skipped",
    error: "error msg",
    outputs: {},
  }]);
});

Deno.test("failJobWithResults - calls engine.onJobComplete with failure conclusion", async () => {
  const engine = {
    onJobComplete: spy(async () => undefined),
  };

  const stepResults = [{
    stepNumber: 1,
    name: "step",
    status: "skipped" as const,
    conclusion: "skipped" as const,
    outputs: {},
  }];

  await failJobWithResults(
    engine as any,
    "job-1",
    stepResults,
    "2024-01-01T00:00:00Z",
  );

  assertEquals(engine.onJobComplete.calls.length, 1);
  const call = engine.onJobComplete.calls[0] as any;
  assertEquals(call.args[0], "job-1");
});

Deno.test("markJobFailed - updates the run record to failure", async () => {
  const { db, prepareCalls } = createFakeD1([
    { runChanges: 1 },
  ]);

  await markJobFailed(db, "job-1", "2024-01-01T00:00:00Z");

  assertEquals(prepareCalls.length, 1);
  assertStringIncludes(prepareCalls[0].toLowerCase(), '"workflow_jobs"');
});
