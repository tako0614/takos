import type { D1Database } from "@cloudflare/workers-types";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  resolveActorPrincipalId: ((..._args: any[]) => undefined) as any,
  isInvalidArrayBufferError: ((..._args: any[]) => undefined) as any,
  logError: ((..._args: any[]) => undefined) as any,
  logWarn: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/principals'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/db-guards'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import {
  checkRunRateLimits,
  createPendingRun,
  getRunHierarchyNode,
  getRunResponse,
  getSpaceModel,
  updateRunStatus,
} from "@/services/runs/create-thread-run-store";

function buildDrizzleMock(options: {
  selectGet?: unknown;
  selectAll?: unknown[];
  insertRun?: unknown;
} = {}) {
  const runFn = async () => undefined;
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.get = async () => options.selectGet;
  chain.all = async () => options.selectAll ?? [];

  const insertChain: Record<string, unknown> = {};
  insertChain.values = () => insertChain;
  insertChain.returning = () => insertChain;
  insertChain.get = async () => options.insertRun;
  insertChain.run = runFn;

  const updateChain: Record<string, unknown> = {};
  updateChain.set = () => updateChain;
  updateChain.where = () => updateChain;
  updateChain.returning = () => updateChain;
  updateChain.run = runFn;

  return {
    select: () => chain,
    insert: () => insertChain,
    update: () => updateChain,
    _runFn: runFn,
  };
}

function buildSequentialDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;
  const runFn = async () => undefined;

  return {
    select: () => {
      const result = selectResults[selectIdx++];
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => chain;
      chain.get = async () => result;
      chain.all = async () => Array.isArray(result) ? result : [];
      return chain;
    },
    insert: () => ({
      values: () => ({
        run: runFn,
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          run: runFn,
        }),
      }),
    }),
    _runFn: runFn,
  };
}

Deno.test("getRunHierarchyNode - returns the hierarchy node when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  const row = {
    id: "run-1",
    threadId: "thread-1",
    accountId: "space-1",
    parentRunId: null,
    rootThreadId: "thread-1",
    rootRunId: "run-1",
  };
  mocks.getDb = (() => buildDrizzleMock({ selectGet: row })) as any;

  const result = await getRunHierarchyNode({} as D1Database, "run-1");

  assertEquals(result, {
    id: "run-1",
    threadId: "thread-1",
    accountId: "space-1",
    parentRunId: null,
    rootThreadId: "thread-1",
    rootRunId: "run-1",
  });
});
Deno.test("getRunHierarchyNode - returns null when run not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.getDb = (() => buildDrizzleMock({ selectGet: undefined })) as any;

  const result = await getRunHierarchyNode({} as D1Database, "nonexistent");
  assertEquals(result, null);
});
Deno.test("getRunHierarchyNode - normalizes parentRunId null fallback", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  const row = {
    id: "run-1",
    threadId: "thread-1",
    accountId: "space-1",
    parentRunId: undefined,
    rootThreadId: undefined,
    rootRunId: undefined,
  };
  mocks.getDb = (() => buildDrizzleMock({ selectGet: row })) as any;

  const result = await getRunHierarchyNode({} as D1Database, "run-1");
  assertEquals(result!.parentRunId, null);
  assertEquals(result!.rootThreadId, null);
  assertEquals(result!.rootRunId, null);
});
Deno.test("getRunHierarchyNode - falls back to D1 raw query on InvalidArrayBuffer error", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.isInvalidArrayBufferError = (() => true) as any;
  const drizzle = buildDrizzleMock({});
  (drizzle.select as any) = (() => {
    throw new Error("Invalid array buffer length");
  }) as any;
  mocks.getDb = (() => drizzle) as any;

  const mockD1 = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({
          id: "run-1",
          threadId: "thread-1",
          accountId: "space-1",
          parentRunId: null,
          rootThreadId: null,
          rootRunId: null,
        }),
      }),
    }),
  };

  const result = await getRunHierarchyNode(
    mockD1 as unknown as D1Database,
    "run-1",
  );
  assertNotEquals(result, null);
  assertEquals(result!.id, "run-1");
});

