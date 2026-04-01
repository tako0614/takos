import { Hono } from "hono";

import { assertEquals } from "jsr:@std/assert";

import type { Env, User } from "@/types";
import repoGitAdvanced from "@/server/routes/repos/git-advanced.ts";

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...overrides,
  } as unknown as Env;
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
    c.set("user", {
      id: "user-1",
      name: "Test User",
      email: "test@example.com",
    } as unknown as User);
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
