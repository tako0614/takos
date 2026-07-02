import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../infra/db/schema.ts";
import type { Env, User } from "../../../shared/types/index.ts";
import type { Database } from "../../../infra/db/client.ts";
import { isAppError, type BaseVariables } from "../route-auth.ts";
import notifications from "../notifications/routes.ts";

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
    CREATE UNIQUE INDEX idx_notification_pushers_account_app_pushkey
      ON notification_pushers(account_id, app_id, pushkey_hash);
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
    { DB: db } as unknown as Env,
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
    { DB: db } as unknown as Env,
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
    { DB: db } as unknown as Env,
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
    { DB: db } as unknown as Env,
  );

  expect(response.status).toBe(400);
});