Deno.test("getSpaceModel - returns aiModel when workspace found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.getDb =
    (() => buildDrizzleMock({ selectGet: { aiModel: "gpt-5.4-mini" } })) as any;

  const result = await getSpaceModel({} as D1Database, "space-1");

  assertEquals(result, { aiModel: "gpt-5.4-mini" });
});
Deno.test("getSpaceModel - returns null when workspace not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.getDb = (() => buildDrizzleMock({ selectGet: undefined })) as any;

  const result = await getSpaceModel({} as D1Database, "missing");
  assertEquals(result, null);
});
Deno.test("getSpaceModel - normalizes null aiModel", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.getDb =
    (() => buildDrizzleMock({ selectGet: { aiModel: undefined } })) as any;

  const result = await getSpaceModel({} as D1Database, "space-1");
  assertEquals(result, { aiModel: null });
});

Deno.test("getRunResponse - returns a Run API object when found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  const row = {
    id: "run-1",
    threadId: "thread-1",
    accountId: "space-1",
    sessionId: null,
    parentRunId: null,
    childThreadId: null,
    rootThreadId: "thread-1",
    rootRunId: "run-1",
    agentType: "default",
    status: "completed",
    input: "{}",
    output: '{"result": true}',
    error: null,
    usage: "{}",
    workerId: null,
    workerHeartbeat: null,
    startedAt: "2026-03-01T00:00:00.000Z",
    completedAt: "2026-03-01T00:01:00.000Z",
    createdAt: "2026-03-01T00:00:00.000Z",
  };
  mocks.getDb = (() => buildDrizzleMock({ selectGet: row })) as any;

  const result = await getRunResponse({} as D1Database, "run-1");

  assertNotEquals(result, null);
  assertEquals(result!.id, "run-1");
  assertEquals(result!.thread_id, "thread-1");
  assertEquals(result!.space_id, "space-1");
  assertEquals(result!.status, "completed");
  assertEquals(result!.output, '{"result": true}');
});
Deno.test("getRunResponse - returns null when run not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.getDb = (() => buildDrizzleMock({ selectGet: undefined })) as any;

  const result = await getRunResponse({} as D1Database, "missing");
  assertEquals(result, null);
});

Deno.test("createPendingRun - inserts a pending run via Drizzle", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  const drizzle = buildDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  await createPendingRun({} as D1Database, {
    runId: "run-new",
    threadId: "thread-1",
    spaceId: "space-1",
    requesterAccountId: "user-1",
    parentRunId: null,
    childThreadId: null,
    rootThreadId: "thread-1",
    rootRunId: "run-new",
    agentType: "default",
    input: '{"message": "test"}',
    createdAt: "2026-03-01T00:00:00.000Z",
  });

  assert(drizzle.insert.calls.length > 0);
});
Deno.test("createPendingRun - inserts a child run with parentRunId and childThreadId", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  const drizzle = buildDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  await createPendingRun({} as D1Database, {
    runId: "run-child",
    threadId: "child-thread-1",
    spaceId: "space-1",
    requesterAccountId: "user-1",
    parentRunId: "run-parent",
    childThreadId: "child-thread-1",
    rootThreadId: "thread-1",
    rootRunId: "run-parent",
    agentType: "implementer",
    input: "{}",
    createdAt: "2026-03-01T00:00:00.000Z",
  });

  assert(drizzle.insert.calls.length > 0);
});

Deno.test("updateRunStatus - updates a run status to queued", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  const drizzle = buildDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  await updateRunStatus({} as D1Database, {
    runId: "run-1",
    status: "queued",
    error: null,
  });

  assert(drizzle.update.calls.length > 0);
});
Deno.test("updateRunStatus - updates a run status to failed with error", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  const drizzle = buildDrizzleMock();
  mocks.getDb = (() => drizzle) as any;

  await updateRunStatus({} as D1Database, {
    runId: "run-1",
    status: "failed",
    error: "Something went wrong",
  });

  assert(drizzle.update.calls.length > 0);
});

