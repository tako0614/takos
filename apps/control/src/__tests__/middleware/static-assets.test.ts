import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";
import type { Env } from "@/types";
import { staticAssetsMiddleware } from "@/middleware/static-assets";
import { createMockEnv } from "../../../test/integration/setup.ts";

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Record<string, unknown> }>();
  app.use("*", staticAssetsMiddleware);
  app.get("/api/data", (c) => c.json({ ok: true }));
  app.get("/auth/login", (c) => c.json({ auth: true }));
  app.get("/oauth/authorize", (c) => c.json({ oauth: true }));
  app.get("/dashboard", (c) => c.json({ fallback: true }));
  app.get("/some-asset.js", (c) => c.json({ fallback: true }));
  return app;
}

function createEnvWithAssetFetch(
  fetchImpl?: (request: Request) => Promise<Response>,
): Env {
  const env = createMockEnv(
    fetchImpl
      ? {
        ASSETS: {
          fetch: fetchImpl,
        },
      }
      : {},
  );
  return env as unknown as Env;
}

Deno.test("staticAssetsMiddleware - passes through /api/ paths without checking assets", async () => {
  const requests: Request[] = [];
  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/api/data"),
    createEnvWithAssetFetch(async (request) => {
      requests.push(request);
      return new Response("unexpected");
    }),
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(requests.length, 0);
});

Deno.test("staticAssetsMiddleware - passes through /auth/ paths without checking assets", async () => {
  const requests: Request[] = [];
  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/auth/login"),
    createEnvWithAssetFetch(async (request) => {
      requests.push(request);
      return new Response("unexpected");
    }),
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { auth: true });
  assertEquals(requests.length, 0);
});

Deno.test("staticAssetsMiddleware - passes through /oauth/ paths without checking assets", async () => {
  const requests: Request[] = [];
  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/oauth/authorize"),
    createEnvWithAssetFetch(async (request) => {
      requests.push(request);
      return new Response("unexpected");
    }),
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { oauth: true });
  assertEquals(requests.length, 0);
});

Deno.test("staticAssetsMiddleware - returns asset when assets binding is available and asset is found", async () => {
  const requests: Request[] = [];
  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/some-asset.js"),
    createEnvWithAssetFetch(async (request) => {
      requests.push(request);
      return new Response('console.log("ok")', {
        status: 200,
        headers: { "Content-Type": "application/javascript" },
      });
    }),
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/javascript");
  assertEquals(requests.length, 1);
  assertEquals(new URL(requests[0].url).pathname, "/some-asset.js");
});

Deno.test("staticAssetsMiddleware - falls through to next handler when assets binding is null", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/dashboard"),
    createEnvWithAssetFetch(),
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { fallback: true });
});

Deno.test("staticAssetsMiddleware - falls through when asset fetch throws", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/dashboard"),
    createEnvWithAssetFetch(async () => {
      throw new Error("Not found");
    }),
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { fallback: true });
});

Deno.test("staticAssetsMiddleware - falls through when asset response is text/html", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/dashboard"),
    createEnvWithAssetFetch(async () => {
      return new Response("<html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }),
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { fallback: true });
});

Deno.test("staticAssetsMiddleware - falls through when asset response is not ok", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("http://localhost/dashboard"),
    createEnvWithAssetFetch(async () => {
      return new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }),
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { fallback: true });
});
