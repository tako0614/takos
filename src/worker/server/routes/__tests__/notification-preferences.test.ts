import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../infra/db/schema.ts";
import type { Database } from "../../../infra/db/client.ts";
import type { Env, User } from "../../../shared/types/index.ts";
import {
  PUSH_SUPPORTED_NOTIFICATION_TYPES,
  type NotificationPreferenceMatrix,
} from "../../../application/services/notifications/notification-models.ts";
import { isAppError, type BaseVariables } from "../route-auth.ts";
import notifications from "../notifications/routes.ts";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE notification_preferences (
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, type, channel)
    );
  `);
  return drizzle(client, { schema }) as unknown as Database;
}

const user = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  username: "user",
  bio: null,
  picture: null,
  trust_tier: "normal",
  setup_completed: true,
  created_at: "2026-07-14T00:00:00.000Z",
  updated_at: "2026-07-14T00:00:00.000Z",
} satisfies User;

function createApp() {
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
    c.set("user", user);
    await next();
  });
  app.route("/api", notifications);
  return app;
}

test("GET notification preferences exposes the stable Takos push capability", async () => {
  const db = await freshDb();
  const timestamp = "2026-07-14T00:00:00.000Z";
  await db.insert(schema.notificationPreferences).values({
    accountId: user.id,
    type: "workspace.invite",
    channel: "push",
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const response = await createApp().fetch(
    new Request("https://takos.test/api/notifications/preferences"),
    { DB: db } as unknown as Env,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    push_supported_types: readonly string[];
    preferences: NotificationPreferenceMatrix;
  };
  expect(body.push_supported_types).toEqual(PUSH_SUPPORTED_NOTIFICATION_TYPES);
  expect(body.preferences["run.completed"].push).toBe(true);
  expect(body.preferences["run.failed"].push).toBe(true);
  expect(body.preferences["workspace.invite"].push).toBe(false);

  const stored = await db
    .select({ enabled: schema.notificationPreferences.enabled })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.accountId, user.id),
        eq(schema.notificationPreferences.type, "workspace.invite"),
        eq(schema.notificationPreferences.channel, "push"),
      ),
    )
    .get();
  expect(stored?.enabled).toBe(false);
});

test("PATCH notification preferences rejects enabling unsupported push", async () => {
  const db = await freshDb();
  const response = await createApp().fetch(
    new Request("https://takos.test/api/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [{ type: "deploy.completed", channel: "push", enabled: true }],
      }),
    }),
    { DB: db } as unknown as Env,
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: {
      code: "BAD_REQUEST",
      message:
        "Push notifications are not supported for type: deploy.completed",
      details: {
        type: "deploy.completed",
        channel: "push",
        supported_push_types: PUSH_SUPPORTED_NOTIFICATION_TYPES,
      },
    },
  });
});

test("PATCH notification preferences still allows Agent Run push opt-out", async () => {
  const db = await freshDb();
  const response = await createApp().fetch(
    new Request("https://takos.test/api/notifications/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [{ type: "run.completed", channel: "push", enabled: false }],
      }),
    }),
    { DB: db } as unknown as Env,
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    push_supported_types: readonly string[];
    preferences: NotificationPreferenceMatrix;
  };
  expect(body.push_supported_types).toEqual(PUSH_SUPPORTED_NOTIFICATION_TYPES);
  expect(body.preferences["run.completed"].push).toBe(false);
});
