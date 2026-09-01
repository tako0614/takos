import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";
import * as schema from "../../../infra/db/schema.ts";
import type { Database } from "../../../infra/db/client.ts";
import type { Env, User } from "../../../shared/types/index.ts";
import type { BaseVariables } from "../route-auth.ts";
import setupRoutes from "../setup.ts";

test("setup completion is idempotent and returns one canonical acceptance", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      setup_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    INSERT INTO accounts (id, setup_completed, updated_at)
    VALUES ('user-1', 0, '2026-08-10T00:00:00.000Z');
  `);
  const db = drizzle(client, { schema }) as unknown as Database;
  const user: User = {
    id: "user-1",
    email: "owner@example.test",
    name: "Owner",
    username: "owner",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: false,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
  };
  const app = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api/setup", setupRoutes);

  try {
    const first = await app.fetch(
      new Request("https://takos.test/api/setup/complete", { method: "POST" }),
      { DB: db } as unknown as Env,
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      success: true,
      setup_completed: true,
    });
    expect((await client.execute(
      "SELECT setup_completed FROM accounts WHERE id = 'user-1'",
    )).rows[0]?.setup_completed).toBe(1);

    user.setup_completed = true;
    const retry = await app.fetch(
      new Request("https://takos.test/api/setup/complete", { method: "POST" }),
      { DB: db } as unknown as Env,
    );
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({
      success: true,
      setup_completed: true,
    });
  } finally {
    client.close();
  }
});
