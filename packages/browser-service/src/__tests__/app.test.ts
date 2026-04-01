// Mock playwright-core and takos-common before importing app
// [Deno] vi.mock removed - manually stub imports from 'playwright-core'
// [Deno] vi.mock removed - manually stub imports from 'takos-common/logger'
// [Deno] vi.mock removed - manually stub imports from 'takos-common/validation'
import { createBrowserServiceApp } from "../app.ts";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

type JsonBody = Record<string, unknown>;

Deno.test("createBrowserServiceApp - creates an app with browser and logger", () => {
  const { app, browser, logger } = createBrowserServiceApp();
  assert(app !== undefined);
  assert(browser !== undefined);
  assert(logger !== undefined);
});
Deno.test("createBrowserServiceApp - uses custom service name", () => {
  const { app, browser } = createBrowserServiceApp({
    serviceName: "custom-browser",
  });
  assert(app !== undefined);
  assert(browser !== undefined);
});

Deno.test("health endpoint - GET /internal/healthz returns status ok", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/healthz");
  const res = await app.fetch(req);
  assertEquals(res.status, 200);
  const body = await res.json() as JsonBody;
  assertEquals(body.status, "ok");
  assertEquals(body.service, "browserd");
  assertEquals(body.browser_alive, false);
});
Deno.test("health endpoint - GET /internal/healthz uses custom service name", async () => {
  const { app } = createBrowserServiceApp({ serviceName: "my-browser" });
  const req = new Request("http://localhost/internal/healthz");
  const res = await app.fetch(req);
  const body = await res.json() as JsonBody;
  assertEquals(body.service, "my-browser");
});

Deno.test("URL validation in bootstrap - POST /internal/bootstrap rejects localhost URL", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "http://localhost:3000/evil" }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 500);
  const body = await res.json() as JsonBody;
  assertStringIncludes(String(body.error), "localhost");
});
Deno.test("URL validation in bootstrap - POST /internal/bootstrap rejects private IP URL", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "http://192.168.1.1/admin" }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 500);
  const body = await res.json() as JsonBody;
  assertStringIncludes(String(body.error), "private");
});
Deno.test("URL validation in bootstrap - POST /internal/bootstrap rejects non-http URL", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "ftp://example.com/file" }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 500);
  const body = await res.json() as JsonBody;
  assertStringIncludes(String(body.error), "HTTP/HTTPS");
});
Deno.test("URL validation in bootstrap - POST /internal/bootstrap rejects URL with credentials", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://user:pass@example.com" }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 500);
  const body = await res.json() as JsonBody;
  assertStringIncludes(String(body.error), "credentials");
});
Deno.test("URL validation in bootstrap - POST /internal/bootstrap rejects invalid URL format", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "not-a-url" }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 500);
  const body = await res.json() as JsonBody;
  assertStringIncludes(String(body.error), "Invalid URL");
});

Deno.test("URL validation in goto - POST /internal/goto rejects localhost URL", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/goto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "http://127.0.0.1:8080/" }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 500);
  const body = await res.json() as JsonBody;
  assertStringIncludes(String(body.error), "localhost");
});
Deno.test("URL validation in goto - POST /internal/goto rejects private IP", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/goto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "http://10.0.0.1/" }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 500);
  const body = await res.json() as JsonBody;
  assertStringIncludes(String(body.error), "private");
});

Deno.test("action endpoint - POST /internal/action returns 400 when type is missing", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 400);
  const body = await res.json() as JsonBody;
  assertEquals(body.error, "Missing action type");
});

Deno.test("tab endpoints - POST /internal/tab/close returns 400 when index is not a number", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/tab/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index: "not-a-number" }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 400);
  const body = await res.json() as JsonBody;
  assertEquals(body.error, "Missing tab index");
});
Deno.test("tab endpoints - POST /internal/tab/switch returns 400 when index is not a number", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/tab/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index: null }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 400);
  const body = await res.json() as JsonBody;
  assertEquals(body.error, "Missing tab index");
});

Deno.test("tab/new URL validation - POST /internal/tab/new rejects private IP URL", async () => {
  const { app } = createBrowserServiceApp();
  const req = new Request("http://localhost/internal/tab/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "http://10.0.0.1/" }),
  });
  const res = await app.fetch(req);
  assertEquals(res.status, 500);
  const body = await res.json() as JsonBody;
  assertStringIncludes(String(body.error), "private");
});
