import { Hono, type MiddlewareHandler } from "hono";
import process from "node:process";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

import type { Env } from "@/types";
import type { ApiVariables } from "@/server/routes/api.ts";

type ApiRouteEnv = {
  Bindings: Env;
  Variables: ApiVariables;
};

function createRouteEnv(): Env {
  return {
    PLATFORM: {
      services: {},
    },
  } as unknown as Env;
}

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

async function createApp() {
  const auth = createAuthSpies();
  const app = new Hono<ApiRouteEnv>();
  const originalGetReport = process.report?.getReport;
  if (process.report) {
    process.report.getReport = () =>
      ({ header: { glibcVersionRuntime: "2.31" } }) as unknown as ReturnType<
        NonNullable<typeof process.report>["getReport"]
      >;
  }
  const { createApiRouter } = await (async () => {
    try {
      return await import("@/server/routes/api.ts");
    } finally {
      if (process.report && originalGetReport) {
        process.report.getReport = originalGetReport;
      }
    }
  })();
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
  const { app, requireAuthSpy } = await createApp();

  const response = await app.fetch(
    new Request("http://localhost/api/git/repos/repo-1/refs"),
    createRouteEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "Unauthorized" });
  assertSpyCalls(requireAuthSpy, 1);
});

Deno.test("api router does not mount legacy /api/svcs/* routes", async () => {
  const { app, requireAuthSpy } = await createApp();

  const response = await app.fetch(
    new Request("http://localhost/api/svcs/repos/repo-1/refs"),
    createRouteEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 404);
  assertSpyCalls(requireAuthSpy, 0);
});

Deno.test("api router keeps MCP OAuth callback public while protecting MCP servers", async () => {
  const { app, requireAuthSpy } = await createApp();

  const callbackResponse = await app.fetch(
    new Request("http://localhost/api/mcp/oauth/callback"),
    createRouteEnv(),
    {} as ExecutionContext,
  );
  assertEquals(callbackResponse.status, 400);

  const serversResponse = await app.fetch(
    new Request("http://localhost/api/mcp/servers?spaceId=ws-1"),
    createRouteEnv(),
    {} as ExecutionContext,
  );

  assertEquals(serversResponse.status, 401);
  assertSpyCalls(requireAuthSpy, 1);
});

Deno.test("api router does not expose internal OAuth proxy routes publicly", async () => {
  const { app, requireAuthSpy } = await createApp();

  const response = await app.fetch(
    new Request("https://internal/api/internal/oauth/token-exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    createRouteEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 404);
  assertSpyCalls(requireAuthSpy, 0);
});
