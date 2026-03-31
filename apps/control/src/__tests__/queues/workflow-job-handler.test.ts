import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  type WorkflowJobQueueMessage,
} from "@/types";

import { assert, assertRejects } from "jsr:@std/assert";
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
import { handleWorkflowJob } from "@/queues/workflow-job-handler";
import type { WorkflowQueueEnv } from "@/queues/workflow-types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type EngineMock = {
  onJobStart: any;
  onJobComplete: any;
  updateStepStatus: any;
  storeJobLogs: any;
  cancelRun: any;
};

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

  return {
    select: () => chain(),
    update: () => updateChain(),
    insert: () => ({
      values: () => ({
        returning: () => ({ get: async () => ({ id: 1 }) }),
      }),
    }),
    delete: () => ({ where: async () => undefined }),
  };
}

function createSelectGetSequence(...values: any[]) {
  let index = 0;
  return async () => values[index++] ?? values[values.length - 1] ?? null;
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
    env: { CI: "true" },
    secretIds: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function createQueueEnv(
  overrides: Partial<WorkflowQueueEnv> = {},
): WorkflowQueueEnv {
  return {
    DB: {} as any,
    GIT_OBJECTS: {} as any,
    WORKFLOW_QUEUE: { send: ((..._args: any[]) => undefined) as any } as any,
    RUN_NOTIFIER: {} as any,
    RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
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

Deno.test("handleWorkflowJob - throws when GIT_OBJECTS is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() => new Request("https://notifier.test", { method: "POST" })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const env = createQueueEnv({ GIT_OBJECTS: undefined });

  await assertRejects(async () => {
    await handleWorkflowJob(createMessage(), env);
  }, "Git storage not configured");
});
Deno.test("handleWorkflowJob - returns early when run or job record is missing", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() => new Request("https://notifier.test", { method: "POST" })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();
  mocks.createWorkflowEngine = (() => engine) as any;

  const selectGet = createSelectGetSequence(null, null);
  const dbMock = createDrizzleMock({ selectGet });
  mocks.getDb = (() => dbMock) as any;

  await handleWorkflowJob(createMessage(), createQueueEnv());

  assertSpyCalls(engine.onJobStart, 0);
});
Deno.test("handleWorkflowJob - returns early when job is already completed", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() => new Request("https://notifier.test", { method: "POST" })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();
  mocks.createWorkflowEngine = (() => engine) as any;

  const selectGet = createSelectGetSequence(
    { status: "running" },
    { status: "completed" },
  );
  const dbMock = createDrizzleMock({ selectGet });
  mocks.getDb = (() => dbMock) as any;

  await handleWorkflowJob(createMessage(), createQueueEnv());

  assertSpyCalls(engine.onJobStart, 0);
});
Deno.test("handleWorkflowJob - cancels run when run status is cancelled", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() => new Request("https://notifier.test", { method: "POST" })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();
  mocks.createWorkflowEngine = (() => engine) as any;

  const selectGet = createSelectGetSequence(
    { status: "cancelled" },
    { status: "queued" },
  );
  const dbMock = createDrizzleMock({ selectGet });
  mocks.getDb = (() => dbMock) as any;

  await handleWorkflowJob(createMessage(), createQueueEnv());

  assertSpyCallArgs(engine.cancelRun, 0, ["run-1"]);
});
Deno.test("handleWorkflowJob - marks job skipped when run is already completed", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() => new Request("https://notifier.test", { method: "POST" })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();
  mocks.createWorkflowEngine = (() => engine) as any;

  const selectGet = createSelectGetSequence(
    { status: "completed" },
    { status: "queued" },
  );
  const updateWhere = async () => ({ meta: { changes: 1 } });
  const dbMock = createDrizzleMock({ selectGet });
  // Override update to track calls
  dbMock.update = () => ({
    set: () => ({
      where: updateWhere,
    }),
  });
  mocks.getDb = (() => dbMock) as any;

  await handleWorkflowJob(createMessage(), createQueueEnv());

  // markJobSkipped should have been called (updates job and steps)
  assert(dbMock.update.calls.length > 0);
  assertSpyCalls(engine.onJobStart, 0);
});
Deno.test("handleWorkflowJob - returns early when job claim fails (already claimed)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() => new Request("https://notifier.test", { method: "POST" })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();
  mocks.createWorkflowEngine = (() => engine) as any;

  const selectGet = createSelectGetSequence(
    { status: "running" },
    { status: "queued" },
  );
  const dbMock = createDrizzleMock({ selectGet });
  // Override update to simulate 0 changes (already claimed)
  dbMock.update = () => ({
    set: () => ({
      where: async () => ({ meta: { changes: 0 } }),
    }),
  });
  mocks.getDb = (() => dbMock) as any;

  await handleWorkflowJob(createMessage(), createQueueEnv());

  assertSpyCalls(engine.onJobStart, 0);
});
Deno.test("handleWorkflowJob - throws when RUNTIME_HOST is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() => new Request("https://notifier.test", { method: "POST" })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();
  mocks.createWorkflowEngine = (() => engine) as any;

  const selectGet = createSelectGetSequence(
    { status: "running" },
    { status: "queued" },
    { workflowPath: ".takos/ci.yml", inputs: "{}" },
    { accountId: "ws-1" },
  );
  const dbMock = createDrizzleMock({ selectGet });
  dbMock.update = () => ({
    set: () => ({
      where: async () => ({ meta: { changes: 1 } }),
    }),
  });
  mocks.getDb = (() => dbMock) as any;

  const env = createQueueEnv({ RUNTIME_HOST: undefined });

  await handleWorkflowJob(createMessage(), env);

  // Should complete with failure since RUNTIME_HOST is missing
  assertSpyCallArgs(engine.onJobComplete, 0, [
    "job-1",
    { conclusion: "failure" },
  ]);
});
Deno.test("handleWorkflowJob - uses jobKey as name when jobDefinition.name is not set", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() => new Request("https://notifier.test", { method: "POST" })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();
  mocks.createWorkflowEngine = (() => engine) as any;

  const selectGet = createSelectGetSequence(
    { status: "running" },
    { status: "queued" },
    { workflowPath: ".takos/ci.yml", inputs: "{}" },
    { accountId: "ws-1" },
  );
  const selectAll = async () => [];
  const dbMock = createDrizzleMock({ selectGet, selectAll });
  dbMock.update = () => ({
    set: () => ({
      where: async () => ({ meta: { changes: 1 } }),
    }),
  });
  mocks.getDb = (() => dbMock) as any;

  mocks.callRuntimeRequest = (async (_env: unknown, endpoint: string) => {
    if (endpoint.endsWith("/start")) return jsonResponse({ ok: true });
    if (endpoint.includes("/step/")) {
      return jsonResponse({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        outputs: {},
        conclusion: "success",
      });
    }
    if (endpoint.endsWith("/complete")) return jsonResponse({ ok: true });
    return { ok: false, status: 404, text: async () => "not found" } as any;
  }) as any;

  const msg = createMessage({
    jobDefinition: {
      "runs-on": "ubuntu-latest",
      steps: [{ run: "echo ok" }],
      // name is undefined
    },
  });

  await handleWorkflowJob(msg, createQueueEnv());

  // jobKey 'build' is used as jobName
  assertSpyCallArgs(engine.storeJobLogs, 0, [
    "job-1",
    expect.stringContaining("=== Job: build ==="),
  ]);
});
Deno.test("handleWorkflowJob - merges job env with job definition env", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.safeJsonParseOrDefault = (_value: unknown, fallback: unknown) =>
    fallback as any;
  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest =
    (() => new Request("https://notifier.test", { method: "POST" })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: async () => new Response(null, { status: 204 }),
  })) as any;
  mocks.decrypt = (async () => "decrypted-secret") as any;
  const engine = createEngineMock();
  mocks.createWorkflowEngine = (() => engine) as any;

  const selectGet = createSelectGetSequence(
    { status: "running" },
    { status: "queued" },
    { workflowPath: ".takos/ci.yml", inputs: "{}" },
    { accountId: "ws-1" },
  );
  const selectAll = async () => [];
  const dbMock = createDrizzleMock({ selectGet, selectAll });
  dbMock.update = () => ({
    set: () => ({
      where: async () => ({ meta: { changes: 1 } }),
    }),
  });
  mocks.getDb = (() => dbMock) as any;

  mocks.callRuntimeRequest = (async (_env: unknown, endpoint: string) => {
    if (endpoint.endsWith("/start")) return jsonResponse({ ok: true });
    if (endpoint.includes("/step/")) {
      return jsonResponse({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        outputs: {},
        conclusion: "success",
      });
    }
    if (endpoint.endsWith("/complete")) return jsonResponse({ ok: true });
    return { ok: false, status: 404, text: async () => "" } as any;
  }) as any;

  const msg = createMessage({
    env: { CI: "true", FROM_MSG: "yes" },
    jobDefinition: {
      name: "Build",
      "runs-on": "ubuntu-latest",
      env: { FROM_DEF: "yes", CI: "false" },
      steps: [{ run: "echo ok" }],
    },
  });

  await handleWorkflowJob(msg, createQueueEnv());

  // The runtime start call should have the merged env
  // jobDefinition.env overrides message.env for CI
  assertSpyCallArgs(mocks.callRuntimeRequest, 0, [
    expect.anything(),
    expect.stringContaining("/start"),
    {
      body: {
        env: {
          CI: "false",
          FROM_MSG: "yes",
          FROM_DEF: "yes",
        },
      },
    },
  ]);
});
