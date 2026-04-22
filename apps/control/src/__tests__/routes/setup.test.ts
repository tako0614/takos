import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import { assertEquals, assertNotEquals } from "jsr:@std/assert";

// [Deno] vi.mock removed - manually stub imports from '@/db'
import setupRoutes from "@/routes/setup";
import { setupRouteDeps } from "@/routes/setup";

type TestEnv = {
  Bindings: Env;
  Variables: {
    user: User;
  };
};

function createUser(): User {
  return {
    id: "user-1",
    principal_id: "principal-1",
    email: "user1@example.com",
    name: "User One",
    username: "user1",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: false,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  };
}

function createSetupDb() {
  let lastSetData: Record<string, unknown> | null = null;
  const chain: any = {
    from: () => chain,
    where: () => chain,
    get: async () => null,
    set: (data: Record<string, unknown>) => {
      lastSetData = data;
      return {
        where: async () => undefined,
      };
    },
  };
  const db = {
    select: () => chain,
    update: () => ({ set: chain.set }),
    _getLastSetData: () => lastSetData,
  };
  return db;
}

function createApp(user: User) {
  const app = new Hono<TestEnv>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api/setup", setupRoutes);
  return app;
}

Deno.test("setup route - completes setup with username only (no password)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const db = createSetupDb();
  setupRouteDeps.getDb = (() => db) as any;
  const app = createApp(createUser());

  const response = await app.fetch(
    new Request("http://localhost/api/setup/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "userone",
      }),
    }),
    createMockEnv({ DB: db }) as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertEquals(await response.json(), {
    success: true,
    username: "userone",
  });

  assertNotEquals(db._getLastSetData(), null);
  const setData = db._getLastSetData() as Record<string, unknown>;

  assertEquals(setData.slug, "userone");
  assertEquals(setData.setupCompleted, true);
  // No password hash should be set
  assertEquals(setData.passwordHash, undefined);
});
