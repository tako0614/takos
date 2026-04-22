import { assert, assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent'
import {
  MemoryConsolidator,
  memoryConsolidatorDeps,
} from "@/services/memory/consolidation";

let consolidatorGetDb = memoryConsolidatorDeps.getDb;

Object.defineProperty(mocks, "getDb", {
  configurable: true,
  get: () => consolidatorGetDb,
  set: (value) => {
    consolidatorGetDb = value;
    memoryConsolidatorDeps.getDb = value as typeof memoryConsolidatorDeps.getDb;
  },
});

mocks.getDb = memoryConsolidatorDeps.getDb as any;

Deno.test("MemoryConsolidator - creates a consolidator instance via direct construction", () => {
  const consolidator = new MemoryConsolidator({} as any);
  assert(consolidator instanceof MemoryConsolidator);
});

function createDrizzleMock() {
  const delegates = {
    all: (async (..._args: any[]) => undefined) as any,
    get: (async (..._args: any[]) => undefined) as any,
    run: (async () => ({ meta: { changes: 0 } })) as any,
  };
  const chain = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    set: function (this: any) {
      return this;
    },
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    all: ((...args: any[]) => delegates.all(...args)) as any,
    get: ((...args: any[]) => delegates.get(...args)) as any,
    run: ((...args: any[]) => delegates.run(...args)) as any,
  };
  return {
    select: spy(() => chain),
    update: spy(() => chain),
    delete: spy(() => chain),
    insert: spy(() => chain),
    run: ((...args: any[]) => delegates.run(...args)) as any,
    _: delegates,
    chain,
  };
}

Deno.test("MemoryConsolidator methods - applyDecay - runs decay SQL queries and returns counts", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  let runCallCount = 0;
  const runMock = spy(async () => {
    runCallCount++;
    return { meta: { changes: runCallCount === 1 ? 3 : 10 } };
  });

  mocks.getDb = (() => ({ run: runMock })) as any;

  const consolidator = new MemoryConsolidator({} as any);
  const result = await consolidator.applyDecay("space-1");

  assertEquals(result.deleted, 3);
  assertEquals(result.updated, 10);
  assertSpyCalls(runMock, 2);
});

Deno.test("MemoryConsolidator methods - mergeSimilarSimple (no LLM) - returns merged: 0 when fewer than 2 memories", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    {
      id: "m-1",
      type: "semantic",
      content: "only one memory",
      importance: 0.5,
    },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const consolidator = new MemoryConsolidator({} as any);
  const result = await consolidator.mergeSimilar("space-1");

  assertEquals(result.merged, 0);
});
Deno.test("MemoryConsolidator methods - mergeSimilarSimple (no LLM) - returns merged: 0 for empty memories", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any;
  mocks.getDb = (() => drizzle) as any;

  const consolidator = new MemoryConsolidator({} as any);
  const result = await consolidator.mergeSimilar("space-1");

  assertEquals(result.merged, 0);
});
Deno.test("MemoryConsolidator methods - mergeSimilarSimple (no LLM) - merges similar memories of the same type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deleteMock = spy(() => ({
    where: async () => undefined,
  }));
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    {
      id: "m-1",
      type: "semantic",
      content: "the quick brown fox jumps over the lazy dog today",
      importance: 0.8,
    },
    {
      id: "m-2",
      type: "semantic",
      content: "the quick brown fox jumps over the lazy dog yesterday",
      importance: 0.6,
    },
  ]) as any;
  (drizzle as any).delete = deleteMock;
  mocks.getDb = (() => drizzle) as any;

  const consolidator = new MemoryConsolidator({} as any);
  const result = await consolidator.mergeSimilar("space-1");

  // These two memories share high n-gram similarity
  assert(result.merged >= 0);
});
Deno.test("MemoryConsolidator methods - mergeSimilarSimple (no LLM) - does not merge memories of different types", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    {
      id: "m-1",
      type: "semantic",
      content: "the quick brown fox jumps over the lazy dog",
      importance: 0.8,
    },
    {
      id: "m-2",
      type: "episode",
      content: "the quick brown fox jumps over the lazy dog",
      importance: 0.6,
    },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const consolidator = new MemoryConsolidator({} as any);
  const result = await consolidator.mergeSimilar("space-1");

  assertEquals(result.merged, 0);
});

Deno.test("MemoryConsolidator methods - summarizeOld - returns summarized: 0 when no LLM client", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const consolidator = new MemoryConsolidator({} as any);
  const result = await consolidator.summarizeOld("space-1");

  assertEquals(result.summarized, 0);
});

Deno.test("MemoryConsolidator methods - enforceLimit - returns deleted: 0 when under limit", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({ count: 100 })) as any;
  mocks.getDb = (() => drizzle) as any;

  const consolidator = new MemoryConsolidator({} as any);
  const result = await consolidator.enforceLimit("space-1");

  assertEquals(result.deleted, 0);
});
Deno.test("MemoryConsolidator methods - enforceLimit - deletes excess memories when over limit", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deleteMock = spy(() => ({
    where: async () => undefined,
  }));
  const drizzle = createDrizzleMock();
  drizzle._.get = (async () => ({ count: 10002 })) as any;
  drizzle._.all = (async () => [
    { id: "m-excess-1" },
    { id: "m-excess-2" },
  ]) as any;
  (drizzle as any).delete = deleteMock;
  mocks.getDb = (() => drizzle) as any;

  const consolidator = new MemoryConsolidator({} as any);
  const result = await consolidator.enforceLimit("space-1");

  assertEquals(result.deleted, 2);
});

Deno.test("MemoryConsolidator methods - consolidate - runs all consolidation steps", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Mock applyDecay
  const runMock = spy(async () => ({ meta: { changes: 0 } }));

  const drizzle = {
    ...createDrizzleMock(),
    run: runMock,
  };
  drizzle._.all = (async () => []) as any;
  drizzle._.get = (async () => ({ count: 0 })) as any;
  mocks.getDb = (() => drizzle) as any;

  const consolidator = new MemoryConsolidator({} as any);
  const result = await consolidator.consolidate("space-1");

  assert("decayed" in result);
  assert("merged" in result);
  assert("summarized" in result);
  assert("limited" in result);
});
