import type { D1Database, Queue, R2Bucket } from "@cloudflare/workers-types";
import type { Workflow } from "takos-actions-engine";

import { assert, assertEquals } from "jsr:@std/assert";
import { spy } from "jsr:@std/testing/mock";

import {
  evaluateDependencies,
  scheduleDependentJobs,
  workflowJobSchedulerDeps,
} from "@/services/execution/workflow-job-scheduler";

function buildDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;
  const updateCalls: Array<Record<string, unknown>> = [];

  return {
    updateCalls,
    select: () => {
      const result = selectResults[selectIdx++];
      return {
        from: () => ({
          where: () => ({
            get: async () => result,
            all: async () => Array.isArray(result) ? result : [],
          }),
          get: async () => result,
          all: async () => Array.isArray(result) ? result : [],
        }),
      };
    },
    update: () => ({
      set: (data: Record<string, unknown>) => {
        updateCalls.push(data);
        return {
          where: () => ({
            run: async () => undefined,
          }),
        };
      },
    }),
  };
}

function createQueueMock(): Queue<unknown> {
  return {
    send: spy(async () => undefined),
  } as unknown as Queue<unknown>;
}

function withSchedulerDeps<T>(
  overrides: Record<string, unknown>,
  fn: () => Promise<T>,
) {
  const previous = { ...workflowJobSchedulerDeps };
  Object.assign(workflowJobSchedulerDeps, overrides);
  return fn().finally(() => {
    Object.assign(workflowJobSchedulerDeps, previous);
  });
}

Deno.test("evaluateDependencies returns allSuccessful=false when a dependency failed", async () => {
  const drizzle = buildDrizzleMock([
    { status: "completed", conclusion: "failure" },
  ]);

  await withSchedulerDeps({ getDb: () => drizzle as never }, async () => {
    const result = await evaluateDependencies({} as D1Database, "run-1", [
      "job-a",
    ]);

    assertEquals(result.allCompleted, true);
    assertEquals(result.allSuccessful, false);
  });
});

Deno.test("scheduleDependentJobs skips downstream jobs when a prerequisite failed", async () => {
  const runRecord = {
    id: "run-1",
    repoId: "repo-1",
    workflowPath: ".takos/workflows/ci.yml",
    ref: "refs/heads/main",
    sha: "sha-1",
  };

  const drizzle = buildDrizzleMock([
    runRecord,
    { status: "completed", conclusion: "failure" },
    { id: "job-b-id" },
    runRecord,
  ]);

  const queue = createQueueMock();
  const parseWorkflowSpy = spy(() => ({
    workflow: {
      jobs: {
        jobA: { runsOn: "ubuntu-latest", steps: [] },
        jobC: { runsOn: "ubuntu-latest", steps: [] },
        jobB: { runsOn: "ubuntu-latest", needs: ["jobA", "jobC"], steps: [] },
      },
    } as unknown as Workflow,
    diagnostics: [],
  }));

  await withSchedulerDeps(
    {
      getDb: () => drizzle as never,
      parseWorkflow: parseWorkflowSpy as never,
      resolveRef: async () => "sha-1",
      getCommitData: async () => ({ tree: "tree-1" }),
      getBlobAtPath: async () => new TextEncoder().encode("name: ci"),
      getSecretIds: async () => [],
      finalizeRunIfComplete: async () => undefined,
      enqueueJob: async () => undefined,
    },
    async () => {
      await scheduleDependentJobs(
        {} as D1Database,
        {} as R2Bucket,
        queue as unknown as Queue<{ type: "job" }>,
        "run-1",
        "jobC",
      );
    },
  );

  assert(
    drizzle.updateCalls.some((call) =>
      JSON.stringify(call).includes('"conclusion":"skipped"')
    ),
  );
  assertEquals((queue.send as { calls: unknown[] }).calls.length, 0);
  assert(parseWorkflowSpy.calls.length >= 1);
});
