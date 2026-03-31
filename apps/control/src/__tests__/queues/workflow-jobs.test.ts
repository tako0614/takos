import type { D1Database, Queue, R2Bucket } from "@cloudflare/workers-types";
import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  type WorkflowJobQueueMessage,
} from "@/types";

import { assert, assertEquals } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls } from "jsr:@std/testing/mock";

const mocks = {
  createWorkflowEngine: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,
  decrypt: ((..._args: any[]) => undefined) as any,
  safeJsonParseOrDefault: ((..._args: any[]) => undefined) as any,
  callRuntimeRequest: ((..._args: any[]) => undefined) as any,
  getRunNotifierStub: ((..._args: any[]) => undefined) as any,
  buildRunNotifierEmitRequest: ((..._args: any[]) => undefined) as any,
  buildRunNotifierEmitPayload: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/services/execution/workflow-engine'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/run-notifier-client'
// [Deno] vi.mock removed - manually stub imports from '@/services/run-notifier-payload'
import {
  handleWorkflowJob,
  type WorkflowQueueEnv,
} from "@/queues/workflow-jobs";

type EngineMock = {
  onJobStart: any;
  onJobComplete: any;
  updateStepStatus: any;
  storeJobLogs: any;
  cancelRun: any;
};

/**
 * Creates a chainable drizzle mock that supports:
 *   db.select(cols).from(table).where(...).get() -> single row
 *   db.select(cols).from(table).where(...).orderBy(...).all() -> array
 *   db.update(table).set(data).where(...) -> void
 *   db.insert(table).values(data).returning().get() -> row
 *
 * Configure with selectGet/selectAll to control query results.
 */
function createDrizzleMock(opts: {
  selectGet?: any;
  selectAll?: any;
}) {
  const selectGet = opts.selectGet ?? (async () => null);
  const selectAll = opts.selectAll ?? (async () => []);

  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = () => c;
    c.get = selectGet;
    c.all = selectAll;
    return c;
  };

  const updateChain = () => {
    const c: Record<string, unknown> = {};
    c.set = () => c;
    c.where = async () => ({ meta: { changes: 1 } });
    return c;
  };

  const insertChain = () => {
    const c: Record<string, unknown> = {};
    c.values = () => c;
    c.returning = () => c;
    c.get = async () => ({ id: 1 });
    return c;
  };

  return {
    select: () => chain(),
    update: () => updateChain(),
    insert: () => insertChain(),
    delete: () => ({ where: async () => undefined }),
  };
}

function createEngineMock(): EngineMock {
  return {
    onJobStart: async () => undefined,
    onJobComplete: async () => undefined,
    updateStepStatus: async () => undefined,
    storeJobLogs: async () => undefined,
    cancelRun: async () => undefined,
  };
}

