import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { memoryServiceDeps } from "@/application/services/memory/memories.ts";
import { noopDep } from "@test/dep-stubs";

type AnyMockFn = (...args: unknown[]) => unknown;
const mocks: {
  getDb: AnyMockFn;
  generateId: AnyMockFn;
  now: AnyMockFn;
} = {
  getDb: noopDep("memoryServiceDeps.getDb"),
  generateId: noopDep("memoryServiceDeps.generateId"),
  now: noopDep("memoryServiceDeps.now"),
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import { MEMORY_TYPES } from "@/services/memory/memories";
import { noopSqlDatabaseBinding } from "@test/binding-stubs";

interface DrizzleMockState {
  get: AnyMockFn;
  all: AnyMockFn;
  run: AnyMockFn;
  chain?: DrizzleMockChain;
}

interface DrizzleMockChain {
  from(): DrizzleMockChain;
  where(): DrizzleMockChain;
  set(): DrizzleMockChain;
  values(): DrizzleMockChain;
  returning(): DrizzleMockChain;
  orderBy(): DrizzleMockChain;
  limit(): DrizzleMockChain;
  offset(): DrizzleMockChain;
  get: AnyMockFn;
  all: AnyMockFn;
  run: AnyMockFn;
}

function createDrizzleMock() {
  const state: DrizzleMockState = {
    get: noopDep("drizzleMock.get"),
    all: noopDep("drizzleMock.all"),
    run: noopDep("drizzleMock.run"),
  };
  const chain: DrizzleMockChain = {
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    set() {
      return chain;
    },
    values() {
      return chain;
    },
    returning() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return chain;
    },
    offset() {
      return chain;
    },
    get: (...args: unknown[]) => state.get(...args),
    all: (...args: unknown[]) => state.all(...args),
    run: (...args: unknown[]) => state.run(...args),
  };
  state.chain = chain;
  return {
    select: spy(() => chain),
    insert: spy(() => chain),
    update: spy(() => chain),
    delete: spy(() => chain),
    _: state,
  };
}

type DrizzleMockHandle = ReturnType<typeof createDrizzleMock>;

/**
 * Install a DrizzleMock as the dep `memoryServiceDeps.getDb`. Centralises
 * the structural cast in a single typed bridge so test bodies stay free of
 * `as` clutter and demon `as unknown as` chains.
 */
function setMemoryServiceGetDb(drizzle: DrizzleMockHandle): void {
  const erased: (...args: never[]) => object = () => drizzle;
  memoryServiceDeps.getDb = erased as typeof memoryServiceDeps.getDb;
}

Deno.test("MEMORY_TYPES constant - includes the expected memory types", () => {
  assert(MEMORY_TYPES.includes("episode"));
  assert(MEMORY_TYPES.includes("semantic"));
  assert(MEMORY_TYPES.includes("procedural"));
  assertEquals(MEMORY_TYPES.length, 3);
});

