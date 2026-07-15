import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../infra/db/schema.ts";
import type { Env, User } from "../../../shared/types/index.ts";
import type { Database } from "../../../infra/db/client.ts";
import { isAppError, type BaseVariables } from "../route-auth.ts";
import notifications from "../notifications/routes.ts";
import {
  MAX_NOTIFICATION_PUSHER_DATA_BYTES,
  MAX_NOTIFICATION_PUSHERS_PER_ACCOUNT,
  MAX_NOTIFICATION_PUSHERS_PER_APP,
  compareAndDeleteNotificationPushers,
  registerNotificationPusher,
} from "../../../application/services/notifications/pushers.ts";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = OFF");
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE notification_pushers (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      product TEXT,
      scope TEXT,
      kind TEXT NOT NULL,
      app_id TEXT NOT NULL,
      pushkey TEXT NOT NULL,
      pushkey_hash TEXT NOT NULL,
      app_display_name TEXT,
      device_display_name TEXT,
      profile_tag TEXT,
      lang TEXT,
      gateway_url TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_notification_pushers_app_pushkey
      ON notification_pushers(app_id, pushkey_hash);
  `);
  return drizzle(client, { schema }) as unknown as Database;
}

function createApp(user?: User) {
  const app = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500,
      );
    }
    throw error;
  });
  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  app.route("/api", notifications);
  return app;
}

const envUser = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  username: "user",
  bio: null,
  picture: null,
  trust_tier: "normal",
  setup_completed: true,
  created_at: "2026-06-30T00:00:00.000Z",
  updated_at: "2026-06-30T00:00:00.000Z",
} satisfies User;

function routeEnv(db: Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    ...overrides,
  } as unknown as Env;
}

async function insertQuotaPusher(
  db: Database,
  input: {
    readonly id: string;
    readonly appId: string;
    readonly pushkey: string;
    readonly timestamp: string;
  },
): Promise<void> {
  await db.insert(schema.notificationPushers).values({
    id: input.id,
    accountId: "user-1",
    product: "takos",
    scope: "account:user-1",
    kind: "http",
    appId: input.appId,
    pushkey: input.pushkey,
    pushkeyHash: `hash-${input.id}`,
    gatewayUrl: "https://push.example/_matrix/push/v1/notify",
    data: JSON.stringify({ format: "event_id_only" }),
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    lastSeenAt: input.timestamp,
  });
}

async function registerQuotaPusher(
  db: Database,
  input: { readonly appId: string; readonly pushkey: string },
) {
  return registerNotificationPusher(db, {
    accountId: "user-1",
    product: "takos",
    scope: "account:user-1",
    gatewayUrl: "https://push.example/_matrix/push/v1/notify",
    pusher: {
      kind: "http",
      app_id: input.appId,
      pushkey: input.pushkey,
      data: {
        url: "https://push.example/_matrix/push/v1/notify",
        format: "event_id_only",
      },
    },
  });
}

test("POST /api/notifications/pushers stores a product-neutral pusher without echoing the pushkey", async () => {
  const db = await freshDb();
  const app = createApp(envUser);
  const response = await app.fetch(
    new Request("https://takos.test/api/notifications/pushers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "takos",
        scope: "account:user-1",
        pusher: {
          kind: "http",
          app_id: "jp.takos.mobile",
          app_display_name: "Takos",
          device_display_name: "Alice's phone",
          lang: "ja-JP",
          pushkey: "push-token",
          data: {
            url: "https://push.example/_matrix/push/v1/notify",
            format: "event_id_only",
            provider: "fcm",
          },
        },
      }),
    }),
    routeEnv(db),
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(JSON.stringify(body)).not.toContain("push-token");
  expect(body).toMatchObject({
    pusher: {
      kind: "http",
      app_id: "jp.takos.mobile",
      app_display_name: "Takos",
      device_display_name: "Alice's phone",
      lang: "ja-JP",
      data: {
        format: "event_id_only",
        provider: "fcm",
      },
      gateway_url: "https://push.example/_matrix/push/v1/notify",
      product: "takos",
      scope: "account:user-1",
    },
  });

  const rows = await db
    .select({
      accountId: schema.notificationPushers.accountId,
      appId: schema.notificationPushers.appId,
      pushkey: schema.notificationPushers.pushkey,
      gatewayUrl: schema.notificationPushers.gatewayUrl,
      data: schema.notificationPushers.data,
    })
    .from(schema.notificationPushers);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    accountId: "user-1",
    appId: "jp.takos.mobile",
    pushkey: "push-token",
    gatewayUrl: "https://push.example/_matrix/push/v1/notify",
  });
  expect(JSON.parse(rows[0]!.data)).toEqual({
    format: "event_id_only",
    provider: "fcm",
  });
});

test("DELETE /api/notifications/pushers removes by app id and pushkey", async () => {
  const db = await freshDb();
  const app = createApp(envUser);
  const payload = {
    product: "takos",
    pusher: {
      kind: "http",
      app_id: "jp.takos.mobile",
      pushkey: "push-token",
      data: {
        url: "https://push.example/_matrix/push/v1/notify",
      },
    },
  };

  const createResponse = await app.fetch(
    new Request("https://takos.test/api/notifications/pushers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    routeEnv(db),
  );
  expect(createResponse.status).toBe(200);

  const deleteResponse = await app.fetch(
    new Request("https://takos.test/api/notifications/pushers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "takos",
        app_id: "jp.takos.mobile",
        pushkey: "push-token",
      }),
    }),
    routeEnv(db),
  );

  expect(deleteResponse.status).toBe(200);
  expect(await deleteResponse.json()).toEqual({ deleted: true });
  const rows = await db.select().from(schema.notificationPushers);
  expect(rows).toHaveLength(0);
});

test("POST /api/notifications/pushers rejects another product", async () => {
  const db = await freshDb();
  const app = createApp(envUser);
  const response = await app.fetch(
    new Request("https://takos.test/api/notifications/pushers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "yurucommu",
        pusher: {
          kind: "http",
          app_id: "jp.takos.mobile",
          pushkey: "push-token",
          data: {
            url: "https://push.example/_matrix/push/v1/notify",
          },
        },
      }),
    }),
    routeEnv(db),
  );

  expect(response.status).toBe(400);
});

test("POST /api/notifications/pushers rejects unsafe and operator-disallowed gateway URLs", async () => {
  const db = await freshDb();
  const app = createApp(envUser);
  for (const gatewayUrl of [
    "http://push.example/_matrix/push/v1/notify",
    "https://127.0.0.1/_matrix/push/v1/notify",
    "https://metadata.google.internal/_matrix/push/v1/notify",
  ]) {
    const response = await app.fetch(
      new Request("https://takos.test/api/notifications/pushers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: "takos",
          pusher: {
            kind: "http",
            app_id: "jp.takos.mobile",
            pushkey: "push-token",
            data: { url: gatewayUrl, format: "event_id_only" },
          },
        }),
      }),
      {
        DB: db,
        TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
      } as unknown as Env,
    );
    expect(response.status).toBe(400);
    const error = (await response.json()) as {
      code?: string;
      field?: string;
    };
    expect(error.code).toBe("BAD_REQUEST");
    expect(
      error.field === "pusher.data" || error.field === "pusher.data.url",
    ).toBe(true);
  }

  const disallowed = await app.fetch(
    new Request("https://takos.test/api/notifications/pushers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "takos",
        pusher: {
          kind: "http",
          app_id: "jp.takos.mobile",
          pushkey: "push-token",
          data: {
            url: "https://other.example/_matrix/push/v1/notify",
            format: "event_id_only",
          },
        },
      }),
    }),
    {
      DB: db,
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as unknown as Env,
  );
  expect(disallowed.status).toBe(400);
  expect(await disallowed.json()).toMatchObject({
    code: "BAD_REQUEST",
    field: "pusher.data.url",
  });
});

test("POST /api/notifications/pushers fails closed without an explicit public gateway allowlist", async () => {
  const db = await freshDb();
  const app = createApp(envUser);
  const response = await app.fetch(
    new Request("https://takos.test/api/notifications/pushers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "takos",
        pusher: {
          kind: "http",
          app_id: "jp.takos.mobile",
          pushkey: "push-token",
          data: {
            url: "https://push.example/_matrix/push/v1/notify",
            format: "event_id_only",
          },
        },
      }),
    }),
    { DB: db } as unknown as Env,
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    code: "BAD_REQUEST",
    field: "pusher.data.url",
  });
  expect(await db.select().from(schema.notificationPushers)).toHaveLength(0);
});

test("POST /api/notifications/pushers bounds stored data size and structure", async () => {
  const db = await freshDb();
  const app = createApp(envUser);
  let nested: Record<string, unknown> = { leaf: true };
  for (let depth = 0; depth < 10; depth += 1) nested = { nested };

  for (const [pushkey, extraData] of [
    ["oversized", { value: "x".repeat(MAX_NOTIFICATION_PUSHER_DATA_BYTES) }],
    ["too-deep", nested],
  ] as const) {
    const response = await app.fetch(
      new Request("https://takos.test/api/notifications/pushers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: "takos",
          pusher: {
            kind: "http",
            app_id: "jp.takos.mobile",
            pushkey,
            data: {
              url: "https://push.example/_matrix/push/v1/notify",
              format: "event_id_only",
              extraData,
            },
          },
        }),
      }),
      routeEnv(db),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "BAD_REQUEST",
      field: "pusher.data",
    });
  }

  expect(await db.select().from(schema.notificationPushers)).toHaveLength(0);
  await expect(
    registerNotificationPusher(db, {
      accountId: "user-1",
      gatewayUrl: "https://push.example/_matrix/push/v1/notify",
      pusher: {
        kind: "http",
        app_id: "jp.takos.mobile",
        pushkey: "direct-service",
        data: {
          url: "https://push.example/_matrix/push/v1/notify",
          value: "x".repeat(MAX_NOTIFICATION_PUSHER_DATA_BYTES),
        },
      },
    }),
  ).rejects.toThrow("pusher.data");
});

test("POST /api/notifications/pushers allows HTTP loopback only with the development flag", async () => {
  const db = await freshDb();
  const app = createApp(envUser);
  const request = () =>
    new Request("https://takos.test/api/notifications/pushers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "takos",
        pusher: {
          kind: "http",
          app_id: "jp.takos.mobile",
          pushkey: "loopback-token",
          data: {
            url: "http://127.0.0.1:8787/_matrix/push/v1/notify",
            format: "event_id_only",
          },
        },
      }),
    });

  const blocked = await app.fetch(request(), routeEnv(db));
  expect(blocked.status).toBe(400);

  const allowed = await app.fetch(
    request(),
    routeEnv(db, {
      TAKOS_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK: "true",
    }),
  );
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toMatchObject({
    pusher: {
      gateway_url: "http://127.0.0.1:8787/_matrix/push/v1/notify",
    },
  });
});

test("new pusher registration evicts the oldest same-app row and existing upsert consumes no quota", async () => {
  const db = await freshDb();
  for (let index = 0; index < MAX_NOTIFICATION_PUSHERS_PER_APP; index += 1) {
    await insertQuotaPusher(db, {
      id: `old-${index}`,
      appId: "jp.takos.mobile",
      pushkey: `old-token-${index}`,
      timestamp: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    });
  }

  const registered = await registerQuotaPusher(db, {
    appId: "jp.takos.mobile",
    pushkey: "new-token",
  });
  const afterInsert = await db
    .select({ id: schema.notificationPushers.id })
    .from(schema.notificationPushers);
  expect(afterInsert).toHaveLength(MAX_NOTIFICATION_PUSHERS_PER_APP);
  expect(afterInsert.some((row) => row.id === "old-0")).toBe(false);
  expect(afterInsert.some((row) => row.id === registered.id)).toBe(true);

  const idsBeforeUpdate = afterInsert.map((row) => row.id).sort();
  const updated = await registerQuotaPusher(db, {
    appId: "jp.takos.mobile",
    pushkey: "new-token",
  });
  const idsAfterUpdate = (
    await db
      .select({ id: schema.notificationPushers.id })
      .from(schema.notificationPushers)
  )
    .map((row) => row.id)
    .sort();
  expect(updated.id).toBe(registered.id);
  expect(idsAfterUpdate).toEqual(idsBeforeUpdate);
});

test("new pusher registration bounds the whole account and evicts its oldest row", async () => {
  const db = await freshDb();
  for (
    let index = 0;
    index < MAX_NOTIFICATION_PUSHERS_PER_ACCOUNT;
    index += 1
  ) {
    await insertQuotaPusher(db, {
      id: `account-old-${index}`,
      appId: `jp.takos.client${index}`,
      pushkey: `account-token-${index}`,
      timestamp: `2026-02-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    });
  }

  const registered = await registerQuotaPusher(db, {
    appId: "jp.takos.newclient",
    pushkey: "account-new-token",
  });
  const rows = await db
    .select({ id: schema.notificationPushers.id })
    .from(schema.notificationPushers);
  expect(rows).toHaveLength(MAX_NOTIFICATION_PUSHERS_PER_ACCOUNT);
  expect(rows.some((row) => row.id === "account-old-0")).toBe(false);
  expect(rows.some((row) => row.id === registered.id)).toBe(true);
});

test("quota compare-delete preserves a concurrently refreshed registration", async () => {
  const db = await freshDb();
  await insertQuotaPusher(db, {
    id: "stale-candidate",
    appId: "jp.takos.mobile",
    pushkey: "device-token",
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  const candidate = await db
    .select({
      id: schema.notificationPushers.id,
      accountId: schema.notificationPushers.accountId,
      appId: schema.notificationPushers.appId,
      pushkey: schema.notificationPushers.pushkey,
      pushkeyHash: schema.notificationPushers.pushkeyHash,
      gatewayUrl: schema.notificationPushers.gatewayUrl,
      data: schema.notificationPushers.data,
      updatedAt: schema.notificationPushers.updatedAt,
    })
    .from(schema.notificationPushers)
    .get();
  expect(candidate).toBeDefined();

  await db.update(schema.notificationPushers).set({
    data: JSON.stringify({ format: "event_id_only", provider: "apns" }),
    updatedAt: "2026-07-14T00:00:00.000Z",
    lastSeenAt: "2026-07-14T00:00:00.000Z",
  });
  const deleted = await compareAndDeleteNotificationPushers(db, [candidate!]);

  expect(deleted).toBe(0);
  expect(await db.select().from(schema.notificationPushers)).toHaveLength(1);
});
