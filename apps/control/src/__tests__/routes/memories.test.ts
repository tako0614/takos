import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assert, assertEquals } from "jsr:@std/assert";
import { NotFoundError } from "@/routes/route-auth";

function createRecordedMock<T extends (...args: any[]) => any>(impl: T) {
  const fn = ((...args: Parameters<T>) => {
    fn.calls.push({ args });
    return impl(...args);
  }) as T & { calls: Array<{ args: Parameters<T> }> };
  fn.calls = [];
  return fn;
}

const mocks = {
  listMemories: ((..._args: any[]) => undefined) as any,
  bumpMemoryAccess: ((..._args: any[]) => undefined) as any,
  searchMemories: ((..._args: any[]) => undefined) as any,
  getMemoryById: ((..._args: any[]) => undefined) as any,
  createMemory: ((..._args: any[]) => undefined) as any,
  updateMemory: ((..._args: any[]) => undefined) as any,
  deleteMemory: ((..._args: any[]) => undefined) as any,
  listReminders: ((..._args: any[]) => undefined) as any,
  getReminderById: ((..._args: any[]) => undefined) as any,
  createReminder: ((..._args: any[]) => undefined) as any,
  updateReminder: ((..._args: any[]) => undefined) as any,
  deleteReminder: ((..._args: any[]) => undefined) as any,
  triggerReminder: ((..._args: any[]) => undefined) as any,
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
  checkWorkspaceAccess: ((..._args: any[]) => undefined) as any,
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
  Object.assign(memoriesRouteDeps, {
    listMemories: (...args: any[]) => mocks.listMemories(...args),
    bumpMemoryAccess: (...args: any[]) => mocks.bumpMemoryAccess(...args),
    searchMemories: (...args: any[]) => mocks.searchMemories(...args),
    getMemoryById: (...args: any[]) => mocks.getMemoryById(...args),
    createMemory: (...args: any[]) => mocks.createMemory(...args),
    updateMemory: (...args: any[]) => mocks.updateMemory(...args),
    deleteMemory: (...args: any[]) => mocks.deleteMemory(...args),
    listReminders: (...args: any[]) => mocks.listReminders(...args),
    getReminderById: (...args: any[]) => mocks.getReminderById(...args),
    createReminder: (...args: any[]) => mocks.createReminder(...args),
    updateReminder: (...args: any[]) => mocks.updateReminder(...args),
    deleteReminder: (...args: any[]) => mocks.deleteReminder(...args),
    triggerReminder: (...args: any[]) => mocks.triggerReminder(...args),
    requireSpaceAccess: (...args: any[]) => mocks.requireSpaceAccess(...args),
    checkSpaceAccess: (...args: any[]) => mocks.checkWorkspaceAccess(...args),
  });
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", memoriesRoute);
  return app;
}

function mockWorkspaceAccess() {
  mocks.requireSpaceAccess =
    (async () => ({ space: { id: "ws-1" } })) as any;
}

const env = createMockEnv();

Deno.test("memories routes - GET /api/spaces/:spaceId/memories - returns memories list", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  const memories = [{ id: "m-1", content: "Hello", type: "episode" }];
  mocks.listMemories = (async () => memories) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/memories"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { memories });
});
Deno.test("memories routes - GET /api/spaces/:spaceId/memories - returns 404 when workspace access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.requireSpaceAccess =
    (async () => {
      throw new NotFoundError("Space");
    }) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-bad/memories"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("memories routes - GET /api/spaces/:spaceId/memories/search - returns search results", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.searchMemories = (async () => [{ id: "m-1", content: "Match" }]) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/memories/search?q=test"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("memories" in json);
});

