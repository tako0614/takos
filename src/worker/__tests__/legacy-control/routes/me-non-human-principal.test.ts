import { Hono } from "hono";

import { assertEquals } from "@std/assert";

import type { Env, User } from "@/types";
import meRoutes from "@/server/routes/me.ts";

type TestEnv = {
  Bindings: Env;
  Variables: {
    user: User;
  };
};

function createSpaceAgentPrincipal(): User {
  return {
    id: "principal-space-agent-1",
    email: "",
    name: "Space Agent",
    username: "space-agent-principal-space-agent-1",
    principal_kind: "space_agent",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  };
}

function createHumanUser(): User {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "Human User",
    username: "human-user",
    principal_kind: "user",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  };
}

function hasNumberProp<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, number> {
  return typeof value === "object" && value !== null &&
    typeof (value as Record<K, unknown>)[key] === "number";
}

function hasStringProp<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, string> {
  return typeof value === "object" && value !== null &&
    typeof (value as Record<K, unknown>)[key] === "string";
}

function createApp(user: User) {
  const app = new Hono<TestEnv>();
  app.onError((error) => {
    const statusCode = hasNumberProp(error, "statusCode")
      ? error.statusCode
      : 500;
    const code = hasStringProp(error, "code") ? error.code : "INTERNAL_ERROR";
    return new Response(
      JSON.stringify({ code, error: error.message }),
      {
        status: statusCode,
        headers: { "Content-Type": "application/json" },
      },
    );
  });
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api/me", meRoutes);
  return app;
}

const env = {} as Env;

Deno.test("non-human principal me route guard blocks non-human principals from the me surface", async () => {
  const app = createApp(createSpaceAgentPrincipal());

  const response = await app.fetch(
    new Request("http://localhost/api/me"),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 403);
  assertEquals(await response.json(), {
    code: "FORBIDDEN",
    error: "/api/me is only available to human accounts",
  });
});

Deno.test("non-human principal me route guard blocks unknown me subroutes", async () => {
  const app = createApp(createSpaceAgentPrincipal());

  const response = await app.fetch(
    new Request("http://localhost/api/me/personal-access-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "forbidden",
        scopes: '["repo:read"]',
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 403);
  assertEquals(await response.json(), {
    code: "FORBIDDEN",
    error: "/api/me is only available to human accounts",
  });
});

Deno.test("personal access token surface is not exposed for human users", async () => {
  const app = createApp(createHumanUser());

  const response = await app.fetch(
    new Request("http://localhost/api/me/personal-access-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "removed",
        scopes: '["repo:read"]',
      }),
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 404);
});
