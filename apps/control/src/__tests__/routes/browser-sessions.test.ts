import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

import browserSessionsRoute from "@/routes/browser-sessions";

import { assert, assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

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

function createApp(user?: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user?: User } }>();
  app.use("*", async (c, next) => {
    if (user) c.set("user", user);
    await next();
  });
  app.route("/api", browserSessionsRoute);
  return app;
}

function createBrowserHostMock(
  response: Response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
  }),
) {
  return {
    fetch: spy(async () => response),
  };
}

Deno.test("browser-sessions routes - POST /api/spaces/:spaceId/browser-sessions - creates a browser session and returns 201", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const browserHost = createBrowserHostMock(
    new Response(JSON.stringify({ status: "created" }), { status: 200 }),
  );
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/browser-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 201);
  const json = await res.json() as Record<string, unknown>;
  assert("sessionId" in json);
  assertSpyCalls(browserHost.fetch, 1);
});
Deno.test("browser-sessions routes - POST /api/spaces/:spaceId/browser-sessions - returns 401 when no user is set", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = createMockEnv({ BROWSER_HOST: createBrowserHostMock() });

  const app = createApp(); // no user
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/browser-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 401);
});
Deno.test("browser-sessions routes - POST /api/spaces/:spaceId/browser-sessions - returns 500 when browser host returns error", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const browserHost = createBrowserHostMock(
    new Response("Internal Error", { status: 500 }),
  );
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/browser-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 500);
});
Deno.test("browser-sessions routes - POST /api/spaces/:spaceId/browser-sessions - returns 503 when BROWSER_HOST is not configured", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = createMockEnv(); // no BROWSER_HOST

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/spaces/sp-1/browser-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 503);
});

Deno.test("browser-sessions routes - GET /api/browser-sessions/:id - returns session info for owner", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const browserHost = createBrowserHostMock(
    new Response(
      JSON.stringify({ userId: "user-1", url: "https://example.com" }),
      { status: 200 },
    ),
  );
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/browser-sessions/sess-123"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
Deno.test("browser-sessions routes - GET /api/browser-sessions/:id - returns 403 when session belongs to another user", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const browserHost = createBrowserHostMock(
    new Response(JSON.stringify({ userId: "other-user" }), { status: 200 }),
  );
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/browser-sessions/sess-123"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
});
Deno.test("browser-sessions routes - GET /api/browser-sessions/:id - returns 404 when session not found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const browserHost = createBrowserHostMock(
    new Response("Not found", { status: 404 }),
  );
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/browser-sessions/sess-missing"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 404);
});
Deno.test("browser-sessions routes - GET /api/browser-sessions/:id - returns 401 without user", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = createMockEnv({ BROWSER_HOST: createBrowserHostMock() });

  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/api/browser-sessions/sess-123"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 401);
});

Deno.test("browser-sessions routes - POST /api/browser-sessions/:id/goto - forwards goto to browser host", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const browserHost = createBrowserHostMock(
    new Response(JSON.stringify({ navigated: true }), { status: 200 }),
  );
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/browser-sessions/sess-123/goto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://new-url.com" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("browser-sessions routes - POST /api/browser-sessions/:id/action - forwards action to browser host", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const browserHost = createBrowserHostMock();
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/browser-sessions/sess-123/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "click", selector: "#btn" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("browser-sessions routes - POST /api/browser-sessions/:id/extract - forwards extract to browser host", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const browserHost = createBrowserHostMock();
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/browser-sessions/sess-123/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selector: "h1" }),
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("browser-sessions routes - GET /api/browser-sessions/:id/html - returns HTML content", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const browserHost = createBrowserHostMock(
    new Response(JSON.stringify({ html: "<html></html>" }), { status: 200 }),
  );
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/browser-sessions/sess-123/html"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});

Deno.test("browser-sessions routes - GET /api/browser-sessions/:id/screenshot - returns screenshot with proper content type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const pngData = new Uint8Array([137, 80, 78, 71]);
  const browserHost = createBrowserHostMock(
    new Response(pngData, {
      status: 200,
      headers: { "Content-Type": "image/png", "Content-Length": "4" },
    }),
  );
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/browser-sessions/sess-123/screenshot"),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "image/png");
});

Deno.test("browser-sessions routes - DELETE /api/browser-sessions/:id - destroys a session", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const browserHost = createBrowserHostMock(
    new Response(JSON.stringify({ destroyed: true }), { status: 200 }),
  );
  const env = createMockEnv({ BROWSER_HOST: browserHost });

  const app = createApp(createUser());
  const res = await app.fetch(
    new Request("http://localhost/api/browser-sessions/sess-123", {
      method: "DELETE",
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
});
