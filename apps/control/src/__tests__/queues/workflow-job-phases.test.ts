import type { D1Database } from "@cloudflare/workers-types";

import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, spy } from "jsr:@std/testing/mock";

import {
  completeJobFailure,
  completeJobSuccess,
  executeStepLoop,
  handleJobSkipped,
} from "@/queues/workflow-job-phases";
import {
  createInitialState,
  type JobQueueContext,
  type WorkflowQueueEnv,
} from "@/queues/workflow-types";
import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  type WorkflowJobQueueMessage,
} from "@/types";

type QueryRow = Record<string, unknown> | null;

function createWorkflowMessage(
  overrides: Partial<WorkflowJobQueueMessage> = {},
): WorkflowJobQueueMessage {
  return {
    version: WORKFLOW_QUEUE_MESSAGE_VERSION,
    type: "job",
    runId: "run-1",
    jobId: "job-1",
    repoId: "repo-1",
    ref: "refs/heads/main",
    sha: "a".repeat(40),
    jobKey: "build",
    jobDefinition: {
      name: "Build",
      "runs-on": "ubuntu-latest",
      steps: [{ run: "echo ok" }],
    },
    env: { CI: "true" },
    secretIds: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function createFakeD1(selectRows: QueryRow[] = []) {
  const pendingSelectRows = [...selectRows];

  return {
    db: {
      prepare(sql: string) {
        const normalized = sql.trim().toLowerCase();
        const row = normalized.startsWith("select")
          ? pendingSelectRows.shift() ?? null
          : null;

        return {
          bind(..._args: unknown[]) {
            return {
              raw: async () => (row ? [Object.values(row)] : []),
              first: async () => row,
              all: async () => ({ results: row ? [row] : [] }),
              run: async () => ({
                success: true,
                meta: { changes: 1 },
              }),
            };
          },
        };
      },
    } as unknown as D1Database,
  };
}

function createRunNotifier() {
  const fetchSpy = spy(async (_request: Request) =>
    new Response(null, { status: 204 })
  );

  return {
    fetchSpy,
    namespace: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: fetchSpy }),
    } as WorkflowQueueEnv["RUN_NOTIFIER"],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createRuntimeHost(
  responder: (request: Request) => Response | Promise<Response>,
) {
  const fetchSpy = spy((request: Request) =>
    Promise.resolve(responder(request))
  );

  return {
    fetchSpy,
    host: {
      fetch: fetchSpy,
    } as NonNullable<WorkflowQueueEnv["RUNTIME_HOST"]>,
  };
}

function createEngine(overrides: Record<string, unknown> = {}) {
  return {
    startRun: spy(async (_options: unknown) => ({ id: "run-1" })),
    enqueueJob: spy(async (_options: unknown) => undefined),
    onJobStart: spy(
      async (
        _jobId: string,
        _runnerId?: string,
        _runnerName?: string,
      ) => undefined,
    ),
    onJobComplete: spy(
      async (_jobId: string, _result: unknown) => undefined,
    ),
    updateStepStatus: spy(
      async (
        _jobId: string,
        _stepNumber: number,
        _status: string,
        _conclusion?: string,
        _exitCode?: number,
        _error?: string,
      ) => undefined,
    ),
    storeJobLogs: spy(async (_jobId: string, _logs: string) => "artifact-1"),
    cancelRun: spy(async (_runId: string) => undefined),
    createArtifact: spy(async (_options: unknown) => ({
      id: "artifact-1",
      r2Key: "artifact-1",
    })),
    ...overrides,
  };
}

function createJobQueueContext(
  overrides: Partial<Omit<JobQueueContext, "engine">> & {
    engine?: ReturnType<typeof createEngine>;
  } = {},
) {
  const { db } = createFakeD1();
  const { namespace } = createRunNotifier();
  const { host } = createRuntimeHost(() =>
    jsonResponse({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      outputs: {},
      conclusion: "success",
    })
  );

  return {
    env: {
      DB: db,
      RUN_NOTIFIER: namespace,
      RUNTIME_HOST: host,
    } as WorkflowQueueEnv,
    engine: createEngine() as unknown as JobQueueContext["engine"],
    message: createWorkflowMessage(),
    jobName: "Build",
    effectiveJobEnv: { CI: "true" },
    startedAt: "2026-04-01T00:00:00.000Z",
    runContext: {
      workflowPath: ".takos/workflows/ci.yml",
      inputs: {},
    },
    runtimeConfigured: true,
    ...overrides,
  } as JobQueueContext;
}

Deno.test("handleJobSkipped - returns false when the job has no condition", async () => {
  const engine = createEngine();
  const ctx = createJobQueueContext({ engine });
  const state = createInitialState();

  const skipped = await handleJobSkipped(ctx, state);

  assertEquals(skipped, false);
  assertSpyCalls(engine.storeJobLogs, 0);
  assertSpyCalls(engine.onJobComplete, 0);
});

Deno.test("handleJobSkipped - completes the job when the condition evaluates to false", async () => {
  const engine = createEngine();
  const ctx = createJobQueueContext({
    engine,
    effectiveJobEnv: {},
    message: createWorkflowMessage({
      jobDefinition: {
        name: "Build",
        "runs-on": "ubuntu-latest",
        if: "${{ env.SHOULD_RUN }}",
        steps: [
          { name: "Step 1", run: "echo 1" },
          { name: "Step 2", run: "echo 2" },
        ],
      },
    }),
  });
  const state = createInitialState();

  const skipped = await handleJobSkipped(ctx, state);

  assertEquals(skipped, true);
  assertEquals(state.jobConclusion, "skipped");
  assertStringIncludes(
    state.logs.join("\n"),
    "Job skipped (condition not met): ${{ env.SHOULD_RUN }}",
  );
  assertSpyCalls(engine.storeJobLogs, 1);
  assertSpyCalls(engine.onJobComplete, 1);
  const skippedResult = engine.onJobComplete.calls[0]?.args[1] as
    | Record<string, unknown>
    | undefined;
  assertEquals(skippedResult?.jobId, "job-1");
  assertEquals(skippedResult?.status, "completed");
  assertEquals(skippedResult?.conclusion, "skipped");
  assertEquals(skippedResult?.outputs, {});
  assertEquals(skippedResult?.startedAt, "2026-04-01T00:00:00.000Z");
  assertEquals(
    skippedResult?.stepResults,
    [
      {
        stepNumber: 1,
        name: "Step 1",
        status: "skipped",
        conclusion: "skipped",
        outputs: {},
      },
      {
        stepNumber: 2,
        name: "Step 2",
        status: "skipped",
        conclusion: "skipped",
        outputs: {},
      },
    ],
  );
  assertEquals(typeof skippedResult?.completedAt, "string");
});

Deno.test("executeStepLoop - runs each step through the runtime host", async () => {
  const { db } = createFakeD1([
    { status: "running" },
    { status: "running" },
  ]);
  const { namespace } = createRunNotifier();
  const { fetchSpy, host } = createRuntimeHost((request) => {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/step/1")) {
      return jsonResponse({
        exitCode: 0,
        stdout: "step-1",
        stderr: "",
        outputs: { version: "1.0.0" },
        conclusion: "success",
      });
    }

    return jsonResponse({
      exitCode: 0,
      stdout: "step-2",
      stderr: "",
      outputs: {},
      conclusion: "success",
    });
  });
  const engine = createEngine();
  const ctx = createJobQueueContext({
    env: {
      DB: db,
      RUN_NOTIFIER: namespace,
      RUNTIME_HOST: host,
    } as WorkflowQueueEnv,
    engine,
    message: createWorkflowMessage({
      jobDefinition: {
        name: "Build",
        "runs-on": "ubuntu-latest",
        steps: [
          { id: "build", name: "Build", run: "echo build" },
          { name: "Test", run: "echo test" },
        ],
      },
    }),
  });
  const state = createInitialState();
  state.runtimeSpaceId = "space-1";

  const result = await executeStepLoop(ctx, state);

  assertEquals(result, undefined);
  assertEquals(state.stepResults.length, 2);
  assertEquals(state.stepResults[0].conclusion, "success");
  assertEquals(state.stepResults[1].conclusion, "success");
  assertEquals(state.stepOutputs.build, { version: "1.0.0" });
  assertSpyCalls(engine.updateStepStatus, 4);
  assertSpyCalls(fetchSpy, 2);
});

