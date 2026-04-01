import type { D1Database } from "@cloudflare/workers-types";

import { assertEquals, assertObjectMatch } from "jsr:@std/assert";

import {
  checkThreadAccess,
  createThread,
  listThreadMessages,
  threadServiceDeps,
} from "@/services/threads/thread-service";

const mocks = {
  getDb: (db: unknown) => db as never,
  checkSpaceAccess: async (..._args: unknown[]) => null,
  generateId: () => "new-thread-id",
};

threadServiceDeps.getDb = ((db) => mocks.getDb(db)) as typeof threadServiceDeps.getDb;
threadServiceDeps.checkSpaceAccess = ((
  ...args: Parameters<typeof threadServiceDeps.checkSpaceAccess>
) => mocks.checkSpaceAccess(...args)) as typeof threadServiceDeps.checkSpaceAccess;
threadServiceDeps.generateId = (() => mocks.generateId()) as typeof threadServiceDeps.generateId;

type SelectResponse = {
  get?: unknown;
  all?: unknown[];
};

function createDrizzleMock(
  selectResponses: SelectResponse[],
  insertGet?: unknown,
) {
  let selectIdx = 0;
  return {
    select() {
      const response = selectResponses[selectIdx++] ?? {};
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => chain;
      chain.offset = () => chain;
      chain.get = async () => response.get ?? null;
      chain.all = async () => response.all ?? [];
      return chain;
    },
    insert() {
      const chain: Record<string, unknown> = {};
      chain.values = () => chain;
      chain.returning = () => ({
        get: async () => insertGet ?? null,
      });
      return chain;
    },
  };
}

Deno.test("thread access fallback guards (issue 186) - rejects invalid IDs before DB query", async () => {
  assertEquals(await checkThreadAccess({} as D1Database, "bad id", "user-1"), null);
});

Deno.test("thread access fallback guards (issue 186) - returns thread access when thread exists and user has workspace access", async () => {
  mocks.checkSpaceAccess = (async () => ({
    membership: { role: "owner" },
  })) as any;
  const db = createDrizzleMock([
    {
      get: {
        id: "thread-1",
        accountId: "ws-1",
        title: "Hello",
        locale: null,
        status: "active",
        summary: null,
        keyPoints: "[]",
        retrievalIndex: -1,
        contextWindow: 50,
        createdAt: "2026-02-13T00:00:00.000Z",
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
    },
  ]);

  const result = await checkThreadAccess(db, "thread-1", "user-1");

  assertEquals(result, {
    thread: {
      id: "thread-1",
      space_id: "ws-1",
      title: "Hello",
      locale: null,
      status: "active",
      summary: null,
      key_points: "[]",
      retrieval_index: -1,
      context_window: 50,
      created_at: "2026-02-13T00:00:00.000Z",
      updated_at: "2026-02-13T00:00:00.000Z",
    },
    role: "owner",
  });
});

Deno.test("thread access fallback guards (issue 186) - returns null when thread not found in DB", async () => {
  mocks.checkSpaceAccess = (async () => null) as any;
  const db = createDrizzleMock([{ get: null }]);
  const result = await checkThreadAccess(db, "thread-1", "user-1");

  assertEquals(result, null);
  void db;
});

Deno.test("thread access fallback guards (issue 186) - returns null when user has no workspace access", async () => {
  mocks.checkSpaceAccess = (async () => null) as any;
  const db = createDrizzleMock([
    {
      get: {
        id: "thread-1",
        accountId: "ws-1",
        title: "Hello",
        locale: null,
        status: "active",
        summary: null,
        keyPoints: "[]",
        retrievalIndex: -1,
        contextWindow: 50,
        createdAt: "2026-02-13T00:00:00.000Z",
        updatedAt: "2026-02-13T00:00:00.000Z",
      },
    },
  ]);

  const result = await checkThreadAccess(db, "thread-1", "user-1");

  assertEquals(result, null);
  void db;
});

Deno.test("thread access fallback guards (issue 186) - lists thread messages via Drizzle query", async () => {
  const db = createDrizzleMock([
    {
      all: [
        {
          id: "msg-1",
          threadId: "thread-1",
          role: "user",
          content: "hello",
          r2Key: null,
          toolCalls: null,
          toolCallId: null,
          metadata: "{}",
          sequence: 1,
          createdAt: "2026-03-06T10:00:00.000Z",
        },
      ],
    },
    { get: { count: 1 } },
    {
      all: [
        {
          id: "run-1",
          threadId: "thread-1",
          accountId: "ws-1",
          sessionId: null,
          parentRunId: null,
          childThreadId: null,
          rootThreadId: "thread-1",
          rootRunId: "run-1",
          agentType: "default",
          status: "completed",
          input: "{}",
          output: null,
          error: null,
          usage: "{}",
          serviceId: null,
          serviceHeartbeat: null,
          startedAt: null,
          completedAt: null,
          createdAt: "2026-03-06T10:01:00.000Z",
        },
      ],
    },
  ]);

  const result = await listThreadMessages({} as never, db, "thread-1", 100, 0);

  assertEquals(result, {
    messages: [
      {
        id: "msg-1",
        thread_id: "thread-1",
        role: "user",
        content: "hello",
        tool_calls: null,
        tool_call_id: null,
        metadata: "{}",
        sequence: 1,
        created_at: "2026-03-06T10:00:00.000Z",
      },
    ],
    total: 1,
    runs: [
      {
        id: "run-1",
        thread_id: "thread-1",
        space_id: "ws-1",
        session_id: null,
        parent_run_id: null,
        child_thread_id: null,
        root_thread_id: "thread-1",
        root_run_id: "run-1",
        agent_type: "default",
        status: "completed",
        input: "{}",
        output: null,
        error: null,
        usage: "{}",
        worker_id: null,
        worker_heartbeat: null,
        started_at: null,
        completed_at: null,
        created_at: "2026-03-06T10:01:00.000Z",
      },
    ],
  });
});

Deno.test("thread access fallback guards (issue 186) - creates a thread via Drizzle insert", async () => {
  const insertedRow = {
    id: "new-thread-id",
    accountId: "ws-1",
    title: "Hello",
    locale: null,
    status: "active",
    summary: null,
    keyPoints: "[]",
    retrievalIndex: -1,
    contextWindow: 50,
    createdAt: "2026-03-06T00:00:00.000Z",
    updatedAt: "2026-03-06T00:00:00.000Z",
  };
  const db = createDrizzleMock([], insertedRow);

  const result = await createThread(db, "ws-1", { title: "Hello" });

  assertObjectMatch(result!, {
    space_id: "ws-1",
    title: "Hello",
    status: "active",
    summary: null,
    key_points: "[]",
    retrieval_index: -1,
    context_window: 50,
  });
  void db;
});
