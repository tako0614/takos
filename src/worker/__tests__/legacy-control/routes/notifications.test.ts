import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../hono-test-support.ts";

import { assert, assertEquals } from "@std/assert";
import { asyncNoopDep, noopDep } from "@test/dep-stubs";

type RecordedCalls = { calls: Array<{ args: unknown[] }> };
type LooseAsyncFn =
  & ((...args: unknown[]) => Promise<unknown>)
  & Partial<RecordedCalls>;
type LooseFn =
  & ((...args: unknown[]) => unknown)
  & Partial<RecordedCalls>;

const mocks: {
  listNotifications: LooseAsyncFn;
  getUnreadCount: LooseAsyncFn;
  markNotificationRead: LooseAsyncFn;
  getNotificationPreferences: LooseAsyncFn;
  updateNotificationPreferences: LooseAsyncFn;
  getNotificationsMutedUntil: LooseAsyncFn;
  setNotificationsMutedUntil: LooseAsyncFn;
  isNotificationType: LooseFn;
  isNotificationChannel: LooseFn;
} = {
  listNotifications: asyncNoopDep("notificationsRouteDeps.listNotifications"),
  getUnreadCount: asyncNoopDep("notificationsRouteDeps.getUnreadCount"),
  markNotificationRead: asyncNoopDep(
    "notificationsRouteDeps.markNotificationRead",
  ),
  getNotificationPreferences: asyncNoopDep(
    "notificationsRouteDeps.getNotificationPreferences",
  ),
  updateNotificationPreferences: asyncNoopDep(
    "notificationsRouteDeps.updateNotificationPreferences",
  ),
  getNotificationsMutedUntil: asyncNoopDep(
    "notificationsRouteDeps.getNotificationsMutedUntil",
  ),
  setNotificationsMutedUntil: asyncNoopDep(
    "notificationsRouteDeps.setNotificationsMutedUntil",
  ),
  isNotificationType: noopDep("notificationsRouteDeps.isNotificationType"),
  isNotificationChannel: noopDep(
    "notificationsRouteDeps.isNotificationChannel",
  ),
};

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

// [Deno] vi.mock removed - manually stub imports from '@/services/notifications'
// [Deno] vi.mock removed - manually stub imports from '@/services/notifications/types'
// [Deno] vi.mock removed - manually stub imports from '@/durable-objects/shared'
import notificationsRoute, {
  notificationsRouteDeps,
} from "@/routes/notifications";

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
  function bindMock<K extends keyof typeof notificationsRouteDeps>(
    mockKey: keyof typeof mocks,
  ): typeof notificationsRouteDeps[K] {
    return ((...args: unknown[]) => {
      type AnyFn = (...a: unknown[]) => unknown;
      return (mocks[mockKey] as AnyFn)(...args);
    }) as typeof notificationsRouteDeps[K];
  }
  Object.assign(notificationsRouteDeps, {
    listNotifications: bindMock<"listNotifications">("listNotifications"),
    getUnreadCount: bindMock<"getUnreadCount">("getUnreadCount"),
    markNotificationRead: bindMock<"markNotificationRead">(
      "markNotificationRead",
    ),
    getNotificationPreferences: bindMock<"getNotificationPreferences">(
      "getNotificationPreferences",
    ),
    updateNotificationPreferences: bindMock<"updateNotificationPreferences">(
      "updateNotificationPreferences",
    ),
    getNotificationsMutedUntil: bindMock<"getNotificationsMutedUntil">(
      "getNotificationsMutedUntil",
    ),
    setNotificationsMutedUntil: bindMock<"setNotificationsMutedUntil">(
      "setNotificationsMutedUntil",
    ),
    isNotificationType: bindMock<"isNotificationType">("isNotificationType"),
    isNotificationChannel: bindMock<"isNotificationChannel">(
      "isNotificationChannel",
    ),
  });
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api", notificationsRoute);
  return app;
}

const env = createMockEnv();

