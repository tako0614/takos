import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { oauthAuthDeps, requireOAuthAuth } from "@/middleware/oauth-auth";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

// [Deno] vi.mock removed - manually stub imports from '@/utils/user-cache'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/takos-access-tokens'
type TestVars = {
  user?: User;
  oauth?: { userId: string; clientId: string; scope: string; scopes: string[] };
};
type TestEnv = { Bindings: Env; Variables: TestVars };
const originalOAuthAuthDeps = { ...oauthAuthDeps };

function createApp() {
  const app = new Hono<TestEnv>();
  app.get(
    "/protected",
    requireOAuthAuth(),
    (c) => c.json({ ok: true, userId: c.get("oauth")?.userId }),
  );
  return app;
}

const resolvedUser: User = {
  id: "user-1",
  email: "user1@example.com",
  name: "User1",
  username: "user1",
  bio: null,
  picture: null,
  trust_tier: "normal",
  setup_completed: true,
  created_at: "2026-02-13T00:00:00.000Z",
  updated_at: "2026-02-13T00:00:00.000Z",
};

Deno.test("requireOAuthAuth PAT scope validation - rejects PAT with invalid JSON scopes", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const validateTakosAccessToken = spy(async () => null) as any;
  const getCachedUser = spy(async () => null) as any;
  oauthAuthDeps.validateTakosAccessToken = validateTakosAccessToken;
  oauthAuthDeps.getCachedUser = getCachedUser;
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = ((() => ({
    sql: { binding: env.DB },
    notifications: {},
  })) as unknown) as typeof oauthAuthDeps.getPlatformServices;

  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/protected", {
      headers: { Authorization: "Bearer tak_pat_malformed_scopes" },
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  await assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Invalid or expired PAT",
    },
  });
  assertSpyCalls(getCachedUser, 0);
  assertSpyCalls(validateTakosAccessToken, 1);
  Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
});
Deno.test("requireOAuthAuth PAT scope validation - accepts PAT with valid scopes and required scope present", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const validateTakosAccessToken = spy(async () => ({
    userId: "user-1",
    scopes: ["repo:read", "repo:write"],
    tokenKind: "personal",
  })) as any;
  const getCachedUser = spy(async () => resolvedUser) as any;
  oauthAuthDeps.validateTakosAccessToken = validateTakosAccessToken;
  oauthAuthDeps.getCachedUser = getCachedUser;
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = ((() => ({
    sql: { binding: env.DB },
    notifications: {},
  })) as unknown) as typeof oauthAuthDeps.getPlatformServices;

  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/protected", {
      headers: { Authorization: "Bearer tak_pat_valid_scope" },
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertEquals(await response.json(), { ok: true, userId: "user-1" });
  assertSpyCalls(getCachedUser, 1);
  Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
});
Deno.test("requireOAuthAuth PAT scope validation - accepts managed Takos token with valid scopes", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const validateTakosAccessToken = spy(async () => ({
    userId: "user-1",
    scopes: ["repo:read", "repo:write"],
    tokenKind: "managed_takos",
  })) as any;
  const getCachedUser = spy(async () => resolvedUser) as any;
  oauthAuthDeps.validateTakosAccessToken = validateTakosAccessToken;
  oauthAuthDeps.getCachedUser = getCachedUser;
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = ((() => ({
    sql: { binding: env.DB },
    notifications: {},
  })) as unknown) as typeof oauthAuthDeps.getPlatformServices;

  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/protected", {
      headers: { Authorization: "Bearer tak_pat_managed_scope_token" },
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertEquals(await response.json(), { ok: true, userId: "user-1" });
  Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
});
Deno.test("requireOAuthAuth - accepts tak_oat-prefixed OAuth bearer tokens", async () => {
  const verifyAccessTokenSpy = spy(
    async (params: Parameters<typeof oauthAuthDeps.verifyAccessToken>[0]) => {
      assertEquals(params.token, "tak_oat_header.payload.signature");
      return {
        iss: "https://test.takos.jp",
        sub: "user-1",
        aud: "client-1",
        exp: 1_800_000_000,
        iat: 1_700_000_000,
        jti: "jti-1",
        scope: "profile",
        client_id: "client-1",
      };
    },
  );
  const isAccessTokenValidSpy = spy(async () => true);
  const getCachedUserSpy = spy(async () => resolvedUser);
  oauthAuthDeps.verifyAccessToken =
    verifyAccessTokenSpy as typeof oauthAuthDeps.verifyAccessToken;
  oauthAuthDeps.isAccessTokenValid =
    isAccessTokenValidSpy as typeof oauthAuthDeps.isAccessTokenValid;
  oauthAuthDeps.getCachedUser =
    getCachedUserSpy as typeof oauthAuthDeps.getCachedUser;
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = ((() => ({
    sql: { binding: env.DB },
    notifications: {},
  })) as unknown) as typeof oauthAuthDeps.getPlatformServices;

  try {
    const app = createApp();
    const response = await app.fetch(
      new Request("https://takos.jp/protected", {
        headers: {
          Authorization: "Bearer tak_oat_header.payload.signature",
        },
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, userId: "user-1" });
    assertSpyCalls(verifyAccessTokenSpy, 1);
    assertSpyCalls(isAccessTokenValidSpy, 1);
    assertSpyCalls(getCachedUserSpy, 1);
  } finally {
    Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
  }
});
Deno.test("requireOAuthAuth - rejects raw JWT bearer tokens", async () => {
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = ((() => ({
    sql: { binding: env.DB },
    notifications: {},
  })) as unknown) as typeof oauthAuthDeps.getPlatformServices;

  try {
    const app = createApp();
    const response = await app.fetch(
      new Request("https://takos.jp/protected", {
        headers: {
          Authorization: "Bearer header.payload.signature",
        },
      }),
      env as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 401);
    await assertEquals(await response.json(), {
      error: {
        code: "UNAUTHORIZED",
        message: "Token verification failed",
      },
    });
  } finally {
    Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
  }
});
Deno.test("requireOAuthAuth PAT scope validation - rejects PAT when required scope missing", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const validateTakosAccessToken = spy(async () => null) as any;
  const getCachedUser = spy(async () => null) as any;
  oauthAuthDeps.validateTakosAccessToken = validateTakosAccessToken;
  oauthAuthDeps.getCachedUser = getCachedUser;
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = ((() => ({
    sql: { binding: env.DB },
    notifications: {},
  })) as unknown) as typeof oauthAuthDeps.getPlatformServices;

  const app = new Hono<TestEnv>();
  app.get(
    "/protected",
    requireOAuthAuth(["repo:write"]),
    (c) => c.json({ ok: true }),
  );

  const response = await app.fetch(
    new Request("https://takos.jp/protected", {
      headers: { Authorization: "Bearer tak_pat_missing_scope" },
    }),
    env as unknown as Env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  await assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Invalid or expired PAT",
    },
  });
  assertSpyCalls(getCachedUser, 0);
  Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
});
