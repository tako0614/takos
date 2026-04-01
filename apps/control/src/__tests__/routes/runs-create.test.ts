import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assertEquals } from "@std/assert";
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

const env = createMockEnv();

Deno.test("POST /threads/:threadId/runs - returns the queued run", async () => {
  const originalDeps = { ...runsRouteDeps };
  try {
    type CreateThreadRunInput = {
      userId: string;
      threadId: string;
      agentType?: string;
      input?: Record<string, unknown>;
      parentRunId?: string;
      model?: string;
    };
    const createThreadRun = createRecordedMock(
      (_env: Env, _input: CreateThreadRunInput) =>
        Promise.resolve({
          ok: true,
          status: 201,
          run: { id: "run-1", status: "queued" },
        }),
    );
    Object.assign(runsRouteDeps, {
      createThreadRun,
    });

    const app = createApp(createUser("user-1", "alice"));
    const response = await app.fetch(
      new Request("https://takos.jp/api/threads/thread-1/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: {} }),
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 201);
    assertEquals(await response.json(), {
      run: { id: "run-1", status: "queued" },
    });
    assertEquals(createThreadRun.calls.length, 1);
    const call = createThreadRun.calls[0];
    if (!call) throw new Error("Expected createThreadRun to be called");
    assertEquals(call.args[1], {
      userId: "user-1",
      threadId: "thread-1",
      agentType: undefined,
      input: {},
      parentRunId: undefined,
      model: undefined,
    });
  } finally {
    Object.assign(runsRouteDeps, originalDeps);
  }
});

Deno.test("POST /threads/:threadId/runs - rejects malformed parent_run_id before lookup", async () => {
  const originalDeps = { ...runsRouteDeps };
  try {
    const createThreadRun = createRecordedMock(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        error: "Invalid parent_run_id",
      })
    );
    Object.assign(runsRouteDeps, { createThreadRun });

    const app = createApp(createUser("user-1", "alice"));
    const response = await app.fetch(
      new Request("https://takos.jp/api/threads/thread-1/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: {}, parent_run_id: "bad id" }),
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      error: {
        code: "BAD_REQUEST",
        message: "Invalid parent_run_id",
      },
    });
    assertEquals(createThreadRun.calls.length, 1);
  } finally {
    Object.assign(runsRouteDeps, originalDeps);
  }
});

Deno.test("POST /threads/:threadId/runs - returns the created run payload", async () => {
  const originalDeps = { ...runsRouteDeps };
  try {
    type CreateThreadRunInput = {
      userId: string;
      threadId: string;
      agentType?: string;
      input?: Record<string, unknown>;
      parentRunId?: string;
      model?: string;
    };
    const createThreadRun = createRecordedMock(
      (_env: Env, _input: CreateThreadRunInput) =>
        Promise.resolve({
          ok: true,
          status: 201,
          run: { id: "run-2", status: "queued" },
        }),
    );
    Object.assign(runsRouteDeps, { createThreadRun });

    const app = createApp(createUser("user-1", "alice"));
    const response = await app.fetch(
      new Request("https://takos.jp/api/threads/thread-1/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: {}, model: "gpt-5.4-nano" }),
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 201);
    assertEquals(await response.json(), {
      run: { id: "run-2", status: "queued" },
    });
    const call = createThreadRun.calls[0];
    if (!call) throw new Error("Expected createThreadRun to be called");
    assertEquals(call.args[1], {
      userId: "user-1",
      threadId: "thread-1",
      agentType: undefined,
      input: {},
      parentRunId: undefined,
      model: "gpt-5.4-nano",
    });
  } finally {
    Object.assign(runsRouteDeps, originalDeps);
  }
});
