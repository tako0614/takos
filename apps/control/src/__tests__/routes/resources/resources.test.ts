import { Hono } from "hono";

import { assertEquals } from "jsr:@std/assert";

import type { Env, User } from "@/types";
import type { AuthenticatedRouteEnv } from "@/server/routes/route-auth.ts";
import resourcesBase from "@/server/routes/resources/routes.ts";

const TEST_TIMESTAMP = "2026-03-01T00:00:00.000Z";

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
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
  };
}

function createEnv(withDbBinding: boolean): Env {
  return {
    PLATFORM: {
      services: {
        sql: { binding: withDbBinding ? {} : undefined },
      },
    },
  } as unknown as Env;
}

function createApp(user: User): Hono<AuthenticatedRouteEnv> {
  const app = new Hono<AuthenticatedRouteEnv>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api/resources", resourcesBase);
  return app;
}

Deno.test("resources routes return 500 when the database binding is unavailable", async () => {
  const app = createApp(createUser());

  const response = await app.fetch(
    new Request("http://localhost/api/resources"),
    createEnv(false),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: "Database binding unavailable",
  });
});

Deno.test("resources routes reject unknown resource types before querying storage", async () => {
  const app = createApp(createUser());

  const response = await app.fetch(
    new Request("http://localhost/api/resources/type/invalid_type"),
    createEnv(true),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "Invalid resource type",
  });
});
