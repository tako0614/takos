import { Hono } from "hono";

import type { Env, User } from "@/types";
import { assertEquals } from "@std/assert";
import { isAppError } from "@takos/worker-platform-utils/errors";
import { createMockEnv } from "../../../test/integration/setup.ts";

import {
  authDeps,
  optionalAuth,
  requireAuth,
} from "../../../server/middleware/auth.ts";

type TestVars = { user?: User };
type TestEnv = { Bindings: Env; Variables: TestVars };

class MockSqlPreparedStatement {
  bind(..._values: unknown[]): MockSqlPreparedStatement {
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

class MockSqlDatabaseBinding {
  prepare(_query: string): MockSqlPreparedStatement {
    return new MockSqlPreparedStatement();
  }

  exec(_query: string): Promise<{ count: number; duration: number }> {
    return Promise.resolve({ count: 0, duration: 0 });
  }

  batch<T>(statements: MockSqlPreparedStatement[]): Promise<T[]> {
    return Promise.all(
      statements.map((statement) => statement.run()),
    ) as Promise<T[]>;
  }

  withSession() {
    return {
      prepare: (_query: string) => new MockSqlPreparedStatement(),
      batch: <T>(statements: MockSqlPreparedStatement[]) =>
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
  return createMockEnv({
    DB: new MockSqlDatabaseBinding(),
    PLATFORM: {
      config: {
        adminDomain: "takos.jp",
        platformPublicKey: "test-key",
      },
      services: {
        sql: { binding: new MockSqlDatabaseBinding() },
        notifications: { sessionStore: createSessionStore() },
      },
    },
  });
}

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

function createRequireAuthApp() {
  const app = new Hono<TestEnv>();
  installAppErrorHandler(app);
  app.use("*", requireAuth);
  app.get(
    "/api/me",
    (c) => c.json({ ok: true, user_id: c.get("user")?.id ?? null }),
  );
  return app;
}

function createOptionalAuthApp() {
  const app = new Hono<TestEnv>();
  installAppErrorHandler(app);
  app.use("*", optionalAuth);
  app.get(
    "/api/repos",
    (c) => c.json({ ok: true, user_id: c.get("user")?.id ?? null }),
  );
  return app;
}

Deno.test("requireAuth rejects retired tak_oat bearer tokens with the API error envelope", async () => {
  const app = createRequireAuthApp();

  const response = await app.fetch(
    new Request("https://takos.jp/api/me", {
      headers: { Authorization: "Bearer tak_oat_malformed.token.value" },
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Invalid or expired bearer token",
    },
  });
});

Deno.test("requireAuth rejects retired tak_pat bearer tokens with the API error envelope", async () => {
  const app = createRequireAuthApp();

  const response = await app.fetch(
    new Request("https://takos.jp/api/me", {
      headers: { Authorization: "Bearer tak_pat_invalid" },
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Invalid or expired bearer token",
    },
  });
});

Deno.test("optionalAuth rejects retired tak_pat bearer tokens instead of anonymous fallback", async () => {
  const app = createOptionalAuthApp();

  const response = await app.fetch(
    new Request("https://takos.jp/api/repos", {
      headers: { Authorization: "Bearer tak_pat_invalid" },
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Invalid or expired bearer token",
    },
  });
});

Deno.test("requireAuth rejects bearer-shaped session IDs without session fallback", async () => {
  const app = createRequireAuthApp();
  const originalGetSession = authDeps.getSession;
  let sessionLookupAttempted = false;
  authDeps.getSession = (async () => {
    sessionLookupAttempted = true;
    throw new Error("session lookup should not run for bearer auth");
  }) as typeof authDeps.getSession;

  try {
    const response = await app.fetch(
      new Request("https://takos.jp/api/me", {
        headers: {
          Authorization: "Bearer session_like_id_1234567890",
        },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 401);
    assertEquals(sessionLookupAttempted, false);
    assertEquals(await response.json(), {
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or expired bearer token",
      },
    });
  } finally {
    authDeps.getSession = originalGetSession;
  }
});

Deno.test("requireAuth rejects invalid Takosumi Accounts bearer tokens", async () => {
  const app = createRequireAuthApp();

  const response = await app.fetch(
    new Request("https://takos.jp/api/me", {
      headers: { Authorization: "Bearer header.payload.signature" },
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: {
      code: "UNAUTHORIZED",
      message: "Invalid or expired bearer token",
    },
  });
});

Deno.test("optionalAuth keeps anonymous users for unsupported dotted bearer tokens", async () => {
  const app = createOptionalAuthApp();

  const response = await app.fetch(
    new Request("https://takos.jp/api/repos", {
      headers: { Authorization: "Bearer jwt.like.token" },
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true, user_id: null });
});

Deno.test("optionalAuth ignores bearer-shaped session IDs without session fallback", async () => {
  const app = createOptionalAuthApp();
  const originalGetSession = authDeps.getSession;
  let sessionLookupAttempted = false;
  authDeps.getSession = (async () => {
    sessionLookupAttempted = true;
    throw new Error("session lookup should not run for bearer auth");
  }) as typeof authDeps.getSession;

  try {
    const response = await app.fetch(
      new Request("https://takos.jp/api/repos", {
        headers: {
          Authorization: "Bearer session_like_id_1234567890",
        },
      }),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    assertEquals(sessionLookupAttempted, false);
    assertEquals(await response.json(), { ok: true, user_id: null });
  } finally {
    authDeps.getSession = originalGetSession;
  }
});
