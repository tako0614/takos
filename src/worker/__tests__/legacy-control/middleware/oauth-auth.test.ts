import { Hono } from "hono";
import type { Env, User } from "@/types";
import { createMockEnv } from "../../../test/integration/setup.ts";
import { oauthAuthDeps, requireOAuthAuth } from "@/middleware/oauth-auth";

import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";

// [Deno] vi.mock removed - manually stub imports from '@/utils/user-cache'
// [Deno] vi.mock removed - manually stub auth token validators.
type TestVars = {
  user?: User;
  oauth?: { userId: string; clientId: string; scope: string; scopes: string[] };
};
type TestEnv = { Bindings: Env; Variables: TestVars };
const originalOAuthAuthDeps = { ...oauthAuthDeps };

// Helper to wire a stub platform-services accessor: only the `sql.binding` and
// `notifications` shape is exercised by oauth-auth, so we type the stub off the
// real dep's parameter/return shape rather than redeclaring the platform
// services interface here.
type PlatformServicesFn = typeof oauthAuthDeps.getPlatformServices;
function makePlatformServicesStub(env: Env): PlatformServicesFn {
  return ((_c) => ({
    sql: { binding: env.DB },
    notifications: {},
  })) as PlatformServicesFn;
}

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

Deno.test("requireOAuthAuth - rejects invalid Takosumi Accounts bearer", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const validateTakosumiAccountsBearer = spy(
    ((
      ..._args: Parameters<typeof oauthAuthDeps.validateTakosumiAccountsBearer>
    ) =>
      Promise.resolve(
        null,
      )) as typeof oauthAuthDeps.validateTakosumiAccountsBearer,
  );
  const getCachedUser = spy(
    ((..._args: Parameters<typeof oauthAuthDeps.getCachedUser>) =>
      Promise.resolve(null)) as typeof oauthAuthDeps.getCachedUser,
  );
  oauthAuthDeps.validateTakosumiAccountsBearer = validateTakosumiAccountsBearer;
  oauthAuthDeps.getCachedUser = getCachedUser;
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = makePlatformServicesStub(env);

  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/protected", {
      headers: { Authorization: "Bearer takpat_invalid" },
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  await assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Invalid or expired bearer token",
    },
  });
  assertSpyCalls(getCachedUser, 0);
  assertSpyCalls(validateTakosumiAccountsBearer, 1);
  Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
});
Deno.test("requireOAuthAuth - accepts Takosumi Accounts bearer with valid scopes", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const validateTakosumiAccountsBearer = spy(
    ((
      ..._args: Parameters<typeof oauthAuthDeps.validateTakosumiAccountsBearer>
    ) =>
      Promise.resolve({
        userId: "user-1",
        scopes: ["repo:read", "repo:write"],
        tokenKind: "takosumi_accounts",
        issuer: "https://accounts.example.test",
        subject: "acct_subject",
      })) as typeof oauthAuthDeps.validateTakosumiAccountsBearer,
  );
  const getCachedUser = spy(
    ((..._args: Parameters<typeof oauthAuthDeps.getCachedUser>) =>
      Promise.resolve(resolvedUser)) as typeof oauthAuthDeps.getCachedUser,
  );
  oauthAuthDeps.validateTakosumiAccountsBearer = validateTakosumiAccountsBearer;
  oauthAuthDeps.getCachedUser = getCachedUser;
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = makePlatformServicesStub(env);

  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/protected", {
      headers: { Authorization: "Bearer takpat_valid_scope" },
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  await assertEquals(await response.json(), { ok: true, userId: "user-1" });
  assertSpyCalls(getCachedUser, 1);
  assertSpyCalls(validateTakosumiAccountsBearer, 1);
  Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
});
Deno.test("requireOAuthAuth - rejects retired tak_pat bearer tokens", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const getCachedUser = spy(
    ((..._args: Parameters<typeof oauthAuthDeps.getCachedUser>) =>
      Promise.resolve(resolvedUser)) as typeof oauthAuthDeps.getCachedUser,
  );
  oauthAuthDeps.getCachedUser = getCachedUser;
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = makePlatformServicesStub(env);

  const app = createApp();

  const response = await app.fetch(
    new Request("https://takos.jp/protected", {
      headers: { Authorization: "Bearer tak_pat_managed_scope_token" },
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  await assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Unsupported bearer token",
    },
  });
  assertSpyCalls(getCachedUser, 0);
  Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
});
Deno.test("requireOAuthAuth - rejects retired tak_oat bearer tokens", async () => {
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = makePlatformServicesStub(env);

  try {
    const app = createApp();
    const response = await app.fetch(
      new Request("https://takos.jp/protected", {
        headers: {
          Authorization: "Bearer tak_oat_header.payload.signature",
        },
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 401);
    await assertEquals(await response.json(), {
      error: {
        code: "UNAUTHORIZED",
        message: "Unsupported bearer token",
      },
    });
  } finally {
    Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
  }
});
Deno.test("requireOAuthAuth - rejects raw JWT bearer tokens", async () => {
  const env = createMockEnv();
  oauthAuthDeps.validateTakosumiAccountsBearer = spy(
    ((
      ..._args: Parameters<typeof oauthAuthDeps.validateTakosumiAccountsBearer>
    ) =>
      Promise.resolve(
        null,
      )) as typeof oauthAuthDeps.validateTakosumiAccountsBearer,
  );
  oauthAuthDeps.getPlatformServices = makePlatformServicesStub(env);

  try {
    const app = createApp();
    const response = await app.fetch(
      new Request("https://takos.jp/protected", {
        headers: {
          Authorization: "Bearer header.payload.signature",
        },
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 401);
    await assertEquals(await response.json(), {
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired bearer token",
      },
    });
  } finally {
    Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
  }
});
Deno.test("requireOAuthAuth - rejects Takosumi Accounts bearer when required scope missing", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const validateTakosumiAccountsBearer = spy(
    ((
      ..._args: Parameters<typeof oauthAuthDeps.validateTakosumiAccountsBearer>
    ) =>
      Promise.resolve(
        null,
      )) as typeof oauthAuthDeps.validateTakosumiAccountsBearer,
  );
  const getCachedUser = spy(
    ((..._args: Parameters<typeof oauthAuthDeps.getCachedUser>) =>
      Promise.resolve(null)) as typeof oauthAuthDeps.getCachedUser,
  );
  oauthAuthDeps.validateTakosumiAccountsBearer = validateTakosumiAccountsBearer;
  oauthAuthDeps.getCachedUser = getCachedUser;
  const env = createMockEnv();
  oauthAuthDeps.getPlatformServices = makePlatformServicesStub(env);

  const app = new Hono<TestEnv>();
  app.get(
    "/protected",
    requireOAuthAuth(["repo:write"]),
    (c) => c.json({ ok: true }),
  );

  const response = await app.fetch(
    new Request("https://takos.jp/protected", {
      headers: { Authorization: "Bearer takpat_missing_scope" },
    }),
    env,
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  await assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Invalid or expired bearer token",
    },
  });
  assertSpyCalls(getCachedUser, 0);
  assertSpyCalls(validateTakosumiAccountsBearer, 1);
  Object.assign(oauthAuthDeps, originalOAuthAuthDeps);
});
