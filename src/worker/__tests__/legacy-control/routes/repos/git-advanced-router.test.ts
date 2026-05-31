import { Hono } from "hono";

import type { Env, User } from "@/types";
import { assertEquals } from "@std/assert";
import { isAppError } from "@takos/worker-platform-utils/errors";

import repoGitAdvanced from "../../../../server/routes/repos/git-advanced.ts";

type AuthenticatedRouteEnv = { Bindings: Env; Variables: { user?: User } };

function createEnv(): Env {
  return {
    DB: {},
    GIT_OBJECTS: {},
  } as Env;
}

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
    const user: User = {
      id: "user-1",
      principal_id: "user-1",
      email: "test@example.com",
      name: "Test User",
      username: "test",
      bio: null,
      picture: null,
      trust_tier: "normal",
      setup_completed: true,
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    };
    c.set("user", user);
    await next();
  });
  app.route("/", repoGitAdvanced);
  return app;
}

Deno.test("repo git search rejects empty queries", async () => {
  const response = await createApp().fetch(
    new Request("http://localhost/repos/repo-1/search"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: {
      code: "BAD_REQUEST",
      message: "q is required",
    },
  });
});

Deno.test("repo git search rejects one-character queries", async () => {
  const response = await createApp().fetch(
    new Request("http://localhost/repos/repo-1/search?q=a"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: {
      code: "BAD_REQUEST",
      message: "q must be at least 2 characters",
    },
  });
});

Deno.test("repo semantic search rejects empty queries", async () => {
  const response = await createApp().fetch(
    new Request("http://localhost/repos/repo-1/semantic-search"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: {
      code: "BAD_REQUEST",
      message: "q is required",
    },
  });
});
