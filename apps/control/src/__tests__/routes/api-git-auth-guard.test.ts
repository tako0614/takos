import { Hono, type MiddlewareHandler } from "hono";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import type { Env } from "@/types";
import { type ApiVariables, createApiRouter } from "@/server/routes/api.ts";
import { createMockEnv } from "../../../test/integration/setup.ts";

type ApiRouteEnv = {
  Bindings: Env;
  Variables: ApiVariables;
};

function createAuthSpies() {
  const requireAuth = spy(
    async (c: Parameters<MiddlewareHandler<ApiRouteEnv>>[0]) => {
      return c.json({ error: "Unauthorized" }, 401);
    },
  );
  const optionalAuth = spy(async (
    _c: Parameters<MiddlewareHandler<ApiRouteEnv>>[0],
    next: Parameters<MiddlewareHandler<ApiRouteEnv>>[1],
  ) => {
    await next();
  });

  return {
    requireAuth: requireAuth as MiddlewareHandler<ApiRouteEnv>,
    optionalAuth: optionalAuth as MiddlewareHandler<ApiRouteEnv>,
    requireAuthSpy: requireAuth,
    optionalAuthSpy: optionalAuth,
  };
}

function createApp() {
  const auth = createAuthSpies();
  const app = new Hono<ApiRouteEnv>();
  app.route(
    "/api",
    createApiRouter({
      requireAuth: auth.requireAuth,
      optionalAuth: auth.optionalAuth,
    }),
  );
  return { app, ...auth };
}

Deno.test("api router requires auth for /api/git/* routes", async () => {
  const { app, requireAuthSpy } = createApp();

  const response = await app.fetch(
    new Request("http://localhost/api/git/repos/repo-1/refs"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "Unauthorized" });
  assertSpyCalls(requireAuthSpy, 1);
});

Deno.test("api router does not mount legacy /api/svcs/* routes", async () => {
  const { app, requireAuthSpy } = createApp();

  const response = await app.fetch(
    new Request("http://localhost/api/svcs/repos/repo-1/refs"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 404);
  assertSpyCalls(requireAuthSpy, 0);
});

Deno.test("api router keeps MCP OAuth callback public while protecting MCP servers", async () => {
  const { app, requireAuthSpy } = createApp();

  const callbackResponse = await app.fetch(
    new Request("http://localhost/api/mcp/oauth/callback"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );
  assertEquals(callbackResponse.status, 400);

  const serversResponse = await app.fetch(
    new Request("http://localhost/api/mcp/servers?spaceId=ws-1"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(serversResponse.status, 401);
  assertSpyCalls(requireAuthSpy, 1);
});

Deno.test("api router does not expose internal OAuth proxy routes publicly", async () => {
  const { app, requireAuthSpy } = createApp();

  const response = await app.fetch(
    new Request("https://internal/api/internal/oauth/token-exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 404);
  assertSpyCalls(requireAuthSpy, 0);
});
