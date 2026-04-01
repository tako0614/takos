import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import { NotFoundError } from "takos-common/errors";

function createRecordedMock<T extends (...args: any[]) => any>(impl: T) {
  const fn = ((...args: Parameters<T>) => {
    fn.calls.push({ args });
    return impl(...args);
  }) as T & { calls: Array<{ args: Parameters<T> }> };
  fn.calls = [];
  return fn;
}

const mocks = {
  requireSpaceAccess: createRecordedMock((..._args: any[]) => undefined) as any,
  listReminders: createRecordedMock((..._args: any[]) => undefined) as any,
  getReminderById: createRecordedMock((..._args: any[]) => undefined) as any,
  createReminder: createRecordedMock((..._args: any[]) => undefined) as any,
  updateReminder: createRecordedMock((..._args: any[]) => undefined) as any,
  deleteReminder: createRecordedMock((..._args: any[]) => undefined) as any,
  triggerReminder: createRecordedMock((..._args: any[]) => undefined) as any,
  checkWorkspaceAccess: createRecordedMock((..._args: any[]) =>
    undefined
  ) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
// [Deno] vi.mock removed - manually stub imports from '@/services/memory'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import remindersRoutes from "@/routes/reminders";
import { remindersRouteDeps } from "@/routes/reminders";

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
  remindersRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  remindersRouteDeps.listReminders = mocks.listReminders;
  remindersRouteDeps.getReminderById = mocks.getReminderById;
  remindersRouteDeps.createReminder = mocks.createReminder;
  remindersRouteDeps.updateReminder = mocks.updateReminder;
  remindersRouteDeps.deleteReminder = mocks.deleteReminder;
  remindersRouteDeps.triggerReminder = mocks.triggerReminder;
  remindersRouteDeps.checkSpaceAccess = mocks.checkWorkspaceAccess;
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", remindersRoutes);
  return app;
}

let env: Env;

function resetReminderMocks() {
  mocks.requireSpaceAccess.calls = [];
  mocks.listReminders.calls = [];
  mocks.getReminderById.calls = [];
  mocks.createReminder.calls = [];
  mocks.updateReminder.calls = [];
  mocks.deleteReminder.calls = [];
  mocks.triggerReminder.calls = [];
  mocks.checkWorkspaceAccess.calls = [];
}

Deno.test("reminders routes - GET /api/spaces/:spaceId/reminders - returns reminders list for a workspace", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
    membership: { role: "owner" },
  })) as any;
  mocks.listReminders = createRecordedMock(async () => [
    { id: "rem-1", content: "Do something", status: "pending" },
  ]) as any;

  const app = createApp(createUser());
  remindersRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  remindersRouteDeps.listReminders = mocks.listReminders;
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/ws-1/reminders"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as { reminders: unknown[] };
  assertEquals(json.reminders.length, 1);
  assertEquals(mocks.listReminders.calls[0]?.args[0], env.DB);
  assertEquals(mocks.listReminders.calls[0]?.args[1], "ws-1");
  assertObjectMatch(mocks.listReminders.calls[0]?.args[2] as Record<string, unknown>, { limit: 50 });
});
Deno.test("reminders routes - GET /api/spaces/:spaceId/reminders - returns error when workspace access is denied", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = createRecordedMock(async () => {
    throw new NotFoundError("Workspace");
  }) as any;
  mocks.listReminders = createRecordedMock(async () => []) as any;

  const app = createApp(createUser());
  remindersRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  remindersRouteDeps.listReminders = mocks.listReminders;
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/ws-bad/reminders"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
  assertEquals(mocks.listReminders.calls.length, 0);
});
Deno.test("reminders routes - GET /api/spaces/:spaceId/reminders - passes status filter and limit to service", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
    membership: { role: "viewer" },
  })) as any;
  mocks.listReminders = createRecordedMock(async () => []) as any;

  const app = createApp(createUser());
  remindersRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  remindersRouteDeps.listReminders = mocks.listReminders;
  await app.fetch(
    new Request(
      "http://localhost/api/spaces/ws-1/reminders?status=triggered&limit=10",
    ),
    env,
    {} as ExecutionContext,
  );

  assertEquals(mocks.listReminders.calls[0]?.args[0], env.DB);
  assertEquals(mocks.listReminders.calls[0]?.args[1], "ws-1");
  const listCall = mocks.listReminders.calls[0]?.args[2] as Record<string, unknown>;
  assertEquals(listCall.status, "triggered");
  assertEquals(listCall.limit, 10);
});

