import type { D1Database } from "@cloudflare/workers-types";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";

import {
  checkRunRateLimits,
  createPendingRun,
  getRunHierarchyNode,
  getRunResponse,
  getSpaceModel,
  updateRunStatus,
} from "@/services/runs/create-thread-run-store";

type FakeResponse = {
  rawRows?: unknown[][];
  rawError?: string;
  first?: unknown;
  run?: { meta: { changes: number } };
};

type PrepareCall = {
  sql: string;
  args: unknown[];
};

function createFakeD1Database(responses: FakeResponse[]) {
  const prepareCalls: PrepareCall[] = [];
  let index = 0;

  const db = {
    prepare(sql: string) {
      const response = responses[index++] ?? {};
      return {
        bind(...args: unknown[]) {
          prepareCalls.push({ sql, args });
          return {
            raw: async () => {
              if (response.rawError) {
                throw new Error(response.rawError);
              }
              return response.rawRows ?? [];
            },
            first: async () => response.first ?? null,
            run: async () => response.run ?? { meta: { changes: 1 } },
            all: async () => response.rawRows ?? [],
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, prepareCalls };
}

Deno.test("getRunHierarchyNode - returns the hierarchy node when found", async () => {
  const { db } = createFakeD1Database([
    {
      rawRows: [[
        "run-1",
        "thread-1",
        "space-1",
        null,
        "thread-1",
        "run-1",
      ]],
    },
  ]);

  const result = await getRunHierarchyNode(db, "run-1");

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
  const { db } = createFakeD1Database([
    { rawRows: [] },
  ]);

  const result = await getRunHierarchyNode(db, "nonexistent");

  assertEquals(result, null);
});

Deno.test("getRunHierarchyNode - normalizes parentRunId null fallback", async () => {
  const { db } = createFakeD1Database([
    {
      rawRows: [[
        "run-1",
        "thread-1",
        "space-1",
        undefined,
        undefined,
        undefined,
      ]],
    },
  ]);

  const result = await getRunHierarchyNode(db, "run-1");

  assertEquals(result!.parentRunId, null);
  assertEquals(result!.rootThreadId, null);
  assertEquals(result!.rootRunId, null);
});

Deno.test("getRunHierarchyNode - falls back to D1 raw query on InvalidArrayBuffer error", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    {
      rawRows: [[
        "run-1",
        "thread-1",
        "space-1",
        null,
        null,
        null,
      ]],
    },
  ]);

  const result = await getRunHierarchyNode(db, "run-1");

  assertNotEquals(result, null);
  assertEquals(result!.id, "run-1");
  assertEquals(prepareCalls.length, 1);
});

Deno.test("getSpaceModel - returns aiModel when workspace found", async () => {
  const { db } = createFakeD1Database([
    { rawRows: [["gpt-5.4-mini"]] },
  ]);

  const result = await getSpaceModel(db, "space-1");

  assertEquals(result, { aiModel: "gpt-5.4-mini" });
});

Deno.test("getSpaceModel - returns null when workspace not found", async () => {
  const { db } = createFakeD1Database([
    { rawRows: [] },
  ]);

  const result = await getSpaceModel(db, "missing");

  assertEquals(result, null);
});

Deno.test("getSpaceModel - normalizes null aiModel", async () => {
  const { db } = createFakeD1Database([
    { rawRows: [[undefined]] },
  ]);

  const result = await getSpaceModel(db, "space-1");

  assertEquals(result, { aiModel: null });
});

Deno.test("getRunResponse - returns a Run API object when found", async () => {
  const { db } = createFakeD1Database([
    {
      rawRows: [[
        "run-1",
        "thread-1",
        "space-1",
        null,
        null,
        null,
        null,
        "thread-1",
        "run-1",
        "default",
        "completed",
        null,
        "{}",
        '{"result": true}',
        null,
        "{}",
        null,
        null,
        null,
        "2026-03-01T00:00:00.000Z",
        "2026-03-01T00:01:00.000Z",
        "2026-03-01T00:00:00.000Z",
      ]],
    },
  ]);

  const result = await getRunResponse(db, "run-1");

  assertNotEquals(result, null);
  assertEquals(result!.id, "run-1");
  assertEquals(result!.thread_id, "thread-1");
  assertEquals(result!.space_id, "space-1");
  assertEquals(result!.status, "completed");
  assertEquals(result!.output, '{"result": true}');
});

Deno.test("getRunResponse - returns null when run not found", async () => {
  const { db } = createFakeD1Database([
    { rawRows: [] },
  ]);

  const result = await getRunResponse(db, "missing");

  assertEquals(result, null);
});

Deno.test("createPendingRun - inserts a pending run via Drizzle", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    { run: { meta: { changes: 1 } } },
  ]);

  await createPendingRun(db, {
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

  assertEquals(prepareCalls.length, 1);
  assertStringIncludes(prepareCalls[0].sql.toLowerCase(), 'insert into "runs"');
});

