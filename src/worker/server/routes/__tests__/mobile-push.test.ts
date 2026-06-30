import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../infra/db/schema.ts";
import type { Env, User } from "../../../shared/types/index.ts";
import type { Database } from "../../../infra/db/client.ts";
import { isAppError, type BaseVariables } from "../route-auth.ts";
import mobile from "../mobile.ts";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = OFF");
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE mobile_push_registrations (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      product TEXT NOT NULL,
      token TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'production',
      host_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_mobile_push_registrations_account_product_token
      ON mobile_push_registrations(account_id, product, token_hash);
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
  app.route("/api/mobile", mobile);
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

test("POST /api/mobile/push-registrations stores a Takos mobile push token without echoing it", async () => {
  const db = await freshDb();
  const app = createApp(envUser);
  const response = await app.fetch(
    new Request("https://takos.test/api/mobile/push-registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "takos",
        token: "push-token",
        environment: "development",
        host_url: "https://takos.test",
      }),
    }),
    { DB: db } as unknown as Env,
  );

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(JSON.stringify(body)).not.toContain("push-token");
  expect(body).toMatchObject({
    registration: {
      product: "takos",
      environment: "development",
      host_url: "https://takos.test",
    },
  });

  const rows = await db
    .select({
      accountId: schema.mobilePushRegistrations.accountId,
      product: schema.mobilePushRegistrations.product,
      token: schema.mobilePushRegistrations.token,
    })
    .from(schema.mobilePushRegistrations);
  expect(rows).toEqual([
    {
      accountId: "user-1",
      product: "takos",
      token: "push-token",
    },
  ]);
});

test("POST /api/mobile/push-registrations rejects another product", async () => {
  const db = await freshDb();
  const app = createApp(envUser);
  const response = await app.fetch(
    new Request("https://takos.test/api/mobile/push-registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: "yurucommu",
        token: "push-token",
      }),
    }),
    { DB: db } as unknown as Env,
  );

  expect(response.status).toBe(400);
});

test("DELETE /api/mobile/push-registrations removes the matching Takos mobile push token", async () => {
  const db = await freshDb();
  const app = createApp(envUser);
  const payload = {
    product: "takos",
    token: "push-token",
    environment: "development",
    host_url: "https://takos.test",
  };

  const createResponse = await app.fetch(
    new Request("https://takos.test/api/mobile/push-registrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { DB: db } as unknown as Env,
  );
  expect(createResponse.status).toBe(200);

  const deleteResponse = await app.fetch(
    new Request("https://takos.test/api/mobile/push-registrations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { DB: db } as unknown as Env,
  );

  expect(deleteResponse.status).toBe(200);
  expect(await deleteResponse.json()).toEqual({ unregistered: true });
  const rows = await db.select().from(schema.mobilePushRegistrations);
  expect(rows).toHaveLength(0);
});