Deno.test("checkRunRateLimits - allows a run when all limits are within bounds", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.resolveActorPrincipalId = (async () => null) as any;
  const drizzle = buildSequentialDrizzleMock([
    [{ accountId: "space-1" }], // user workspaces
    { count: 0 }, // minute count
    { count: 0 }, // hour count
    { count: 0 }, // concurrent count
  ]);
  mocks.getDb = (() => drizzle) as any;

  const result = await checkRunRateLimits(
    {} as D1Database,
    "user-1",
    "space-1",
  );

  assertEquals(result.allowed, true);
  assertEquals(result.reason, undefined);
});
Deno.test("checkRunRateLimits - rejects when per-minute limit is exceeded", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.resolveActorPrincipalId = (async () => null) as any;
  const drizzle = buildSequentialDrizzleMock([
    [{ accountId: "space-1" }],
    { count: 30 }, // at or above max
  ]);
  mocks.getDb = (() => drizzle) as any;

  const result = await checkRunRateLimits(
    {} as D1Database,
    "user-1",
    "space-1",
  );

  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason, "max 30 runs per minute");
});
Deno.test("checkRunRateLimits - rejects when per-hour limit is exceeded", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.resolveActorPrincipalId = (async () => null) as any;
  const drizzle = buildSequentialDrizzleMock([
    [{ accountId: "space-1" }],
    { count: 5 }, // minute ok
    { count: 500 }, // at or above hourly max
  ]);
  mocks.getDb = (() => drizzle) as any;

  const result = await checkRunRateLimits(
    {} as D1Database,
    "user-1",
    "space-1",
  );

  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason, "max 500 runs per hour");
});
Deno.test("checkRunRateLimits - rejects when concurrent limit is exceeded", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.resolveActorPrincipalId = (async () => null) as any;
  const drizzle = buildSequentialDrizzleMock([
    [{ accountId: "space-1" }],
    { count: 5 }, // minute ok
    { count: 50 }, // hour ok
    { count: 20 }, // at or above concurrent max
  ]);
  mocks.getDb = (() => drizzle) as any;

  const result = await checkRunRateLimits(
    {} as D1Database,
    "user-1",
    "space-1",
  );

  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason, "max 20");
  assertStringIncludes(result.reason, "concurrent");
});
Deno.test("checkRunRateLimits - uses child run rate limits when isChildRun is true", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.resolveActorPrincipalId = (async () => null) as any;
  const drizzle = buildSequentialDrizzleMock([
    [{ accountId: "space-1" }],
    { count: 20 }, // at child per-minute max
  ]);
  mocks.getDb = (() => drizzle) as any;

  const result = await checkRunRateLimits(
    {} as D1Database,
    "user-1",
    "space-1",
    { isChildRun: true },
  );

  assertEquals(result.allowed, false);
  assertStringIncludes(result.reason, "Child run rate limit");
  assertStringIncludes(result.reason, "max 20 child runs per minute");
});
Deno.test("checkRunRateLimits - allows when user has no workspaces", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.resolveActorPrincipalId = (async () => null) as any;
  const drizzle = buildSequentialDrizzleMock([
    [], // no workspace memberships
  ]);
  mocks.getDb = (() => drizzle) as any;

  const result = await checkRunRateLimits(
    {} as D1Database,
    "orphan-user",
    "space-1",
  );

  assertEquals(result.allowed, true);
});
Deno.test("checkRunRateLimits - tries resolveActorPrincipalId when no workspaces found for direct actor", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.resolveActorPrincipalId = (async () => null) as any;
  mocks.resolveActorPrincipalId = (async () => "principal-1") as any;

  const drizzle = buildSequentialDrizzleMock([
    [], // first memberships query: empty
    [{ accountId: "space-1" }], // second memberships query with principal
    { count: 0 }, // minute
    { count: 0 }, // hour
    { count: 0 }, // concurrent
  ]);
  mocks.getDb = (() => drizzle) as any;

  const result = await checkRunRateLimits(
    {} as D1Database,
    "user-1",
    "space-1",
  );

  assertEquals(result.allowed, true);
  assertSpyCallArgs(mocks.resolveActorPrincipalId, 0, [
    expect.anything(),
    "user-1",
  ]);
});
Deno.test("checkRunRateLimits - falls back to D1 on InvalidArrayBuffer error", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isInvalidArrayBufferError = (() => false) as any;
  mocks.resolveActorPrincipalId = (async () => null) as any;
  mocks.isInvalidArrayBufferError = (() => true) as any;
  const drizzle = buildDrizzleMock({});
  (drizzle.select as any) = (() => {
    throw new Error("Invalid array buffer length");
  }) as any;
  mocks.getDb = (() => drizzle) as any;

  const mockD1 = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ count: 0 }),
      }),
    }),
  };

  const result = await checkRunRateLimits(
    mockD1 as unknown as D1Database,
    "user-1",
    "space-1",
  );

  assertEquals(result.allowed, true);
});
