import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import threadMessagesRoutes, {
  threadMessagesRouteDeps,
} from "@/routes/thread-messages";

function createRecordedMock<T extends (...args: any[]) => any>(impl: T) {
  const fn = ((...args: Parameters<T>) => {
    fn.calls.push({ args });
    return impl(...args);
  }) as T & { calls: Array<{ args: Parameters<T> }> };
  fn.calls = [];
  return fn;
}

const mocks = {
  checkThreadAccess: ((..._args: any[]) => undefined) as any,
  createMessage: ((..._args: any[]) => undefined) as any,
  searchThreadMessages: ((..._args: any[]) => undefined) as any,
  getThreadTimeline: ((..._args: any[]) => undefined) as any,
  getThreadHistory: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - route deps are patched directly in tests.

type BaseVariables = { user: User };

function createUser(): User {
  return {
    id: "user-1",
    email: "user1@example.com",
    name: "User One",
    username: "user1",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  };
}

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
  installAppErrorHandler(app);
  Object.assign(threadMessagesRouteDeps, {
    checkThreadAccess: (...args: any[]) => mocks.checkThreadAccess(...args),
    createMessage: (...args: any[]) => mocks.createMessage(...args),
    searchThreadMessages: (...args: any[]) =>
      mocks.searchThreadMessages(...args),
    getThreadTimeline: (...args: any[]) => mocks.getThreadTimeline(...args),
    getThreadHistory: (...args: any[]) => mocks.getThreadHistory(...args),
  });
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", threadMessagesRoutes);
  return app;
}

let env: Env;

Deno.test("thread-messages routes - GET /api/threads/:id/messages - returns thread timeline messages", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1" },
  })) as any;
  mocks.getThreadTimeline = createRecordedMock(async () => ({
    messages: [
      { id: "msg-1", role: "user", content: "Hello" },
      { id: "msg-2", role: "assistant", content: "Hi there" },
    ],
    total: 2,
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/thread-1/messages"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as { messages: unknown[]; total: number };
  assertEquals(json.messages.length, 2);
  assertEquals(mocks.getThreadTimeline.calls[0]?.args, [
    env,
    "thread-1",
    100, // default limit
    0, // default offset
  ]);
});
Deno.test("thread-messages routes - GET /api/threads/:id/messages - returns 404 when thread not found or access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => null) as any;
  mocks.getThreadTimeline = createRecordedMock(async () => ({
    messages: [],
    total: 0,
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/thread-missing/messages"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
  assertEquals(mocks.getThreadTimeline.calls.length, 0);
});
Deno.test("thread-messages routes - GET /api/threads/:id/messages - passes limit and offset query parameters", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1" },
  })) as any;
  mocks.getThreadTimeline = createRecordedMock(async () => ({
    messages: [],
    total: 0,
  })) as any;

  const app = createApp(createUser());
  await app.fetch(
    new Request(
      "http://localhost/api/threads/thread-1/messages?limit=50&offset=10",
    ),
    env,
    {} as ExecutionContext,
  );

  assertEquals(mocks.getThreadTimeline.calls[0]?.args, [
    env,
    "thread-1",
    50,
    10,
  ]);
});

Deno.test("thread-messages routes - GET /api/threads/:id/history - returns thread history with messages", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1" },
  })) as any;
  mocks.getThreadHistory = createRecordedMock(async () => ({
    runs: [{ id: "run-1", status: "completed", messages: [] }],
    total: 1,
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/thread-1/history"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(mocks.getThreadHistory.calls[0]?.args, [env, "thread-1", {
    limit: 100,
    offset: 0,
    includeMessages: true,
    rootRunId: undefined,
  }]);
});
Deno.test("thread-messages routes - GET /api/threads/:id/history - returns 404 when thread access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/bad-thread/history"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("thread-messages routes - GET /api/threads/:id/history - passes include_messages=0 to exclude messages", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1" },
  })) as any;
  mocks.getThreadHistory = createRecordedMock(async () => ({
    runs: [],
    total: 0,
  })) as any;

  const app = createApp(createUser());
  await app.fetch(
    new Request(
      "http://localhost/api/threads/thread-1/history?include_messages=0",
    ),
    env,
    {} as ExecutionContext,
  );

  assertEquals(mocks.getThreadHistory.calls[0]?.args, [env, "thread-1", {
    limit: 100,
    offset: 0,
    includeMessages: false,
    rootRunId: undefined,
  }]);
});
Deno.test("thread-messages routes - GET /api/threads/:id/history - passes root_run_id filter", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1" },
  })) as any;
  mocks.getThreadHistory = createRecordedMock(async () => ({
    runs: [],
    total: 0,
  })) as any;

  const app = createApp(createUser());
  await app.fetch(
    new Request(
      "http://localhost/api/threads/thread-1/history?root_run_id=run-root-1",
    ),
    env,
    {} as ExecutionContext,
  );

  assertEquals(mocks.getThreadHistory.calls[0]?.args, [env, "thread-1", {
    limit: 100,
    offset: 0,
    includeMessages: true,
    rootRunId: "run-root-1",
  }]);
});

