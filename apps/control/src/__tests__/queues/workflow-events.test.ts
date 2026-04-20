import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import { emitWorkflowEvent } from "@/queues/workflow-events";
import type { WorkflowQueueEnv } from "@/queues/workflow-types";

function createRunNotifier() {
  const fetchSpy = spy(async (_request: Request) =>
    new Response(null, { status: 204 })
  );
  const getSpy = spy((_id: unknown) => ({ fetch: fetchSpy }));
  const idFromNameSpy = spy((name: string) => `id:${name}`);

  return {
    fetchSpy,
    getSpy,
    idFromNameSpy,
    namespace: {
      idFromName: idFromNameSpy,
      get: getSpy,
    } as WorkflowQueueEnv["RUN_NOTIFIER"],
  };
}

function createEnv(
  overrides: Partial<WorkflowQueueEnv> = {},
): WorkflowQueueEnv {
  const { namespace } = createRunNotifier();

  return {
    DB: {} as WorkflowQueueEnv["DB"],
    RUN_NOTIFIER: namespace,
    ...overrides,
  } as WorkflowQueueEnv;
}

Deno.test("emitWorkflowEvent - sends a notifier request with the serialized payload", async () => {
  const notifier = createRunNotifier();
  const env = createEnv({ RUN_NOTIFIER: notifier.namespace });

  await emitWorkflowEvent(env, "run-1", "workflow.job.started", {
    runId: "run-1",
    jobId: "job-1",
    repoId: "repo-1",
    jobKey: "build",
    name: "Build",
    startedAt: "2026-04-01T00:00:00.000Z",
  });

  assertSpyCalls(notifier.idFromNameSpy, 1);
  assertSpyCalls(notifier.getSpy, 1);
  assertSpyCalls(notifier.fetchSpy, 1);
  assertEquals(notifier.idFromNameSpy.calls[0]?.args[0], "run-1");
  assertEquals(notifier.getSpy.calls[0]?.args[0], "id:run-1");

  const request = notifier.fetchSpy.calls[0]?.args[0] as Request | undefined;
  assertEquals(request?.url, "https://internal.do/emit");
  assertEquals(request?.method, "POST");
  assertEquals(request?.headers.get("X-Takos-Internal-Marker"), "1");
  assertEquals(request?.headers.get("Content-Type"), "application/json");
  assertEquals(await request?.json(), {
    runId: "run-1",
    type: "workflow.job.started",
    data: {
      runId: "run-1",
      jobId: "job-1",
      repoId: "repo-1",
      jobKey: "build",
      name: "Build",
      startedAt: "2026-04-01T00:00:00.000Z",
    },
  });
});

Deno.test("emitWorkflowEvent - swallows notifier fetch failures", async () => {
  const fetchSpy = spy(async (_request: Request) => {
    throw new Error("notifier down");
  });
  const env = createEnv({
    RUN_NOTIFIER: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: fetchSpy }),
    } as WorkflowQueueEnv["RUN_NOTIFIER"],
  });

  assertEquals(
    await emitWorkflowEvent(env, "run-1", "workflow.job.completed", {
      runId: "run-1",
      jobId: "job-1",
      repoId: "repo-1",
      jobKey: "build",
      status: "completed",
      conclusion: "failure",
      completedAt: "2026-04-01T00:00:00.000Z",
    }),
    undefined,
  );
  assertSpyCalls(fetchSpy, 1);
});

Deno.test("emitWorkflowEvent - swallows namespace lookup failures", async () => {
  const env = createEnv({
    RUN_NOTIFIER: {
      idFromName: () => {
        throw new Error("missing notifier");
      },
      get: () => {
        throw new Error("unreachable");
      },
    } as WorkflowQueueEnv["RUN_NOTIFIER"],
  });

  assertEquals(
    await emitWorkflowEvent(env, "run-1", "workflow.job.completed", {
      runId: "run-1",
      jobId: "job-1",
      repoId: "repo-1",
      jobKey: "build",
      status: "completed",
      conclusion: "success",
      completedAt: "2026-04-01T00:00:00.000Z",
    }),
    undefined,
  );
});
