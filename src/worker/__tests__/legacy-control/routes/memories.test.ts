import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assert, assertEquals } from "@std/assert";
import { NotFoundError } from "@/routes/route-auth";
import { asyncNoopDep } from "@test/dep-stubs";

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

const mocks: {
  listMemories: LooseAsyncFn;
  bumpMemoryAccess: LooseAsyncFn;
  searchMemories: LooseAsyncFn;
  getMemoryById: LooseAsyncFn;
  createMemory: LooseAsyncFn;
  updateMemory: LooseAsyncFn;
  deleteMemory: LooseAsyncFn;
  listReminders: LooseAsyncFn;
  getReminderById: LooseAsyncFn;
  createReminder: LooseAsyncFn;
  updateReminder: LooseAsyncFn;
  deleteReminder: LooseAsyncFn;
  triggerReminder: LooseAsyncFn;
  requireSpaceAccess: LooseAsyncFn;
  checkWorkspaceAccess: LooseAsyncFn;
} = {
  listMemories: asyncNoopDep("memoriesRouteDeps.listMemories"),
  bumpMemoryAccess: asyncNoopDep("memoriesRouteDeps.bumpMemoryAccess"),
  searchMemories: asyncNoopDep("memoriesRouteDeps.searchMemories"),
  getMemoryById: asyncNoopDep("memoriesRouteDeps.getMemoryById"),
  createMemory: asyncNoopDep("memoriesRouteDeps.createMemory"),
  updateMemory: asyncNoopDep("memoriesRouteDeps.updateMemory"),
  deleteMemory: asyncNoopDep("memoriesRouteDeps.deleteMemory"),
  listReminders: asyncNoopDep("memoriesRouteDeps.listReminders"),
  getReminderById: asyncNoopDep("memoriesRouteDeps.getReminderById"),
  createReminder: asyncNoopDep("memoriesRouteDeps.createReminder"),
  updateReminder: asyncNoopDep("memoriesRouteDeps.updateReminder"),
  deleteReminder: asyncNoopDep("memoriesRouteDeps.deleteReminder"),
  triggerReminder: asyncNoopDep("memoriesRouteDeps.triggerReminder"),
  requireSpaceAccess: asyncNoopDep("memoriesRouteDeps.requireSpaceAccess"),
  checkWorkspaceAccess: asyncNoopDep("memoriesRouteDeps.checkWorkspaceAccess"),
};

// [Deno] vi.mock removed - manually stub imports from '@/services/memory'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
import memoriesRoute, { memoriesRouteDeps } from "@/routes/memories";

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
  type Forward<K extends keyof typeof memoriesRouteDeps> =
    typeof memoriesRouteDeps[K];
  function forward<K extends keyof typeof memoriesRouteDeps>(
    mockKey: keyof typeof mocks,
  ): Forward<K> {
    return ((...args: unknown[]) =>
      (mocks[mockKey] as (...a: unknown[]) => unknown)(
        ...args,
      )) as Forward<K>;
  }
  Object.assign(memoriesRouteDeps, {
    listMemories: forward<"listMemories">("listMemories"),
    bumpMemoryAccess: forward<"bumpMemoryAccess">("bumpMemoryAccess"),
    searchMemories: forward<"searchMemories">("searchMemories"),
    getMemoryById: forward<"getMemoryById">("getMemoryById"),
    createMemory: forward<"createMemory">("createMemory"),
    updateMemory: forward<"updateMemory">("updateMemory"),
    deleteMemory: forward<"deleteMemory">("deleteMemory"),
    listReminders: forward<"listReminders">("listReminders"),
    getReminderById: forward<"getReminderById">("getReminderById"),
    createReminder: forward<"createReminder">("createReminder"),
    updateReminder: forward<"updateReminder">("updateReminder"),
    deleteReminder: forward<"deleteReminder">("deleteReminder"),
    triggerReminder: forward<"triggerReminder">("triggerReminder"),
    requireSpaceAccess: forward<"requireSpaceAccess">("requireSpaceAccess"),
    checkSpaceAccess: forward<"checkSpaceAccess">("checkWorkspaceAccess"),
  });
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", memoriesRoute);
  return app;
}

function mockWorkspaceAccess() {
  mocks.requireSpaceAccess = async () => ({ space: { id: "ws-1" } });
}

const env = createMockEnv();

