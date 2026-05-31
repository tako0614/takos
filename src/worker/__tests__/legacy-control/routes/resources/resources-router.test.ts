import { Hono } from "hono";
import { assertEquals, assertStringIncludes } from "@std/assert";

import type { Env, User } from "@/types";
import { createMockEnv } from "../../../../test/integration/setup.ts";
import { installAppErrorHandler } from "../../hono-test-support.ts";
import type { AuthenticatedRouteEnv } from "../../../../server/routes/route-auth.ts";
import resourcesBase, {
  stripPublicResourceBackingFields,
} from "../../../../server/routes/resources/routes.ts";
import resourcesConnection from "../../../../server/routes/resources/connection.ts";

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

function createTokensApp(user: User): Hono<AuthenticatedRouteEnv> {
  const app = new Hono<AuthenticatedRouteEnv>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  installAppErrorHandler(app);
  app.route("/api/resources", resourcesConnection);
  return app;
}

function createEnv(): Env {
  return createMockEnv();
}

Deno.test("resources type route rejects invalid resource types", async () => {
  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/resources/type/invalid_type"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  const body = await response.json() as {
    error: { code: string; message: string };
  };
  assertEquals(body.error.code, "BAD_REQUEST");
  assertStringIncludes(body.error.message, "Invalid resource type");
  assertStringIncludes(body.error.message, "sql, object-store, key-value");
});

Deno.test("resources type route rejects retired provider resource aliases", async () => {
  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/resources/type/d1"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  const body = await response.json() as {
    error: { code: string; message: string };
  };
  assertEquals(body.error.code, "BAD_REQUEST");
  assertStringIncludes(body.error.message, "Invalid resource type");
  assertStringIncludes(body.error.message, "sql, object-store, key-value");
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
    error: {
      code: "BAD_REQUEST",
      message: "name is required",
    },
  });
});

Deno.test("resource creation rejects backend fields", async () => {
  const app = createApp(createUser());
  const response = await app.fetch(
    new Request("http://localhost/api/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "my-db",
        type: "sql",
        backend_name: "cloudflare",
      }),
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: {
        fields: [{
          field: "",
          message: "Unrecognized key(s) in object: 'backend_name'",
        }],
      },
    },
  });
});

Deno.test("resource responses hide backend backing fields", () => {
  assertEquals(
    stripPublicResourceBackingFields<unknown>({
      resource: {
        id: "res_1",
        name: "my-db",
        backend_name: "cloudflare",
        backing_resource_id: "cf-db-id",
        backing_resource_name: "cf-db-name",
        backendStateJson: "{}",
      },
    }),
    {
      resource: {
        id: "res_1",
        name: "my-db",
      },
    },
  );
});

Deno.test("resource token routes are not exposed", async () => {
  const app = createTokensApp(createUser());
  const cases = [
    ["GET", "http://localhost/api/resources/res_1/tokens"],
    ["GET", "http://localhost/api/resources/by-name/my-db/tokens"],
    ["POST", "http://localhost/api/resources/res_1/tokens"],
    ["POST", "http://localhost/api/resources/by-name/my-db/tokens"],
    ["DELETE", "http://localhost/api/resources/res_1/tokens/tok_1"],
    ["DELETE", "http://localhost/api/resources/by-name/my-db/tokens/tok_1"],
  ] as const;

  for (const [method, url] of cases) {
    const response = await app.fetch(
      new Request(url, { method }),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 404);
  }
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
  const body = await response.json() as {
    error: { code: string; message: string };
  };
  assertEquals(body.error.code, "BAD_REQUEST");
  assertStringIncludes(body.error.message, "Invalid resource type");
});
