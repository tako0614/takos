import { test } from "bun:test";
import { Hono } from "hono";
import { assertEquals } from "@std/assert";
import { assertSpyCalls, spy } from "@std/testing/mock";
import { isAppError } from "@takos/worker-platform-utils/errors";

import type { Env, User } from "../../../shared/types/index.ts";
import { SESSION_COOKIE_NAME } from "../../../application/services/identity/session.ts";
import { oauthAuthDeps } from "../../middleware/oauth-auth.ts";
import { type ApiVariables, createApiRouter } from "../api.ts";

type TestEnv = { Bindings: Env; Variables: ApiVariables };
type ApiRequireAuth = Parameters<typeof createApiRouter>[0]["requireAuth"];
type ExecutionContext = Parameters<Hono<TestEnv>["fetch"]>[2];

class MockD1PreparedStatement {
  bind(..._values: unknown[]): MockD1PreparedStatement {
    return this;
  }

  async first<T = unknown>(_column?: string): Promise<T | null> {
    return null;
  }

  async all<T = unknown>(): Promise<
    { results: T[]; success: boolean; meta: Record<string, unknown> }
  > {
    return { results: [], success: true, meta: {} };
  }

  async run(): Promise<
    {
      success: boolean;
      meta: { changes: number; last_row_id: number; duration: number };
    }
  > {
    return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return [];
  }
}

class MockSqlDatabase {
  prepare(_query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement();
  }

  exec(_query: string): Promise<{ count: number; duration: number }> {
    return Promise.resolve({ count: 0, duration: 0 });
  }

  batch<T>(statements: MockD1PreparedStatement[]): Promise<T[]> {
    return Promise.all(
      statements.map((statement) => statement.run()),
    ) as Promise<T[]>;
  }

