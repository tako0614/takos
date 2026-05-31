import type { MessageQueueBinding } from "@/shared/types/bindings.ts";
import type { Workflow } from "takos-actions-engine";

import { assert, assertEquals } from "@std/assert";
import { spy } from "@std/testing/mock";

import {
  evaluateDependencies,
  scheduleDependentJobs,
  workflowJobSchedulerDeps,
} from "@/services/execution/workflow-job-scheduler";
import {
  noopMessageQueueBinding,
  noopObjectStoreBinding,
  noopSqlDatabaseBinding,
} from "@test/binding-stubs";

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

type QueueMock<T> = MessageQueueBinding<T> & {
  send: MessageQueueBinding<T>["send"] & { calls: { args: unknown[] }[] };
};

function createQueueMock<T = unknown>(): QueueMock<T> {
  const sendSpy = spy((_message: T) => Promise.resolve());
  return {
    ...noopMessageQueueBinding<T>(),
    send: sendSpy as QueueMock<T>["send"],
  };
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
    const result = await evaluateDependencies(
      noopSqlDatabaseBinding(),
      "run-1",
      [
        "job-a",
      ],
    );

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

  const queue = createQueueMock<{ type: "job" }>();
  const parseWorkflowSpy = spy(() => ({
    workflow: {
      on: [] as string[],
      jobs: {
        jobA: { "runs-on": "ubuntu-latest", steps: [] },
        jobC: { "runs-on": "ubuntu-latest", steps: [] },
        jobB: {
          "runs-on": "ubuntu-latest",
          needs: ["jobA", "jobC"],
          steps: [],
        },
      },
    } satisfies Workflow,
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
        noopSqlDatabaseBinding(),
        noopObjectStoreBinding(),
        queue,
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
  assertEquals(queue.send.calls.length, 0);
  assert(parseWorkflowSpy.calls.length >= 1);
});
