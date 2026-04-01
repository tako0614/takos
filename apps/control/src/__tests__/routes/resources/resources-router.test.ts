import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";

import type { Env, User } from "@/types";
import { createMockEnv } from "../../../../test/integration/setup.ts";
import type { AuthenticatedRouteEnv } from "../../../../../../packages/control/src/server/routes/route-auth.ts";
import resourcesBase from "../../../../../../packages/control/src/server/routes/resources/routes.ts";

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

function createApp(user: User): Hono<AuthenticatedRouteEnv> {
  const app = new Hono<AuthenticatedRouteEnv>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api/resources", resourcesBase);
  return app;
}

function createEnv(): Env {
  return createMockEnv() as unknown as Env;
}

Deno.test("resources type route rejects invalid resource types", async () => {
  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/resources/type/invalid_type"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "Invalid resource type",
  });
});

Deno.test("resource creation rejects blank names", async () => {
  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "   ", type: "sql" }),
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "name is required",
  });
});

Deno.test("resource creation rejects invalid providers", async () => {
  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "my-db",
        type: "sql",
        provider: "invalid-provider",
      }),
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "Invalid provider: invalid-provider",
  });
});

Deno.test("resource creation rejects invalid resource types", async () => {
  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "my-db",
        type: "invalid_type",
      }),
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "Invalid resource type",
  });
});
