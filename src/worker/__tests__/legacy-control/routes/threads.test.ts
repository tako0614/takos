import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assert, assertEquals } from "@std/assert";
import threadsRoute, { threadsRouteDeps } from "@/routes/threads";
import { asyncNoopDep, noopDep } from "@test/dep-stubs";

function createRecordedMock<
  T extends (...args: never[]) => unknown,
>(impl: T) {
  const fn = ((...args: Parameters<T>) => {
    fn.calls.push({ args });
    return impl(...args);
  }) as T & { calls: Array<{ args: Parameters<T> }> };
  fn.calls = [];
  return fn;
}

type RecordedCalls = { calls: Array<{ args: unknown[] }> };
type LooseAsyncFn =
  & ((...args: never[]) => Promise<unknown>)
  & Partial<RecordedCalls>;
type LooseFn =
  & ((...args: never[]) => unknown)
  & Partial<RecordedCalls>;
type ThreadsRouteMocks = {
  [K in keyof typeof threadsRouteDeps]: typeof threadsRouteDeps[K] extends
    (...args: never[]) => Promise<unknown> ? LooseAsyncFn
    : LooseFn;
};

const mocks: ThreadsRouteMocks = {
  checkThreadAccess: asyncNoopDep("threadsRouteDeps.checkThreadAccess"),
  createMessage: asyncNoopDep("threadsRouteDeps.createMessage"),
  createThread: asyncNoopDep("threadsRouteDeps.createThread"),
  deleteThread: asyncNoopDep("threadsRouteDeps.deleteThread"),
  listThreads: asyncNoopDep("threadsRouteDeps.listThreads"),
  updateThread: asyncNoopDep("threadsRouteDeps.updateThread"),
  updateThreadStatus: asyncNoopDep("threadsRouteDeps.updateThreadStatus"),
  createThreadShare: asyncNoopDep("threadsRouteDeps.createThreadShare"),
  listThreadShares: asyncNoopDep("threadsRouteDeps.listThreadShares"),
  revokeThreadShare: asyncNoopDep("threadsRouteDeps.revokeThreadShare"),
  searchSpaceThreads: asyncNoopDep("threadsRouteDeps.searchSpaceThreads"),
  searchThreadMessages: asyncNoopDep("threadsRouteDeps.searchThreadMessages"),
  getThreadTimeline: asyncNoopDep("threadsRouteDeps.getThreadTimeline"),
  getThreadHistory: asyncNoopDep("threadsRouteDeps.getThreadHistory"),
  exportThread: asyncNoopDep("threadsRouteDeps.exportThread"),
  requireSpaceAccess: asyncNoopDep("threadsRouteDeps.requireSpaceAccess"),
  getPlatformServices: noopDep("threadsRouteDeps.getPlatformServices"),
};

// [Deno] vi.mock removed - route deps are patched directly in tests.

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
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  installAppErrorHandler(app);
  type Forward<K extends keyof typeof threadsRouteDeps> =
    typeof threadsRouteDeps[K];
  function forward<K extends keyof typeof threadsRouteDeps>(
    key: K,
  ): Forward<K> {
    return ((...args: unknown[]) =>
      (mocks[key] as (...a: unknown[]) => unknown)(...args)) as Forward<K>;
  }
  Object.assign(threadsRouteDeps, {
    requireSpaceAccess: forward("requireSpaceAccess"),
    checkThreadAccess: forward("checkThreadAccess"),
    createMessage: forward("createMessage"),
    createThread: forward("createThread"),
    deleteThread: forward("deleteThread"),
    listThreads: forward("listThreads"),
    updateThread: forward("updateThread"),
    updateThreadStatus: forward("updateThreadStatus"),
    createThreadShare: forward("createThreadShare"),
    listThreadShares: forward("listThreadShares"),
    revokeThreadShare: forward("revokeThreadShare"),
    searchSpaceThreads: forward("searchSpaceThreads"),
    searchThreadMessages: forward("searchThreadMessages"),
    getThreadTimeline: forward("getThreadTimeline"),
    getThreadHistory: forward("getThreadHistory"),
    exportThread: forward("exportThread"),
    getPlatformServices: forward("getPlatformServices"),
  });
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", threadsRoute);
  return app;
}

const env = createMockEnv();

Deno.test("threads routes - GET /api/spaces/:spaceId/threads - returns threads list", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.listThreads = createRecordedMock(
    async () => [{ id: "t-1", title: "Test" }],
  );

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/threads"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), {
    threads: [{ id: "t-1", title: "Test" }],
  });
});
Deno.test("threads routes - GET /api/spaces/:spaceId/threads - passes status filter", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.listThreads = createRecordedMock(async () => []);

  const app = createApp(createUser());
  await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/threads?status=active"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(mocks.listThreads.calls?.[0]?.args, [
    env.DB,
    "ws-1",
    { status: "active" },
  ]);
});