  withSession() {
    return {
      prepare: (_query: string) => new MockD1PreparedStatement(),
      batch: <T>(statements: MockD1PreparedStatement[]) =>
        this.batch<T>(statements),
      getBookmark: () => null,
    };
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
}

function createSessionStore() {
  return {
    idFromName: (name: string) => name,
    get: (_id: string) => ({
      fetch: async () =>
        new Response(JSON.stringify({ session: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    }),
  };
}

function createEnv(): Env {
  const db = new MockSqlDatabase();
  return {
    DB: db,
    OIDC_ISSUER_URL: "https://accounts.test",
    PLATFORM: {
      config: {
        adminDomain: "takos.jp",
        platformPublicKey: "test-key",
      },
      services: {
        sql: { binding: db },
        notifications: { sessionStore: createSessionStore() },
      },
    },
  } as unknown as Env;
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

const originalOauthAuthDeps = { ...oauthAuthDeps };
const SESSION_ID = "session_1234567890";

function installAppErrorHandler(app: Hono<TestEnv>) {
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
}

const defaultRequireAuth: ApiRequireAuth = async (_c, _next) => {
  throw new Error("generic requireAuth should not handle scoped bearer routes");
};

function createApp(requireAuth: ApiRequireAuth = defaultRequireAuth) {
  const app = new Hono<TestEnv>();
  installAppErrorHandler(app);
  app.route(
    "/api",
    createApiRouter({
      requireAuth,
      optionalAuth: async (_c, next) => {
        await next();
      },
    }),
  );
  return app;
}

function restoreOauthAuthDeps() {
  Object.assign(oauthAuthDeps, originalOauthAuthDeps);
}

test("protected API denies Accounts bearer tokens missing the route family read scope", async () => {
  const validateTakosumiAccountsBearerSpy = spy(async () => ({
    userId: "user-1",
    scopes: ["profile"],
    tokenKind: "takosumi_accounts" as const,
    issuer: "https://accounts.test",
    subject: "acct_subject",
  }));
  oauthAuthDeps.validateTakosumiAccountsBearer =
    validateTakosumiAccountsBearerSpy as typeof oauthAuthDeps.validateTakosumiAccountsBearer;

  try {
    const response = await createApp().fetch(
      new Request("https://takos.jp/api/threads", {
        headers: { Authorization: "Bearer takpat_limited" },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 403);
    assertEquals(await response.json(), {
      error: {
        code: "FORBIDDEN",
        message: "Required scopes: threads:read",
      },
    });
    assertSpyCalls(validateTakosumiAccountsBearerSpy, 1);
  } finally {
    restoreOauthAuthDeps();
  }
});

test("protected API does not treat tak_oat as scoped API auth", async () => {
  const requireAuthSpy = spy(
    async (
      c: Parameters<ApiRequireAuth>[0],
      _next: Parameters<ApiRequireAuth>[1],
    ) =>
      c.json({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      }, 401),
  );

  const response = await createApp(requireAuthSpy).fetch(
    new Request("https://takos.jp/api/threads", {
      headers: { Authorization: "Bearer tak_oat_header.payload.signature" },
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Authentication required",
    },
  });
  assertSpyCalls(requireAuthSpy, 1);
});

test("protected API does not treat legacy tak_pat as scoped API auth", async () => {
  const requireAuthSpy = spy(
    async (
      c: Parameters<ApiRequireAuth>[0],
      _next: Parameters<ApiRequireAuth>[1],
    ) =>
      c.json({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      }, 401),
  );

  const response = await createApp(requireAuthSpy).fetch(
    new Request("https://takos.jp/api/threads", {
      headers: { Authorization: "Bearer tak_pat_header.payload.signature" },
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Authentication required",
    },
  });
  assertSpyCalls(requireAuthSpy, 1);
});

test("protected API allows Accounts bearer tokens with the route family scope", async () => {
  oauthAuthDeps.validateTakosumiAccountsBearer = spy(async () => ({
    userId: "user-1",
    scopes: ["profile"],
    tokenKind: "takosumi_accounts" as const,
    issuer: "https://accounts.test",
    subject: "acct_subject",
  })) as typeof oauthAuthDeps.validateTakosumiAccountsBearer;
  oauthAuthDeps.getCachedUser = spy(
    async () => resolvedUser,
  ) as typeof oauthAuthDeps.getCachedUser;

  try {
    const response = await createApp().fetch(
      new Request("https://takos.jp/api/me", {
        headers: { Authorization: "Bearer takpat_profile" },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const body = await response.json() as { username: string };
    assertEquals(body.username, "user1");
  } finally {
    restoreOauthAuthDeps();
  }
});

test("billing API is not mounted before PAT scope checks", async () => {
  const validateTakosumiAccountsBearerSpy = spy(async () => ({
    userId: "user-1",
    scopes: ["profile"],
    tokenKind: "takosumi_accounts" as const,
    issuer: "https://accounts.test",
    subject: "acct_subject",
  }));
  oauthAuthDeps.validateTakosumiAccountsBearer =
    validateTakosumiAccountsBearerSpy as typeof oauthAuthDeps.validateTakosumiAccountsBearer;

  try {
    const response = await createApp().fetch(
      new Request("https://takos.jp/api/billing", {
        headers: { Authorization: "Bearer takpat_limited" },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 404);
    assertEquals(response.headers.get("location"), null);
    assertSpyCalls(validateTakosumiAccountsBearerSpy, 0);
  } finally {
    restoreOauthAuthDeps();
  }
});

test("publications API is not mounted before PAT scope checks", async () => {
  const validateTakosumiAccountsBearerSpy = spy(async () => ({
    userId: "user-1",
    scopes: ["profile"],
    tokenKind: "takosumi_accounts" as const,
    issuer: "https://accounts.test",
    subject: "acct_subject",
  }));
  oauthAuthDeps.validateTakosumiAccountsBearer =
    validateTakosumiAccountsBearerSpy as typeof oauthAuthDeps.validateTakosumiAccountsBearer;

  try {
    const response = await createApp().fetch(
      new Request("https://takos.jp/api/publications", {
        headers: { Authorization: "Bearer takpat_limited" },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 404);
    assertEquals(response.headers.get("location"), null);
    assertSpyCalls(validateTakosumiAccountsBearerSpy, 0);
  } finally {
    restoreOauthAuthDeps();
  }
});

test("billing API is not mounted before retired bearer auth fallback", async () => {
  const requireAuthSpy = spy(
    async (
      c: Parameters<ApiRequireAuth>[0],
      _next: Parameters<ApiRequireAuth>[1],
    ) => c.json({ ok: true }, 299 as never),
  );
  try {
    const response = await createApp(requireAuthSpy).fetch(
      new Request("https://takos.jp/api/billing/portal", {
        method: "POST",
        headers: { Authorization: "Bearer tak_oat_header.payload.signature" },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 404);
    assertEquals(response.headers.get("location"), null);
    assertSpyCalls(requireAuthSpy, 0);
  } finally {
    restoreOauthAuthDeps();
  }
});

test("billing API is not mounted before browser auth fallback", async () => {
  const validateTakosumiAccountsBearerSpy = spy(
    oauthAuthDeps.validateTakosumiAccountsBearer,
  );
  oauthAuthDeps.validateTakosumiAccountsBearer =
    validateTakosumiAccountsBearerSpy as typeof oauthAuthDeps.validateTakosumiAccountsBearer;
  const requireAuthSpy = spy(
    async (
      c: Parameters<ApiRequireAuth>[0],
      _next: Parameters<ApiRequireAuth>[1],
    ) => c.json({ ok: true }, 299 as never),
  );

  try {
    const response = await createApp(requireAuthSpy).fetch(
      new Request("https://takos.jp/api/billing", {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 404);
    assertEquals(response.headers.get("location"), null);
    assertSpyCalls(requireAuthSpy, 0);
    assertSpyCalls(validateTakosumiAccountsBearerSpy, 0);
  } finally {
    restoreOauthAuthDeps();
  }
});

test("protected API keeps browser sessions at full access without token scopes", async () => {
  const validateTakosumiAccountsBearerSpy = spy(
    oauthAuthDeps.validateTakosumiAccountsBearer,
  );
  oauthAuthDeps.validateTakosumiAccountsBearer =
    validateTakosumiAccountsBearerSpy as typeof oauthAuthDeps.validateTakosumiAccountsBearer;
  try {
    const response = await createApp(async (c, next) => {
      assertEquals(
        c.req.header("Cookie"),
        `${SESSION_COOKIE_NAME}=${SESSION_ID}`,
      );
      c.set("user", resolvedUser);
      await next();
    }).fetch(
      new Request("https://takos.jp/api/me", {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const body = await response.json() as { username: string };
    assertEquals(body.username, "user1");
    assertSpyCalls(validateTakosumiAccountsBearerSpy, 0);
  } finally {
    restoreOauthAuthDeps();
  }
});