Deno.test("memories routes - GET /api/memories/:id - returns a specific memory", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  const memory = { id: "m-1", content: "Hello", space_id: "ws-1" };
  mocks.getMemoryById = (async () => memory) as any;
  mocks.checkWorkspaceAccess = (async () => true) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-1"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
Deno.test("memories routes - GET /api/memories/:id - returns 404 when memory not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.getMemoryById = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-missing"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("memories routes - GET /api/memories/:id - returns 403 when workspace access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.getMemoryById =
    (async () => ({ id: "m-1", space_id: "ws-other" })) as any;
  mocks.checkWorkspaceAccess = (async () => false) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-1"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});

Deno.test("memories routes - POST /api/spaces/:spaceId/memories - creates a memory and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  const created = { id: "m-new", content: "New memory", type: "episode" };
  mocks.createMemory = createRecordedMock(async () => created) as any;

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
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
  assertEquals(mocks.createMemory.calls.length > 0, true);
});
Deno.test("memories routes - POST /api/spaces/:spaceId/memories - rejects invalid type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
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
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 422);
});
Deno.test("memories routes - POST /api/spaces/:spaceId/memories - rejects empty content", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
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
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 422);
});

Deno.test("memories routes - PATCH /api/memories/:id - updates a memory", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.getMemoryById = (async () => ({ id: "m-1", space_id: "ws-1" })) as any;
  mocks.checkWorkspaceAccess = (async () => true) as any;
  mocks.updateMemory = (async () => ({ id: "m-1", content: "Updated" })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Updated" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
Deno.test("memories routes - PATCH /api/memories/:id - returns 404 when memory not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.getMemoryById = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-missing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Updated" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});

Deno.test("memories routes - DELETE /api/memories/:id - deletes a memory", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.getMemoryById = (async () => ({ id: "m-1", space_id: "ws-1" })) as any;
  mocks.checkWorkspaceAccess = (async () => true) as any;
  mocks.deleteMemory = (async () => undefined) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/memories/m-1", { method: "DELETE" }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { success: true });
});

Deno.test("memories routes - Reminders - GET /api/spaces/:spaceId/reminders - returns reminders list", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.listReminders = (async () => [{ id: "r-1", content: "Test" }]) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/reminders"),
    env as unknown as Env,
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
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.getReminderById = (async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/r-missing"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("memories routes - Reminders - GET /api/reminders/:id - returns 403 when workspace access denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.getReminderById =
    (async () => ({ id: "r-1", space_id: "ws-other" })) as any;
  mocks.checkWorkspaceAccess = (async () => false) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/r-1"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});

Deno.test("memories routes - Reminders - POST /api/spaces/:spaceId/reminders - creates a reminder and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.createReminder =
    (async () => ({ id: "r-new", content: "Reminder" })) as any;

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
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
});
Deno.test("memories routes - Reminders - POST /api/spaces/:spaceId/reminders - rejects invalid trigger_type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
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
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 422);
});
Deno.test("memories routes - Reminders - POST /api/spaces/:spaceId/reminders - rejects empty content", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
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
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 422);
});

Deno.test("memories routes - Reminders - PATCH /api/reminders/:id - updates a reminder", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.getReminderById =
    (async () => ({ id: "r-1", space_id: "ws-1" })) as any;
  mocks.checkWorkspaceAccess = (async () => true) as any;
  mocks.updateReminder =
    (async () => ({ id: "r-1", content: "Updated" })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/r-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Updated" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("memories routes - Reminders - DELETE /api/reminders/:id - deletes a reminder", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.getReminderById =
    (async () => ({ id: "r-1", space_id: "ws-1" })) as any;
  mocks.checkWorkspaceAccess = (async () => true) as any;
  mocks.deleteReminder = (async () => undefined) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/r-1", { method: "DELETE" }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { success: true });
});

Deno.test("memories routes - Reminders - POST /api/reminders/:id/trigger - triggers a reminder manually", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockWorkspaceAccess();
  mocks.bumpMemoryAccess = (async () => undefined) as any;
  mocks.getReminderById =
    (async () => ({ id: "r-1", space_id: "ws-1" })) as any;
  mocks.checkWorkspaceAccess = (async () => true) as any;
  mocks.triggerReminder =
    (async () => ({ id: "r-1", status: "triggered" })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/r-1/trigger", {
      method: "POST",
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
