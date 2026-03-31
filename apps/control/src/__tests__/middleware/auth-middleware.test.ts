import { Hono } from "hono";

import type { Env, User } from "@/types";
import { assertEquals } from "jsr:@std/assert";
import { isAppError } from "takos-common/errors";

import {
  optionalAuth,
  requireAuth,
} from "../../../../../packages/control/src/server/middleware/auth.ts";

type TestVars = { user?: User };
type TestEnv = { Bindings: Env; Variables: TestVars };

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

class MockD1Database {
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
  return {
    DB: new MockD1Database(),
    PLATFORM: {
      config: {},
      services: {
        sql: { binding: new MockD1Database() },
        notifications: { sessionStore: createSessionStore() },
      },
    },
  } as unknown as Env;
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

Deno.test("requireAuth rejects OAuth-style dotted bearer tokens", async () => {
  const app = createRequireAuthApp();

  const response = await app.fetch(
    new Request("https://takos.jp/api/me", {
      headers: { Authorization: "Bearer malformed.token.value" },
    }),
    createEnv(),
    {} as ExecutionContext,
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error:
      "OAuth bearer token is not supported on this endpoint. Use OAuth-protected routes.",
  });
});

Deno.test("requireAuth rejects invalid PAT bearer tokens", async () => {
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
    error: "invalid_token",
    error_description: "Invalid or expired PAT",
  });
});

Deno.test("requireAuth rejects unsupported non-PAT bearer tokens as unauthenticated", async () => {
  const app = createRequireAuthApp();

  const response = await app.fetch(
    new Request("https://takos.jp/api/me", {
      headers: { Authorization: "Bearer short" },
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