Deno.test("reminders routes - GET /api/reminders/:id - returns a specific reminder", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => ({
    id: "rem-1",
    space_id: "ws-1",
    content: "Check logs",
    status: "pending",
  })) as any;
  mocks.checkWorkspaceAccess = createRecordedMock(async () => ({
    membership: { role: "viewer" },
  })) as any;

  const app = createApp(createUser());
  remindersRouteDeps.getReminderById = mocks.getReminderById;
  remindersRouteDeps.checkSpaceAccess = mocks.checkWorkspaceAccess;
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-1"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as { id: string; content: string };
  assertEquals(json.id, "rem-1");
});
Deno.test("reminders routes - GET /api/reminders/:id - returns 404 when reminder not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => null) as any;

  const app = createApp(createUser());
  remindersRouteDeps.getReminderById = mocks.getReminderById;
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-missing"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("reminders routes - GET /api/reminders/:id - returns 403 when user has no workspace access", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => ({
    id: "rem-1",
    space_id: "ws-other",
  })) as any;
  mocks.checkWorkspaceAccess = createRecordedMock(async () => null) as any;

  const app = createApp(createUser());
  remindersRouteDeps.getReminderById = mocks.getReminderById;
  remindersRouteDeps.checkSpaceAccess = mocks.checkWorkspaceAccess;
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-1"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});

Deno.test("reminders routes - POST /api/spaces/:spaceId/reminders - creates a reminder and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = createRecordedMock(async () => ({
    space: { id: "ws-1" },
    membership: { role: "editor" },
  })) as any;
  mocks.createReminder = createRecordedMock(async () => ({
    id: "rem-new",
    content: "Deploy v2",
    trigger_type: "time",
    status: "pending",
  })) as any;

  const app = createApp(createUser());
  remindersRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;
  remindersRouteDeps.createReminder = mocks.createReminder;
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/ws-1/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Deploy v2",
        trigger_type: "time",
        trigger_value: "2026-04-01T00:00:00Z",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
  assertEquals(mocks.createReminder.calls[0]?.args[0], env.DB);
  assertEquals((mocks.createReminder.calls[0]?.args[1] as Record<string, unknown>).spaceId, "ws-1");
  assertEquals((mocks.createReminder.calls[0]?.args[1] as Record<string, unknown>).userId, "user-1");
  assertEquals((mocks.createReminder.calls[0]?.args[1] as Record<string, unknown>).content, "Deploy v2");
  assertEquals((mocks.createReminder.calls[0]?.args[1] as Record<string, unknown>).triggerType, "time");
  assertEquals((mocks.createReminder.calls[0]?.args[1] as Record<string, unknown>).priority, undefined);
});
Deno.test("reminders routes - POST /api/spaces/:spaceId/reminders - rejects empty content", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
    space: { id: "ws-1" },
    membership: { role: "editor" },
  })) as any;
  remindersRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/ws-1/reminders", {
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

  // Zod validation should reject empty content (min 1)
  assertEquals(res.status, 422);
  assertEquals(mocks.createReminder.calls.length, 0);
});
Deno.test("reminders routes - POST /api/spaces/:spaceId/reminders - rejects invalid trigger_type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
    space: { id: "ws-1" },
    membership: { role: "editor" },
  })) as any;
  remindersRouteDeps.requireSpaceAccess = mocks.requireSpaceAccess;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/ws-1/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "Valid content",
        trigger_type: "invalid_type",
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 422);
});