Deno.test("executeStepLoop - cancels the runtime job when the run is cancelled", async () => {
  const { db } = createFakeD1([{ status: "cancelled" }]);
  const { namespace, fetchSpy: notifierFetchSpy } = createRunNotifier();
  const { fetchSpy: runtimeFetchSpy, host } = createRuntimeHost(() =>
    new Response(null, { status: 200 })
  );
  const engine = createEngine();
  const ctx = createJobQueueContext({
    env: {
      DB: db,
      RUN_NOTIFIER: namespace,
      RUNTIME_HOST: host,
    } as WorkflowQueueEnv,
    engine,
  });
  const state = createInitialState();
  state.runtimeStarted = true;
  state.runtimeSpaceId = "space-1";

  const result = await executeStepLoop(ctx, state);

  assertEquals(result, "cancelled");
  assertEquals(state.jobConclusion, "cancelled");
  assertSpyCalls(engine.cancelRun, 1);
  assertSpyCalls(engine.storeJobLogs, 1);
  assertSpyCalls(runtimeFetchSpy, 1);
  assertSpyCalls(notifierFetchSpy, 1);

  const eventRequest = notifierFetchSpy.calls[0].args[0] as Request;
  const eventPayload = await eventRequest.json() as {
    type: string;
    data: { status: string; conclusion: string };
  };
  assertEquals(eventPayload.type, "workflow.job.completed");
  assertEquals(eventPayload.data.status, "cancelled");
  assertEquals(eventPayload.data.conclusion, "cancelled");
});

