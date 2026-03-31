// deno-lint-ignore-file no-import-prefix no-unversioned-import require-await
import { Hono } from "hono";

import { requireTurnstile } from "../../../../../packages/control/src/server/middleware/turnstile.ts";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";

function createApp(envOverrides: Record<string, unknown> = {}) {
  const app = new Hono<{ Bindings: Record<string, unknown> }>();
  app.use("*", requireTurnstile());
  app.post("/auth/signup", (c) => c.json({ ok: true }));
  return { app, env: envOverrides };
}

Deno.test("requireTurnstile middleware - skips validation when TURNSTILE_SECRET_KEY is not configured", async () => {
  const { app, env } = createApp();
  const res = await app.fetch(
    new Request("http://localhost/auth/signup", { method: "POST" }),
    env,
  );
  assertEquals(res.status, 200);
});

Deno.test("requireTurnstile middleware - rejects requests without turnstile token when secret is configured", async () => {
  const { app, env } = createApp({ TURNSTILE_SECRET_KEY: "test-secret" });
  const res = await app.fetch(
    new Request("http://localhost/auth/signup", { method: "POST" }),
    env,
  );
  assertEquals(res.status, 500);
});

Deno.test("requireTurnstile middleware - accepts token from X-Turnstile-Token header and verifies with API", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
  );
  try {
    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: "test-secret" });
    const res = await app.fetch(
      new Request("http://localhost/auth/signup", {
        method: "POST",
        headers: { "X-Turnstile-Token": "valid-token" },
      }),
      env,
    );
    assertEquals(res.status, 200);
    assertSpyCalls(fetchStub, 1);
    const [url] = fetchStub.calls[0]!.args as [string, RequestInit?];
    assertEquals(
      url,
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
  } finally {
    fetchStub.restore();
  }
});

Deno.test("requireTurnstile middleware - accepts token from turnstile_token query parameter", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
  );
  try {
    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: "test-secret" });
    const res = await app.fetch(
      new Request("http://localhost/auth/signup?turnstile_token=query-token", {
        method: "POST",
      }),
      env,
    );
    assertEquals(res.status, 200);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("requireTurnstile middleware - rejects when Turnstile API returns success: false", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
        { status: 200 },
      ),
  );
  try {
    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: "test-secret" });
    const res = await app.fetch(
      new Request("http://localhost/auth/signup", {
        method: "POST",
        headers: { "X-Turnstile-Token": "invalid-token" },
      }),
      env,
    );
    assertEquals(res.status, 500);
  } finally {
    fetchStub.restore();
  }
});

Deno.test("requireTurnstile middleware - passes CF-Connecting-IP to Turnstile verify API", async () => {
  const fetchStub = stub(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 }),
  );
  try {
    const { app, env } = createApp({ TURNSTILE_SECRET_KEY: "test-secret" });
    await app.fetch(
      new Request("http://localhost/auth/signup", {
        method: "POST",
        headers: {
          "X-Turnstile-Token": "valid-token",
          "CF-Connecting-IP": "1.2.3.4",
        },
      }),
      env,
    );

    assertSpyCalls(fetchStub, 1);
    const [, init] = fetchStub.calls[0]!.args as [string, RequestInit?];
    const body = init?.body as URLSearchParams;
    assertEquals(body.get("remoteip"), "1.2.3.4");
  } finally {
    fetchStub.restore();
  }
});