Deno.test("listMemories - returns mapped memories from the database", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.now = () => "2026-01-01T00:00:00.000Z";
  const drizzle = createDrizzleMock();
  setMemoryServiceGetDb(drizzle);
  drizzle._.all = async () => [
    {
      id: "m-1",
      accountId: "space-1",
      authorAccountId: "user-1",
      threadId: "thread-1",
      type: "semantic",
      category: "fact",
      content: "User works in fintech",
      summary: null,
      importance: 0.8,
      tags: null,
      occurredAt: "2026-01-01T00:00:00.000Z",
      expiresAt: null,
      lastAccessedAt: null,
      accessCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  mocks.getDb = () => drizzle;

  const { listMemories } = await import("@/services/memory/memories");
  const result = await listMemories(
    noopSqlDatabaseBinding(),
    "space-1",
    {},
  );

  assertEquals(result.length, 1);
  assertEquals(result[0].id, "m-1");
  assertEquals(result[0].space_id, "space-1");
  assertEquals(result[0].user_id, "user-1");
  assertEquals(result[0].type, "semantic");
  assertEquals(result[0].category, "fact");
  assertEquals(result[0].content, "User works in fintech");
  assertEquals(result[0].importance, 0.8);
});
Deno.test("listMemories - defaults importance to 0.5 when null", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.now = () => "2026-01-01T00:00:00.000Z";
  const drizzle = createDrizzleMock();
  setMemoryServiceGetDb(drizzle);
  drizzle._.all = async () => [
    {
      id: "m-1",
      accountId: "space-1",
      authorAccountId: null,
      threadId: null,
      type: "semantic",
      category: null,
      content: "test",
      summary: null,
      importance: null,
      tags: null,
      occurredAt: null,
      expiresAt: null,
      lastAccessedAt: null,
      accessCount: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  mocks.getDb = () => drizzle;

  const { listMemories } = await import("@/services/memory/memories");
  const result = await listMemories(
    noopSqlDatabaseBinding(),
    "space-1",
    {},
  );

  assertEquals(result[0].importance, 0.5);
  assertEquals(result[0].access_count, 0);
});
Deno.test("listMemories - defaults type to semantic for unknown types", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.now = () => "2026-01-01T00:00:00.000Z";
  const drizzle = createDrizzleMock();
  setMemoryServiceGetDb(drizzle);
  drizzle._.all = async () => [
    {
      id: "m-1",
      accountId: "space-1",
      authorAccountId: null,
      threadId: null,
      type: "unknown_type",
      category: null,
      content: "test",
      summary: null,
      importance: 0.5,
      tags: null,
      occurredAt: null,
      expiresAt: null,
      lastAccessedAt: null,
      accessCount: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  mocks.getDb = () => drizzle;

  const { listMemories } = await import("@/services/memory/memories");
  const result = await listMemories(
    noopSqlDatabaseBinding(),
    "space-1",
    {},
  );

  assertEquals(result[0].type, "semantic");
});

Deno.test("createMemory - inserts a new memory and retrieves it", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.generateId = () => "new-mem-id";
  mocks.now = () => "2026-01-01T00:00:00.000Z";
  const drizzle = createDrizzleMock();
  setMemoryServiceGetDb(drizzle);
  memoryServiceDeps.generateId =
    (() => "new-mem-id") as typeof memoryServiceDeps.generateId;
  memoryServiceDeps.now =
    (() => "2026-01-01T00:00:00.000Z") as typeof memoryServiceDeps.now;
  drizzle._.get = async () => ({
    id: "new-mem-id",
    accountId: "space-1",
    authorAccountId: "user-1",
    threadId: null,
    type: "semantic",
    category: "project",
    content: "Using React for frontend",
    summary: null,
    importance: 0.8,
    tags: '["react","frontend"]',
    occurredAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  mocks.getDb = () => drizzle;

  const { createMemory } = await import("@/services/memory/memories");
  const result = await createMemory(noopSqlDatabaseBinding(), {
    spaceId: "space-1",
    userId: "user-1",
    type: "semantic",
    content: "Using React for frontend",
    category: "project",
    importance: 0.8,
    tags: ["react", "frontend"],
  });

  assertNotEquals(result, null);
  assertEquals(result?.id, "new-mem-id");
  assertEquals(result?.type, "semantic");
  assertEquals(result?.content, "Using React for frontend");
});

Deno.test("bumpMemoryAccess - does nothing for empty array", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.now = () => "2026-01-01T00:00:00.000Z";
  const drizzle = createDrizzleMock();
  setMemoryServiceGetDb(drizzle);
  mocks.getDb = () => drizzle;

  const { bumpMemoryAccess } = await import("@/services/memory/memories");
  await bumpMemoryAccess(noopSqlDatabaseBinding(), []);

  assertSpyCalls(drizzle.update, 0);
});
Deno.test("bumpMemoryAccess - updates access count and timestamp for given ids", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.now = () => "2026-01-01T00:00:00.000Z";
  const drizzle = createDrizzleMock();
  setMemoryServiceGetDb(drizzle);
  memoryServiceDeps.now =
    (() => "2026-01-01T00:00:00.000Z") as typeof memoryServiceDeps.now;
  mocks.getDb = () => drizzle;

  const { bumpMemoryAccess } = await import("@/services/memory/memories");
  await bumpMemoryAccess(noopSqlDatabaseBinding(), ["m-1", "m-2"]);

  assert(drizzle.update.calls.length > 0);
});

Deno.test("deleteMemory - deletes a memory by id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  setMemoryServiceGetDb(drizzle);
  mocks.getDb = () => drizzle;

  const { deleteMemory } = await import("@/services/memory/memories");
  await deleteMemory(noopSqlDatabaseBinding(), "m-1");

  assert(drizzle.delete.calls.length > 0);
});

Deno.test("createReminder - creates a reminder and returns it", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.generateId = () => "rem-id";
  mocks.now = () => "2026-01-01T00:00:00.000Z";
  const drizzle = createDrizzleMock();
  setMemoryServiceGetDb(drizzle);
  memoryServiceDeps.generateId =
    (() => "rem-id") as typeof memoryServiceDeps.generateId;
  memoryServiceDeps.now =
    (() => "2026-01-01T00:00:00.000Z") as typeof memoryServiceDeps.now;
  drizzle._.get = async () => ({
    id: "rem-id",
    accountId: "space-1",
    ownerAccountId: "user-1",
    content: "Follow up on PR",
    context: null,
    triggerType: "time",
    triggerValue: "2026-02-01T00:00:00.000Z",
    status: "pending",
    triggeredAt: null,
    priority: "normal",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  mocks.getDb = () => drizzle;

  const { createReminder } = await import("@/services/memory/memories");
  const result = await createReminder(noopSqlDatabaseBinding(), {
    spaceId: "space-1",
    userId: "user-1",
    content: "Follow up on PR",
    triggerType: "time",
    triggerValue: "2026-02-01T00:00:00.000Z",
  });

  assertNotEquals(result, null);
  assertEquals(result?.id, "rem-id");
  assertEquals(result?.content, "Follow up on PR");
  assertEquals(result?.trigger_type, "time");
  assertEquals(result?.status, "pending");
  assertEquals(result?.priority, "normal");
});

Deno.test("triggerReminder - sets status to triggered and updates triggeredAt", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.now = () => "2026-01-15T00:00:00.000Z";
  const drizzle = createDrizzleMock();
  setMemoryServiceGetDb(drizzle);
  memoryServiceDeps.now =
    (() => "2026-01-15T00:00:00.000Z") as typeof memoryServiceDeps.now;
  drizzle._.get = async () => ({
    id: "rem-1",
    accountId: "space-1",
    ownerAccountId: "user-1",
    content: "Reminder",
    context: null,
    triggerType: "time",
    triggerValue: null,
    status: "triggered",
    triggeredAt: "2026-01-15T00:00:00.000Z",
    priority: "high",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
  });
  mocks.getDb = () => drizzle;

  const { triggerReminder } = await import("@/services/memory/memories");
  const result = await triggerReminder(
    noopSqlDatabaseBinding(),
    "rem-1",
  );

  assertNotEquals(result, null);
  assertEquals(result?.status, "triggered");
  assertEquals(result?.triggered_at, "2026-01-15T00:00:00.000Z");
});
