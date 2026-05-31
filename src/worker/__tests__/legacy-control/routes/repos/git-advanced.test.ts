import { Hono } from "hono";

import { assertEquals } from "@std/assert";

import type { Env, User } from "@/types";
import repoGitAdvanced from "@/server/routes/repos/git-advanced.ts";
import { createMockEnv } from "../../../../test/integration/setup.ts";

function createEnv(overrides: Partial<Env> = {}): Env {
  return createMockEnv(overrides);
}

function createApp() {
  const app = new Hono<any>();
  app.onError((error, c) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      "message" in error
    ) {
      const appError = error as { statusCode: number; message: string };
      return c.json(
        { error: appError.message },
        appError.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
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

Deno.test("repo git advanced search requires a non-empty query", async () => {
  const response = await createApp().fetch(
    new Request("http://localhost/repos/repo-1/search"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "q is required" });
});

Deno.test("repo git advanced search enforces a minimum query length", async () => {
  const response = await createApp().fetch(
    new Request("http://localhost/repos/repo-1/search?q=x"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "q must be at least 2 characters",
  });
});

Deno.test("repo semantic search requires a query", async () => {
  const response = await createApp().fetch(
    new Request("http://localhost/repos/repo-1/semantic-search"),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "q is required" });
});