Deno.test("threads routes - POST /api/spaces/:spaceId/threads - creates a thread and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.createThread = async () => ({ id: "t-new", title: "New Thread" });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Thread" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
  const json = await res.json() as Record<string, unknown>;
  assert("thread" in json);
});

Deno.test("threads routes - GET /api/threads/:id - returns thread with access role", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", title: "Test", space_id: "ws-1" },
    role: "owner",
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("thread" in json);
  assert("role" in json);
  assertEquals(json["role"], "owner");
});
Deno.test("threads routes - GET /api/threads/:id - returns 404 when access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-missing"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("threads routes - PATCH /api/threads/:id - updates thread title", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });
  mocks.updateThread = async () => ({ id: "t-1", title: "Updated" });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
Deno.test("threads routes - PATCH /api/threads/:id - returns 400 when no valid updates provided", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("threads routes - PATCH /api/threads/:id - validates context_window range", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context_window: 5 }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});

Deno.test("threads routes - DELETE /api/threads/:id - soft-deletes a thread", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });
  mocks.deleteThread = createRecordedMock(async () => undefined);

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1", { method: "DELETE" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { success: true });
  assertEquals(mocks.deleteThread.calls?.[0]?.args, [env, env.DB, "t-1"]);
});

Deno.test("threads routes - POST /api/threads/:id/archive - archives a thread", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });
  mocks.updateThreadStatus = createRecordedMock(async () => undefined);

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/archive", { method: "POST" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(mocks.updateThreadStatus.calls?.[0]?.args, [
    env.DB,
    "t-1",
    "archived",
  ]);
});

Deno.test("threads routes - POST /api/threads/:id/unarchive - unarchives a thread", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "editor",
  });
  mocks.updateThreadStatus = createRecordedMock(async () => undefined);

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/unarchive", {
      method: "POST",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(mocks.updateThreadStatus.calls?.[0]?.args, [
    env.DB,
    "t-1",
    "active",
  ]);
});

Deno.test("threads routes - GET /api/threads/:id/messages - returns timeline messages", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });
  mocks.getThreadTimeline = async () => ({ messages: [] });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/messages"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("threads routes - POST /api/threads/:id/messages - creates a message and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });
  mocks.createMessage = async () => ({ id: "msg-1", content: "Hi" });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: "Hi" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
});
Deno.test("threads routes - POST /api/threads/:id/messages - rejects empty content without attachments", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("threads routes - POST /api/threads/:id/messages - rejects invalid role", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "invalid", content: "Hi" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});

Deno.test("threads routes - GET /api/spaces/:spaceId/threads/search - returns 400 when q is missing", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/threads/search"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("threads routes - GET /api/spaces/:spaceId/threads/search - returns search results", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.searchSpaceThreads = async () => ({ threads: [] });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/threads/search?q=hello"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("threads routes - GET /api/threads/:id/messages/search - returns 400 when q is missing", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/messages/search"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});

Deno.test("threads routes - POST /api/threads/:id/share - creates a share and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });
  mocks.createThreadShare = async () => ({
    share: { token: "abc123", mode: "public" },
    passwordRequired: false,
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "public" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
  const json = await res.json() as Record<string, unknown>;
  assert("share_url" in json);
});
Deno.test("threads routes - POST /api/threads/:id/share - rejects invalid expires_in_days", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expires_in_days: 400 }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});

Deno.test("threads routes - GET /api/threads/:id/shares - returns share list with links", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });
  mocks.listThreadShares = async () => [
    { id: "s-1", token: "abc123" },
  ];

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/shares"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as {
    shares: Array<{ share_path: string; share_url: string }>;
  };
  assertEquals(json.shares[0].share_path, "/share/abc123");
});

Deno.test("threads routes - POST /api/threads/:id/shares/:shareId/revoke - revokes a share", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });
  mocks.revokeThreadShare = async () => true;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/shares/s-1/revoke", {
      method: "POST",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { success: true });
});
Deno.test("threads routes - POST /api/threads/:id/shares/:shareId/revoke - returns 404 when share not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
  mocks.getPlatformServices = () => ({
    documents: { renderPdf: noopDep("renderPdf") },
  });
  mocks.checkThreadAccess = async () => ({
    thread: { id: "t-1", space_id: "ws-1" },
    role: "owner",
  });
  mocks.revokeThreadShare = async () => false;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/threads/t-1/shares/s-missing/revoke", {
      method: "POST",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
