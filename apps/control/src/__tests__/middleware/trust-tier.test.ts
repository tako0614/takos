import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { assertEquals } from "jsr:@std/assert";
import { isAppError } from "takos-common/errors";

import { meetsMinTier, requireTrustTier } from "@/middleware/trust-tier";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";

type TestVars = { user?: User };
type TestEnv = { Bindings: Env; Variables: TestVars };

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    username: "testuser",
    bio: null,
    picture: null,
    trust_tier: "normal",
    setup_completed: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createApp(minTier: "normal" | "trusted", presetUser?: User) {
  const app = new Hono<TestEnv>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as ContentfulStatusCode,
      );
    }
    throw error;
  });

  if (presetUser) {
    app.use("*", async (c, next) => {
      c.set("user", presetUser);
      await next();
    });
  }

  app.use("*", requireTrustTier(minTier));
  app.get("/protected", (c) => c.json({ ok: true }));
  return app;
}

Deno.test("requireTrustTier middleware - returns 401 when no user is set (unauthenticated)", async () => {
  const app = createApp("normal");
  const res = await app.fetch(
    new Request("https://takos.jp/protected"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body, {
    error: {
      code: "UNAUTHORIZED",
      message: "Authentication required",
    },
  });
});

Deno.test('requireTrustTier middleware - returns 403 when user trust_tier is "new" but "normal" is required', async () => {
  const app = createApp("normal", makeUser({ trust_tier: "new" }));
  const res = await app.fetch(
    new Request("https://takos.jp/protected"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body, {
    error: {
      code: "FORBIDDEN",
      message: "Account too new for this operation",
    },
  });
});

Deno.test('requireTrustTier middleware - passes when user trust_tier is "normal" and "normal" is required', async () => {
  const app = createApp("normal", makeUser({ trust_tier: "normal" }));
  const res = await app.fetch(
    new Request("https://takos.jp/protected"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
});

Deno.test('requireTrustTier middleware - passes when user trust_tier is "trusted" and "normal" is required', async () => {
  const app = createApp("normal", makeUser({ trust_tier: "trusted" }));
  const res = await app.fetch(
    new Request("https://takos.jp/protected"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
});

Deno.test('requireTrustTier middleware - returns 403 when user trust_tier is "normal" but "trusted" is required', async () => {
  const app = createApp("trusted", makeUser({ trust_tier: "normal" }));
  const res = await app.fetch(
    new Request("https://takos.jp/protected"),
    createMockEnv() as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body, {
    error: {
      code: "FORBIDDEN",
      message: "Account too new for this operation",
    },
  });
});

Deno.test('meetsMinTier - treats unknown tier as level 0 (same as "new")', () => {
  assertEquals(meetsMinTier("unknown", "normal"), false);
  assertEquals(meetsMinTier("unknown", "new"), true);
});

Deno.test('meetsMinTier - "trusted" meets all tiers', () => {
  assertEquals(meetsMinTier("trusted", "new"), true);
  assertEquals(meetsMinTier("trusted", "normal"), true);
  assertEquals(meetsMinTier("trusted", "trusted"), true);
});