Deno.test("createPendingRun - inserts a child run with parentRunId and childThreadId", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    { run: { meta: { changes: 1 } } },
  ]);

  await createPendingRun(db, {
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

  assertEquals(prepareCalls.length, 1);
  assertStringIncludes(prepareCalls[0].sql.toLowerCase(), 'insert into "runs"');
});

Deno.test("updateRunStatus - updates a run status to queued", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    { run: { meta: { changes: 1 } } },
  ]);

  await updateRunStatus(db, {
    runId: "run-1",
    status: "queued",
    error: null,
  });

  assertEquals(prepareCalls.length, 1);
  assertStringIncludes(prepareCalls[0].sql.toLowerCase(), 'update "runs"');
});

Deno.test("updateRunStatus - updates a run status to failed with error", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    { run: { meta: { changes: 1 } } },
  ]);

  await updateRunStatus(db, {
    runId: "run-1",
    status: "failed",
    error: "Something went wrong",
  });

  assertEquals(prepareCalls.length, 1);
  assertStringIncludes(prepareCalls[0].sql.toLowerCase(), 'update "runs"');
});

Deno.test("checkRunRateLimits - allows a run when all limits are within bounds", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    { rawRows: [["space-1"]] },
    { rawRows: [[0]] },
    { rawRows: [[0]] },
    { rawRows: [[0]] },
  ]);

  const result = await checkRunRateLimits(db, "user-1", "space-1");

  assertEquals(result.allowed, true);
  assertEquals(result.reason, undefined);
  assertEquals(prepareCalls.length, 4);
});

Deno.test("checkRunRateLimits - rejects when per-minute limit is exceeded", async () => {
  const { db } = createFakeD1Database([
    { rawRows: [["space-1"]] },
    { rawRows: [[30]] },
  ]);

  const result = await checkRunRateLimits(db, "user-1", "space-1");

  assertEquals(result.allowed, false);
  assert(result.reason !== undefined);
  assertStringIncludes(result.reason, "max 30 runs per minute");
});

Deno.test("checkRunRateLimits - rejects when per-hour limit is exceeded", async () => {
  const { db } = createFakeD1Database([
    { rawRows: [["space-1"]] },
    { rawRows: [[5]] },
    { rawRows: [[500]] },
  ]);

  const result = await checkRunRateLimits(db, "user-1", "space-1");

  assertEquals(result.allowed, false);
  assert(result.reason !== undefined);
  assertStringIncludes(result.reason, "max 500 runs per hour");
});

Deno.test("checkRunRateLimits - rejects when concurrent limit is exceeded", async () => {
  const { db } = createFakeD1Database([
    { rawRows: [["space-1"]] },
    { rawRows: [[5]] },
    { rawRows: [[50]] },
    { rawRows: [[20]] },
  ]);

  const result = await checkRunRateLimits(db, "user-1", "space-1");

  assertEquals(result.allowed, false);
  assert(result.reason !== undefined);
  assertStringIncludes(result.reason, "max 20");
  assertStringIncludes(result.reason, "concurrent");
});

Deno.test("checkRunRateLimits - uses child run rate limits when isChildRun is true", async () => {
  const { db } = createFakeD1Database([
    { rawRows: [["space-1"]] },
    { rawRows: [[20]] },
  ]);

  const result = await checkRunRateLimits(db, "user-1", "space-1", {
    isChildRun: true,
  });

  assertEquals(result.allowed, false);
  assert(result.reason !== undefined);
  assertStringIncludes(result.reason, "Child run rate limit");
  assertStringIncludes(result.reason, "max 20 child runs per minute");
});

Deno.test("checkRunRateLimits - allows when user has no workspaces", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    { rawRows: [] },
    { rawRows: [] },
  ]);

  const result = await checkRunRateLimits(db, "orphan-user", "space-1");

  assertEquals(result.allowed, true);
  assertEquals(prepareCalls.length, 2);
});

Deno.test("checkRunRateLimits - tries resolveActorPrincipalId when no workspaces found for direct actor", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    { rawRows: [] },
    { rawRows: [["principal-1"]] },
    { rawRows: [["space-1"]] },
    { rawRows: [[0]] },
    { rawRows: [[0]] },
    { rawRows: [[0]] },
  ]);

  const result = await checkRunRateLimits(db, "user-1", "space-1");

  assertEquals(result.allowed, true);
  assertEquals(
    prepareCalls.filter((call) =>
      call.sql.toLowerCase().includes('from "account_memberships"')
    ).length,
    2,
  );
  assertEquals(
    prepareCalls.some((call) =>
      call.sql.toLowerCase().includes('from "accounts"')
    ),
    true,
  );
});