Deno.test("reminders routes - PATCH /api/reminders/:id - updates a reminder", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => ({
    id: "rem-1",
    space_id: "ws-1",
  })) as any;
  mocks.checkWorkspaceAccess = createRecordedMock(async () => ({
    membership: { role: "editor" },
  })) as any;
  mocks.updateReminder = createRecordedMock(async () => ({
    id: "rem-1",
    content: "Updated content",
    status: "pending",
  })) as any;

  const app = createApp(createUser());
  remindersRouteDeps.getReminderById = mocks.getReminderById;
  remindersRouteDeps.checkSpaceAccess = mocks.checkWorkspaceAccess;
  remindersRouteDeps.updateReminder = mocks.updateReminder;
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Updated content" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(mocks.updateReminder.calls[0]?.args[0], env.DB);
  assertEquals(mocks.updateReminder.calls[0]?.args[1], "rem-1");
  assertObjectMatch(mocks.updateReminder.calls[0]?.args[2] as Record<string, unknown>, { content: "Updated content" });
});
Deno.test("reminders routes - PATCH /api/reminders/:id - returns 404 when reminder not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => null) as any;
  remindersRouteDeps.getReminderById = mocks.getReminderById;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-gone", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("reminders routes - PATCH /api/reminders/:id - returns 403 for insufficient permissions", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => ({
    id: "rem-1",
    space_id: "ws-1",
  })) as any;
  mocks.checkWorkspaceAccess = createRecordedMock(async () => null) as any;

  const app = createApp(createUser());
  remindersRouteDeps.getReminderById = mocks.getReminderById;
  remindersRouteDeps.checkSpaceAccess = mocks.checkWorkspaceAccess;
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});
Deno.test("reminders routes - PATCH /api/reminders/:id - rejects invalid status values", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = (async () => ({
    id: "rem-1",
    space_id: "ws-1",
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "invalid_status" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 422);
});

Deno.test("reminders routes - DELETE /api/reminders/:id - deletes a reminder", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => ({
    id: "rem-1",
    space_id: "ws-1",
  })) as any;
  mocks.checkWorkspaceAccess = createRecordedMock(async () => ({
    membership: { role: "admin" },
  })) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-1", { method: "DELETE" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as { success: boolean };
  assertEquals(json.success, true);
  assertEquals(mocks.deleteReminder.calls[0]?.args, [env.DB, "rem-1"]);
});
Deno.test("reminders routes - DELETE /api/reminders/:id - returns 404 when reminder not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-gone", {
      method: "DELETE",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("reminders routes - DELETE /api/reminders/:id - returns 403 for insufficient permissions", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => ({
    id: "rem-1",
    space_id: "ws-1",
  })) as any;
  mocks.checkWorkspaceAccess = createRecordedMock(async () => null) as any;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-1", { method: "DELETE" }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});

Deno.test("reminders routes - POST /api/reminders/:id/trigger - manually triggers a reminder", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => ({
    id: "rem-1",
    space_id: "ws-1",
  })) as any;
  mocks.checkWorkspaceAccess = createRecordedMock(async () => ({
    membership: { role: "editor" },
  })) as any;
  mocks.triggerReminder = createRecordedMock(async () => ({
    id: "rem-1",
    status: "triggered",
  })) as any;

  const app = createApp(createUser());
  remindersRouteDeps.getReminderById = mocks.getReminderById;
  remindersRouteDeps.checkSpaceAccess = mocks.checkWorkspaceAccess;
  remindersRouteDeps.triggerReminder = mocks.triggerReminder;
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-1/trigger", {
      method: "POST",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(mocks.triggerReminder.calls[0].args, [env.DB, "rem-1"]);
});
Deno.test("reminders routes - POST /api/reminders/:id/trigger - returns 404 when reminder not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => null) as any;
  remindersRouteDeps.getReminderById = mocks.getReminderById;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-gone/trigger", {
      method: "POST",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("reminders routes - POST /api/reminders/:id/trigger - returns 403 for insufficient permissions", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  resetReminderMocks();
  env = createMockEnv() as unknown as Env;
  mocks.getReminderById = createRecordedMock(async () => ({
    id: "rem-1",
    space_id: "ws-1",
  })) as any;
  mocks.checkWorkspaceAccess = createRecordedMock(async () => null) as any;

  const app = createApp(createUser());
  remindersRouteDeps.getReminderById = mocks.getReminderById;
  remindersRouteDeps.checkSpaceAccess = mocks.checkWorkspaceAccess;
  const res = await app.fetch(
    new Request("http://localhost/api/reminders/rem-1/trigger", {
      method: "POST",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});