Deno.test("memories routes - GET /api/spaces/:spaceId/memories - returns memories list", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  const memories = [{ id: "m-1", content: "Hello", type: "episode" }];
  mocks.listMemories = async () => memories;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/memories"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { memories });
});
Deno.test("memories routes - GET /api/spaces/:spaceId/memories - returns 404 when workspace access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.requireSpaceAccess = async () => {
    throw new NotFoundError("Space");
  };

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-bad/memories"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("memories routes - GET /api/spaces/:spaceId/memories/search - returns search results", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.searchMemories = async () => [{ id: "m-1", content: "Match" }];

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/memories/search?q=test"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("memories" in json);
});

Deno.test("memories routes - GET /api/memories/:id - returns a specific memory", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  const memory = { id: "m-1", content: "Hello", space_id: "ws-1" };
  mocks.getMemoryById = async () => memory;
  mocks.checkWorkspaceAccess = async () => true;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-1"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
Deno.test("memories routes - GET /api/memories/:id - returns 404 when memory not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.getMemoryById = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-missing"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("memories routes - GET /api/memories/:id - returns 403 when workspace access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.getMemoryById = async () => ({ id: "m-1", space_id: "ws-other" });
  mocks.checkWorkspaceAccess = async () => false;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-1"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});

Deno.test("memories routes - POST /api/spaces/:spaceId/memories - creates a memory and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  const created = { id: "m-new", content: "New memory", type: "episode" };
  mocks.createMemory = createRecordedMock(async () => created);

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "episode",
        content: "New memory",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
  assertEquals((mocks.createMemory.calls?.length ?? 0) > 0, true);
});
Deno.test("memories routes - POST /api/spaces/:spaceId/memories - rejects invalid type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "invalid_type",
        content: "Hello",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("memories routes - POST /api/spaces/:spaceId/memories - rejects empty content", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "episode",
        content: "",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});

Deno.test("memories routes - PATCH /api/memories/:id - updates a memory", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.getMemoryById = async () => ({ id: "m-1", space_id: "ws-1" });
  mocks.checkWorkspaceAccess = async () => true;
  mocks.updateMemory = async () => ({ id: "m-1", content: "Updated" });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Updated" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
Deno.test("memories routes - PATCH /api/memories/:id - returns 404 when memory not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.getMemoryById = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-missing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Updated" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("memories routes - DELETE /api/memories/:id - deletes a memory", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.getMemoryById = async () => ({ id: "m-1", space_id: "ws-1" });
  mocks.checkWorkspaceAccess = async () => true;
  mocks.deleteMemory = async () => undefined;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-1", { method: "DELETE" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { success: true });
});

Deno.test("memories routes - Reminders - GET /api/spaces/:spaceId/reminders - returns reminders list", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.listReminders = async () => [{ id: "r-1", content: "Test" }];

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/reminders"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), {
    reminders: [{ id: "r-1", content: "Test" }],
  });
});

Deno.test("memories routes - Reminders - GET /api/reminders/:id - returns 404 for non-existent reminder", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.getReminderById = async () => null;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/r-missing"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("memories routes - Reminders - GET /api/reminders/:id - returns 403 when workspace access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.getReminderById = async () => ({ id: "r-1", space_id: "ws-other" });
  mocks.checkWorkspaceAccess = async () => false;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/r-1"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});

Deno.test("memories routes - Reminders - POST /api/spaces/:spaceId/reminders - creates a reminder and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.createReminder = async () => ({ id: "r-new", content: "Reminder" });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Reminder",
        trigger_type: "time",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
});
Deno.test("memories routes - Reminders - POST /api/spaces/:spaceId/reminders - rejects invalid trigger_type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Reminder",
        trigger_type: "invalid",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("memories routes - Reminders - POST /api/spaces/:spaceId/reminders - rejects empty content", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "",
        trigger_type: "time",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});

Deno.test("memories routes - Reminders - PATCH /api/reminders/:id - updates a reminder", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.getReminderById = async () => ({ id: "r-1", space_id: "ws-1" });
  mocks.checkWorkspaceAccess = async () => true;
  mocks.updateReminder = async () => ({ id: "r-1", content: "Updated" });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/r-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Updated" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("memories routes - Reminders - DELETE /api/reminders/:id - deletes a reminder", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.getReminderById = async () => ({ id: "r-1", space_id: "ws-1" });
  mocks.checkWorkspaceAccess = async () => true;
  mocks.deleteReminder = async () => undefined;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/r-1", { method: "DELETE" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { success: true });
});

Deno.test("memories routes - Reminders - POST /api/reminders/:id/trigger - triggers a reminder manually", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = async () => undefined;
  mocks.getReminderById = async () => ({ id: "r-1", space_id: "ws-1" });
  mocks.checkWorkspaceAccess = async () => true;
  mocks.triggerReminder = async () => ({ id: "r-1", status: "triggered" });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/r-1/trigger", {
      method: "POST",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