Deno.test("completeJobSuccess - persists evaluated job outputs", async () => {
  const engine = createEngine();
  const ctx = createJobQueueContext({
    engine,
    message: createWorkflowMessage({
      jobDefinition: {
        name: "Build",
        "runs-on": "ubuntu-latest",
        steps: [{ id: "build", run: "echo ok" }],
        outputs: {
          version: "${{ steps.build.outputs.version }}",
        },
      },
    }),
  });
  const state = createInitialState();
  state.stepOutputs = {
    build: { version: "1.0.0" },
  };

  await completeJobSuccess(ctx, state);

  assertSpyCalls(engine.storeJobLogs, 1);
  assertSpyCalls(engine.onJobComplete, 1);
  const completedResult = engine.onJobComplete.calls[0]?.args[1] as
    | Record<string, unknown>
    | undefined;
  assertEquals(completedResult?.jobId, "job-1");
  assertEquals(completedResult?.status, "completed");
  assertEquals(completedResult?.conclusion, "success");
  assertEquals(completedResult?.outputs, { version: "1.0.0" });
  assertEquals(completedResult?.stepResults, []);
  assertEquals(completedResult?.startedAt, "2026-04-01T00:00:00.000Z");
  assertEquals(typeof completedResult?.completedAt, "string");
});

Deno.test("completeJobSuccess - reports success for continue-on-error jobs", async () => {
  const engine = createEngine();
  const ctx = createJobQueueContext({
    engine,
    message: createWorkflowMessage({
      jobDefinition: {
        name: "Build",
        "runs-on": "ubuntu-latest",
        "continue-on-error": true,
        steps: [{ run: "echo ok" }],
      },
    }),
  });
  const state = createInitialState();
  state.jobConclusion = "failure";

  await completeJobSuccess(ctx, state);

  assertEquals(state.completionConclusion, "success");
  assertSpyCalls(engine.onJobComplete, 1);
  const continueOnErrorResult = engine.onJobComplete.calls[0]?.args[1] as
    | Record<string, unknown>
    | undefined;
  assertEquals(continueOnErrorResult?.jobId, "job-1");
  assertEquals(continueOnErrorResult?.status, "completed");
  assertEquals(continueOnErrorResult?.conclusion, "success");
  assertEquals(continueOnErrorResult?.outputs, {});
  assertEquals(continueOnErrorResult?.stepResults, []);
  assertEquals(
    continueOnErrorResult?.startedAt,
    "2026-04-01T00:00:00.000Z",
  );
  assertEquals(typeof continueOnErrorResult?.completedAt, "string");
});

Deno.test("completeJobFailure - marks unseen steps as skipped", async () => {
  const engine = createEngine();
  const ctx = createJobQueueContext({
    engine,
    message: createWorkflowMessage({
      jobDefinition: {
        name: "Build",
        "runs-on": "ubuntu-latest",
        steps: [
          { name: "Step 1", run: "echo 1" },
          { name: "Step 2", run: "echo 2" },
          { name: "Step 3", run: "echo 3" },
        ],
      },
    }),
  });
  const state = createInitialState();
  state.stepResults = [{
    stepNumber: 1,
    name: "Step 1",
    status: "completed",
    conclusion: "success",
    outputs: {},
  }];

  await completeJobFailure(ctx, state, new Error("build broke"));

  assertEquals(state.stepResults.length, 3);
  assertStringIncludes(state.logs.join("\n"), "Error: build broke");
  assertSpyCalls(engine.updateStepStatus, 2);
  assertSpyCallArgs(engine.updateStepStatus, 0, [
    "job-1",
    2,
    "skipped",
    "skipped",
  ]);
  assertSpyCallArgs(engine.updateStepStatus, 1, [
    "job-1",
    3,
    "skipped",
    "skipped",
  ]);
});

Deno.test("completeJobFailure - swallows storeJobLogs failures", async () => {
  const engine = createEngine({
    storeJobLogs: spy(async () => {
      throw new Error("log storage failed");
    }),
  });
  const ctx = createJobQueueContext({ engine });
  const state = createInitialState();

  await completeJobFailure(ctx, state, new Error("original error"));

  assertSpyCalls(engine.onJobComplete, 1);
});

Deno.test("completeJobFailure - rethrows persistence failures", async () => {
  const engine = createEngine({
    onJobComplete: spy(async () => {
      throw new Error("db write failed");
    }),
  });
  const ctx = createJobQueueContext({ engine });
  const state = createInitialState();

  await assertRejects(
    () => completeJobFailure(ctx, state, new Error("original error")),
    Error,
    "db write failed",
  );
});