Deno.test("thread-messages routes - GET /api/threads/:id/messages/search - returns search results", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1" },
  })) as any;
  mocks.searchThreadMessages = createRecordedMock(async () => ({
    results: [
      { id: "msg-1", content: "Contains keyword", score: 0.9 },
    ],
    total: 1,
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request(
      "http://localhost/api/threads/thread-1/messages/search?q=keyword",
    ),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(mocks.searchThreadMessages.calls[0]?.args, [{
    env,
    spaceId: "ws-1",
    threadId: "thread-1",
    query: "keyword",
    type: "all",
    limit: 20,
    offset: 0,
  }]);
});
Deno.test("thread-messages routes - GET /api/threads/:id/messages/search - returns 400 when query is missing", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1" },
  })) as any;
  mocks.searchThreadMessages = createRecordedMock(async () => ({
    results: [],
    total: 0,
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/thread-1/messages/search"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
  assertEquals(mocks.searchThreadMessages.calls.length, 0);
});
Deno.test("thread-messages routes - GET /api/threads/:id/messages/search - returns 400 when query is empty/whitespace", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1" },
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/thread-1/messages/search?q=   "),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("thread-messages routes - GET /api/threads/:id/messages/search - returns 404 when thread not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/missing/messages/search?q=test"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("thread-messages routes - GET /api/threads/:id/messages/search - passes search type parameter", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1" },
  })) as any;
  mocks.searchThreadMessages = createRecordedMock(async () => ({
    results: [],
    total: 0,
  })) as any;

  const app = createApp(createUser());
  await app.fetch(
    new Request(
      "http://localhost/api/threads/thread-1/messages/search?q=test&type=semantic",
    ),
    env,
    {} as ExecutionContext,
  );

  assertEquals(mocks.searchThreadMessages.calls[0]?.args, [{
    env,
    spaceId: "ws-1",
    threadId: "thread-1",
    query: "test",
    type: "semantic",
    limit: 20,
    offset: 0,
  }]);
});

Deno.test("thread-messages routes - POST /api/threads/:id/messages - creates a message and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1", accountId: "ws-1" },
  })) as any;
  mocks.createMessage = createRecordedMock(async () => ({
    id: "msg-new",
    role: "user",
    content: "New message",
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/thread-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "user",
        content: "New message",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
  const json = await res.json() as { message: { id: string } };
  assertEquals(json.message.id, "msg-new");
});
Deno.test("thread-messages routes - POST /api/threads/:id/messages - returns 404 when thread not found or not writable", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => null) as any;
  mocks.createMessage = createRecordedMock(async () => ({
    id: "msg-new",
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/missing/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "user",
        content: "test",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
  assertEquals(mocks.createMessage.calls.length, 0);
});
Deno.test("thread-messages routes - POST /api/threads/:id/messages - rejects empty content without attachments", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1", accountId: "ws-1" },
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/thread-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "user",
        content: "",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
  const json = await res.json() as { error: { message: string } };
  assertStringIncludes(json.error.message, "Content is required");
});
Deno.test("thread-messages routes - POST /api/threads/:id/messages - rejects invalid role", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/thread-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "invalid_role",
        content: "test",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  // Zod validation rejects invalid enum before route-level handling.
  assertEquals(res.status, 400);
});
Deno.test("thread-messages routes - POST /api/threads/:id/messages - accepts tool role with tool_call_id", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.checkThreadAccess = (async () => ({
    thread: { id: "thread-1", space_id: "ws-1", accountId: "ws-1" },
  })) as any;
  mocks.createMessage = createRecordedMock(async () => ({
    id: "msg-tool",
    role: "tool",
    content: '{"result": "ok"}',
    tool_call_id: "call-1",
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/thread-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "tool",
        content: '{"result": "ok"}',
        tool_call_id: "call-1",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
});