Deno.test("notifications routes - GET /api/notifications - returns notifications list", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const notifications = [{ id: "n-1", type: "run_complete", read: false }];
  mocks.listNotifications = createRecordedMock(async () => notifications);

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), notifications);
  assertEquals(mocks.listNotifications.calls?.[0]?.args, [
    env.DB,
    "user-1",
    { limit: undefined, before: null },
  ]);
});
Deno.test("notifications routes - GET /api/notifications - passes limit and before query params", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.listNotifications = createRecordedMock(async () => []);

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request(
      "http://localhost/api/notifications?limit=10&before=2026-03-01T00:00:00.000Z",
    ),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(mocks.listNotifications.calls?.[0]?.args, [
    env.DB,
    "user-1",
    { limit: 10, before: "2026-03-01T00:00:00.000Z" },
  ]);
});
Deno.test("notifications routes - GET /api/notifications - rejects invalid before parameter", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications?before=not-a-date"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});

Deno.test("notifications routes - GET /api/notifications/unread-count - returns unread count", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getUnreadCount = async () => 5;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/unread-count"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), { unread_count: 5 });
});

Deno.test("notifications routes - PATCH /api/notifications/:id/read - marks notification as read", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.markNotificationRead = createRecordedMock(async () => ({
    success: true,
  }));

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/n-1/read", {
      method: "PATCH",
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(mocks.markNotificationRead.calls?.[0]?.args, [
    env.DB,
    "user-1",
    "n-1",
  ]);
});

Deno.test("notifications routes - GET /api/notifications/preferences - returns preference list with types and channels", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getNotificationPreferences = async () => [];

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/preferences"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const json = await res.json() as Record<string, unknown>;
  assert("types" in json);
  assert("channels" in json);
  assert("preferences" in json);
});

Deno.test("notifications routes - PATCH /api/notifications/preferences - updates preferences with valid input", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isNotificationType = () => true;
  mocks.isNotificationChannel = () => true;
  mocks.updateNotificationPreferences = createRecordedMock(
    async () => [],
  );

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [{ type: "run_complete", channel: "in_app", enabled: false }],
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assert(mocks.updateNotificationPreferences.calls?.length ?? 0 > 0);
});
Deno.test("notifications routes - PATCH /api/notifications/preferences - rejects invalid notification type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isNotificationType = () => false;
  mocks.isNotificationChannel = () => true;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [{ type: "invalid_type", channel: "in_app", enabled: false }],
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("notifications routes - PATCH /api/notifications/preferences - rejects invalid notification channel", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.isNotificationType = () => true;
  mocks.isNotificationChannel = () => false;

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [{
          type: "run_complete",
          channel: "invalid_channel",
          enabled: false,
        }],
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});
Deno.test("notifications routes - PATCH /api/notifications/preferences - rejects request without updates array", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});

Deno.test("notifications routes - GET /api/notifications/settings - returns muted_until setting", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getNotificationsMutedUntil = async () => "2026-04-01T00:00:00.000Z";

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/settings"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  await assertEquals(await res.json(), {
    muted_until: "2026-04-01T00:00:00.000Z",
  });
});

Deno.test("notifications routes - PATCH /api/notifications/settings - updates muted_until with valid datetime", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.setNotificationsMutedUntil = async () => ({
    muted_until: "2026-04-01T00:00:00.000Z",
  });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ muted_until: "2026-04-01T00:00:00.000Z" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
Deno.test("notifications routes - PATCH /api/notifications/settings - allows null muted_until to unmute", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.setNotificationsMutedUntil = async () => ({ muted_until: null });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ muted_until: null }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
Deno.test("notifications routes - PATCH /api/notifications/settings - rejects invalid datetime for muted_until", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ muted_until: "not-a-date" }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 400);
});

Deno.test("notifications routes - GET /api/notifications/ws - returns 426 without Upgrade: websocket header", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const app = createApp(createUser());
  const envWithNotifier = createMockEnv({
    NOTIFICATION_NOTIFIER: {
      idFromName: () => "id-1",
      get: () => ({ fetch: noopDep("NotificationNotifier.fetch") }),
    },
  });

  const res = await app.fetch(
    new Request("http://localhost/api/notifications/ws"),
    envWithNotifier,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 426);
});
Deno.test("notifications routes - GET /api/notifications/ws - returns 500 when NOTIFICATION_NOTIFIER is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/notifications/ws", {
      headers: { Upgrade: "websocket" },
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 500);
});
