import { Hono } from "hono";

import type { Env, User } from "@/types";
import { assertEquals } from "jsr:@std/assert";
import { isAppError } from "takos-common/errors";

import workersBase from "../../../../../../packages/control/src/server/routes/workers/routes.ts";

type AuthenticatedRouteEnv = { Bindings: Env; Variables: { user?: User } };

function createApp() {
  const app = new Hono<AuthenticatedRouteEnv>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("user", {
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
    } as User);
    await next();
  });
  app.route("/api/services", workersBase);
  return app;
}

function createEnv(): Env {
  return {
    DB: {},
    TENANT_BASE_DOMAIN: "app.test.takos.jp",
  } as Env;
}

Deno.test("workers routes reject unknown service_type values before hitting storage", async () => {
  const response = await createApp().fetch(
    new Request("http://localhost/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service_type: "worker" }),
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
});

Deno.test("workers routes reject non-string group_id on group patch", async () => {
  const response = await createApp().fetch(
    new Request("http://localhost/api/services/service-1/group", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: 123 }),
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
});
