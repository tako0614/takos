// deno-lint-ignore-file no-import-prefix no-unversioned-import require-await no-explicit-any
import type { D1Database } from "@cloudflare/workers-types";

import { assert, assertEquals } from "jsr:@std/assert";

import {
  createInfoUnitIndexer,
  InfoUnitIndexer,
} from "@/services/source/info-units";

type FakeStep = {
  get?: unknown;
  all?: unknown[];
  run?: unknown;
};

type PrepareCall = {
  sql: string;
  args: unknown[];
};

function createFakeD1Database(steps: FakeStep[]) {
  const prepareCalls: PrepareCall[] = [];
  let index = 0;
  const next = () => steps[index++] ?? {};
  const buildChain = (sql: string) => {
    const step = next();
    const chain: any = {
      from() {
        return chain;
      },
      where() {
        return chain;
      },
      innerJoin() {
        return chain;
      },
      leftJoin() {
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
      values() {
        return chain;
      },
      set() {
        return chain;
      },
      returning() {
        return chain;
      },
      get: async () => step.get ?? null,
      first: async () => step.get ?? null,
      all: async () => step.all ?? [],
      run: async () =>
        step.run ?? {
          success: true,
          meta: { changes: 0, last_row_id: 0, duration: 0 },
        },
      raw: async () => step.all ?? [],
    };
    prepareCalls.push({ sql, args: [] });
    return chain;
  };
  const db = {
    select() {
      return buildChain("select");
    },
    insert() {
      return buildChain("insert");
    },
    update() {
      return buildChain("update");
    },
    delete() {
      return buildChain("delete");
    },
  } as unknown as D1Database;

  return { db, prepareCalls };
}

Deno.test("createInfoUnitIndexer - returns null when DB is not provided", () => {
  const result = createInfoUnitIndexer({ DB: null } as any);
  assertEquals(result, null);
});

Deno.test("createInfoUnitIndexer - returns indexer when DB is provided", () => {
  const result = createInfoUnitIndexer({ DB: {} } as any);
  assert(result instanceof InfoUnitIndexer);
});

Deno.test("InfoUnitIndexer.indexRun - does nothing when run not found", async () => {
  const { db, prepareCalls } = createFakeD1Database([{ get: undefined }]);
  const indexer = new InfoUnitIndexer({ DB: db } as any);

  await indexer.indexRun("ws-1", "run-nonexistent");

  assertEquals(prepareCalls.length, 1);
});

Deno.test("InfoUnitIndexer.indexRun - does nothing when run belongs to different space", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    {
      get: {
        id: "run-1",
        accountId: "ws-other",
        threadId: null,
        sessionId: null,
        status: "completed",
        startedAt: null,
        completedAt: null,
      },
    },
  ]);
  const indexer = new InfoUnitIndexer({ DB: db } as any);

  await indexer.indexRun("ws-1", "run-1");

  assertEquals(prepareCalls.length, 1);
});

Deno.test("InfoUnitIndexer.indexRun - skips when info unit already exists", async () => {
  const { db, prepareCalls } = createFakeD1Database([
    {
      get: {
        id: "run-1",
        accountId: "ws-1",
        threadId: "t1",
        sessionId: "s1",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T01:00:00.000Z",
      },
    },
    { get: { id: "existing-unit" } },
  ]);
  const indexer = new InfoUnitIndexer({ DB: db } as any);

  await indexer.indexRun("ws-1", "run-1");

  assertEquals(prepareCalls.length, 2);
  assertEquals(
    prepareCalls.some((call) => call.sql.toLowerCase().includes("insert")),
    false,
  );
});

Deno.test(
  "InfoUnitIndexer.indexRun - indexes run events from D1 when no offload bucket",
  async () => {
    const { db, prepareCalls } = createFakeD1Database([
      {
        get: {
          id: "run-1",
          accountId: "ws-1",
          threadId: "t1",
          sessionId: null,
          status: "completed",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T01:00:00.000Z",
        },
      },
      { get: undefined },
      {
        all: [{
          id: 1,
          type: "message",
          data: JSON.stringify({ content: "Hello" }),
          createdAt: "2026-01-01T00:10:00.000Z",
        }],
      },
      { all: [] },
      { get: undefined },
      { get: undefined },
    ]);
    const indexer = new InfoUnitIndexer({ DB: db } as any);

    await indexer.indexRun("ws-1", "run-1");

    assertEquals(
      prepareCalls.some((call) => call.sql.toLowerCase().includes("insert")),
      true,
    );
  },
);
