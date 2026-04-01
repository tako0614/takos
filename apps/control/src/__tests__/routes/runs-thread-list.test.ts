import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assertEquals, assertObjectMatch } from "@std/assert";
import { runsRouteDeps } from "@/routes/runs/deps.ts";
import runs from "@/routes/runs/routes";

function createRecordedMock<TArgs extends unknown[], TReturn>(
  impl: (...args: TArgs) => TReturn,
) {
  const fn = ((...args: TArgs) => {
    fn.calls.push({ args });
    return impl(...args);
  }) as ((...args: TArgs) => TReturn) & { calls: Array<{ args: TArgs }> };
  fn.calls = [];
  return fn;
}

function createUser(id: string, username: string): User {
  return {
    id,
    email: `${username}@example.com`,
    name: username,
    username,
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-02-21T00:00:00.000Z",
    updated_at: "2026-02-21T00:00:00.000Z",
  };
}

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  installAppErrorHandler(app);
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", runs);
  return app;
}

function createRunRow(id: string, createdAt: string) {
  return {
    id,
    threadId: "thread-1",
    accountId: "ws-1",
    sessionId: null,
    parentRunId: null,
    agentType: "default",
    status: "running",
    input: "{}",
    output: null,
    error: null,
    usage: "{}",
    workerId: null,
    workerHeartbeat: null,
    startedAt: null,
    completedAt: null,
    createdAt,
  };
}

const env = createMockEnv();

Deno.test("GET /threads/:threadId/runs - returns 400 when cursor is invalid", async () => {
  const originalDeps = { ...runsRouteDeps };
  try {
    Object.assign(runsRouteDeps, {
      checkThreadAccess: () =>
        Promise.resolve({
          thread: { id: "thread-1", space_id: "ws-1" },
          role: "owner",
        }),
    });

    const app = createApp(createUser("user-1", "alice"));
    const response = await app.fetch(
      new Request(
        "https://takos.jp/api/threads/thread-1/runs?cursor=not-a-date",
      ),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 400);
    await assertObjectMatch(await response.json(), {
      error: {
        code: "BAD_REQUEST",
        message: "Invalid cursor",
      },
    });
  } finally {
    Object.assign(runsRouteDeps, originalDeps);
  }
});

Deno.test("GET /threads/:threadId/runs - applies active_only/limit/cursor query and returns pagination metadata", async () => {
  const originalDeps = { ...runsRouteDeps };
  try {
    const selectAll = createRecordedMock(() =>
      Promise.resolve([
        createRunRow("run-2", "2026-02-21T11:00:00.000Z"),
        createRunRow("run-1", "2026-02-21T10:00:00.000Z"),
      ])
    );
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => chain;
    chain.all = selectAll;
    chain.get = () => Promise.resolve(undefined);

    Object.assign(runsRouteDeps, {
      checkThreadAccess: () =>
        Promise.resolve({
          thread: { id: "thread-1", space_id: "ws-1" },
          role: "owner",
        }),
      getDb: () => ({
        select: () => chain,
      }),
    });

    const cursor = "2026-02-21T12:00:00.000Z";
    const app = createApp(createUser("user-1", "alice"));
    const response = await app.fetch(
      new Request(
        `https://takos.jp/api/threads/thread-1/runs?active_only=1&limit=2&cursor=${
          encodeURIComponent(cursor)
        }`,
      ),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const payload = await response.json() as {
      runs: Array<{ id: string }>;
      limit: number;
      active_only: boolean;
      cursor: string;
      next_cursor: string | null;
    };

    assertEquals(payload.runs.map((run) => run.id), ["run-2", "run-1"]);
    assertEquals(payload.limit, 2);
    assertEquals(payload.active_only, true);
    assertEquals(payload.cursor, cursor);
    assertEquals(payload.next_cursor, "2026-02-21T10:00:00.000Z,run-1");
    assertEquals(selectAll.calls.length, 1);
  } finally {
    Object.assign(runsRouteDeps, originalDeps);
  }
});

Deno.test("GET /threads/:threadId/runs - supports composite cursor token with createdAt + run id for stable pagination", async () => {
  const originalDeps = { ...runsRouteDeps };
  try {
    const selectAll = createRecordedMock(() =>
      Promise.resolve([
        createRunRow("run-9", "2026-02-21T12:00:00.000Z"),
      ])
    );
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => chain;
    chain.all = selectAll;
    chain.get = () => Promise.resolve(undefined);

    Object.assign(runsRouteDeps, {
      checkThreadAccess: () =>
        Promise.resolve({
          thread: { id: "thread-1", space_id: "ws-1" },
          role: "owner",
        }),
      getDb: () => ({
        select: () => chain,
      }),
    });

    const cursor = "2026-02-21T12:00:00.000Z,run-10";
    const app = createApp(createUser("user-1", "alice"));
    const response = await app.fetch(
      new Request(
        `https://takos.jp/api/threads/thread-1/runs?limit=1&cursor=${
          encodeURIComponent(cursor)
        }`,
      ),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const payload = await response.json() as {
      cursor: string | null;
      next_cursor: string | null;
    };
    assertEquals(payload.cursor, cursor);
    assertEquals(payload.next_cursor, "2026-02-21T12:00:00.000Z,run-9");
    assertEquals(selectAll.calls.length, 1);
  } finally {
    Object.assign(runsRouteDeps, originalDeps);
  }
});