function createMessage(
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
    env: {
      CI: "true",
    },
    secretIds: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function createQueueEnv(
  overrides: Partial<WorkflowQueueEnv> = {},
): WorkflowQueueEnv {
  return {
    DB: {} as D1Database,
    GIT_OBJECTS: {} as R2Bucket,
    WORKFLOW_QUEUE: {
      send: ((..._args: any[]) => undefined) as any,
    } as unknown as Queue<WorkflowJobQueueMessage>,
    ...overrides,
  } as unknown as WorkflowQueueEnv;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

Deno.test("handleWorkflowJob - does not fail missing step secrets when job.if is false", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() =>
      new Request("https://notifier.example.test", {
        method: "POST",
      })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();

  // The production code calls db.select(...).from(table).where(...).get() multiple times.
  // Order: getRunStatus -> status, getJobStatus -> status, getRunContext -> workflowPath/inputs
  const selectGet = ((..._args: any[]) => undefined) as any =
    (async () => ({ status: "running" })) as any // getRunStatus
     =
    (async () => ({ status: "queued" })) as any // getJobStatus
     =
      (async () => ({
        workflowPath: ".takos/workflows/ci.yml",
        inputs: "{}",
      })) as any; // getRunContext
  const selectAll = async () => [];
  const dbMock = createDrizzleMock({ selectGet, selectAll });

  mocks.createWorkflowEngine = (() => engine) as any;
  mocks.getDb = (() => dbMock) as any;

  const message = createMessage({
    jobDefinition: {
      name: "Build",
      "runs-on": "ubuntu-latest",
      if: "${{ env.SHOULD_RUN }}",
      steps: [
        {
          name: "never-run",
          run: "echo should-not-run",
          env: {
            SECRET_REF: "${{ secrets.MISSING_SECRET }}",
          },
        },
      ],
    },
    env: {},
  });

  await assertEquals(
    await handleWorkflowJob(message, createQueueEnv()),
    undefined,
  );

  assertSpyCalls(mocks.decrypt, 0);
  assertSpyCalls(mocks.callRuntimeRequest, 0);
  assertSpyCallArgs(engine.onJobComplete, 0, [
    "job-1",
    { conclusion: "skipped" },
  ]);
});
Deno.test("handleWorkflowJob - passes workflow runId to runtime start payload without custom warning logs", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() =>
      new Request("https://notifier.example.test", {
        method: "POST",
      })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();

  // Order: getRunStatus -> status, getJobStatus -> status, getRunContext -> workflowPath/inputs,
  // getWorkspaceIdFromRepoId -> accountId
  const selectGet = ((..._args: any[]) => undefined) as any =
    (async () => ({ status: "running" })) as any // getRunStatus
     =
    (async () => ({ status: "queued" })) as any // getJobStatus
     =
    (async () => ({
      workflowPath: ".takos/workflows/ci.yml",
      inputs: "{}",
    })) as any // getRunContext
     =
      (async () => ({ accountId: "workspace-1" })) as any; // getWorkspaceIdFromRepoId
  const selectAll = async () => []; // secrets (empty)
  const dbMock = createDrizzleMock({ selectGet, selectAll });

  mocks.createWorkflowEngine = (() => engine) as any;
  mocks.getDb = (() => dbMock) as any;

  mocks.callRuntimeRequest = (async (_env: unknown, endpoint: string) => {
    if (endpoint.endsWith("/start")) {
      return jsonResponse({ ok: true });
    }
    if (endpoint.includes("/step/1")) {
      return jsonResponse({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        outputs: {},
        conclusion: "success",
      });
    }
    if (endpoint.endsWith("/complete")) {
      return jsonResponse({ ok: true });
    }
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "not found",
      json: async () => ({}),
    } as unknown as Response;
  }) as any;

  const message = createMessage({
    jobDefinition: {
      name: "Build",
      "runs-on": "ubuntu-latest",
      steps: [
        {
          name: "dump-env",
          run: "printenv",
        },
      ],
    },
  });

  await assertEquals(
    await handleWorkflowJob(
      message,
      createQueueEnv({
        RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any } as {
          fetch(request: Request): Promise<Response>;
        },
      }),
    ),
    undefined,
  );

  assertSpyCallArgs(mocks.callRuntimeRequest, 0, [
    expect.anything(),
    "/actions/jobs/job-1/start",
    {
      method: "POST",
      body: {
        runId: "run-1",
        space_id: "workspace-1",
      },
    },
  ]);

  const storedLogs = engine.storeJobLogs.calls[0]?.[1] as string | undefined;
  assert(storedLogs !== undefined);
  assert(!storedLogs.includes("[warning]"));
});
Deno.test("handleWorkflowJob - does not fail missing secrets in a step skipped by step.if", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() =>
      new Request("https://notifier.example.test", {
        method: "POST",
      })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();

  // Order: getRunStatus -> status, getJobStatus -> status, getRunContext -> workflowPath/inputs,
  // getWorkspaceIdFromRepoId -> accountId
  const selectGet = ((..._args: any[]) => undefined) as any =
    (async () => ({ status: "running" })) as any // getRunStatus
     =
    (async () => ({ status: "queued" })) as any // getJobStatus
     =
    (async () => ({
      workflowPath: ".takos/workflows/ci.yml",
      inputs: "{}",
    })) as any // getRunContext
     =
      (async () => ({ accountId: "workspace-1" })) as any; // getWorkspaceIdFromRepoId
  const selectAll = async () => []; // secrets (empty)
  const dbMock = createDrizzleMock({ selectGet, selectAll });

  mocks.createWorkflowEngine = (() => engine) as any;
  mocks.getDb = (() => dbMock) as any;

  mocks.callRuntimeRequest = (async (_env: unknown, endpoint: string) => {
    if (endpoint.endsWith("/start")) {
      return jsonResponse({ ok: true });
    }
    if (endpoint.includes("/step/1")) {
      return jsonResponse({
        exitCode: 0,
        stdout: "step-1-ok",
        stderr: "",
        outputs: {},
        conclusion: "success",
      });
    }
    if (endpoint.includes("/step/2")) {
      return jsonResponse({
        exitCode: 1,
        stdout: "",
        stderr: "should-not-run",
        outputs: {},
        conclusion: "failure",
      });
    }
    if (endpoint.endsWith("/complete")) {
      return jsonResponse({ ok: true });
    }
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "not found",
      json: async () => ({}),
    } as unknown as Response;
  }) as any;

  const message = createMessage({
    jobDefinition: {
      name: "Build",
      "runs-on": "ubuntu-latest",
      steps: [
        {
          name: "run-step",
          run: "echo step1",
        },
        {
          name: "skip-step",
          if: "${{ env.RUN_SECOND_STEP }}",
          run: "echo step2",
          env: {
            SECRET_REF: "${{ secrets.MISSING_SECRET }}",
          },
        },
      ],
    },
  });

  await assertEquals(
    await handleWorkflowJob(
      message,
      createQueueEnv({
        RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any } as {
          fetch(request: Request): Promise<Response>;
        },
      }),
    ),
    undefined,
  );

  assertSpyCallArgs(mocks.callRuntimeRequest, 0, [
    expect.anything(),
    expect.stringContaining("/step/1"),
    expect.anything(),
  ]);
  assertSpyCalls(mocks.callRuntimeRequest, 1);
  assertSpyCallArgs(engine.onJobComplete, 0, [
    "job-1",
    { conclusion: "success" },
  ]);
});
