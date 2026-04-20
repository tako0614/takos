import { assertEquals } from "jsr:@std/assert";

import type { Env } from "@/types";
import oauthIntrospect from "../../../../../../packages/control/src/server/routes/oauth/introspect.ts";

class MockD1PreparedStatement {
  private values: unknown[] = [];

  constructor(private readonly query: string) {}

  bind(...values: unknown[]): MockD1PreparedStatement {
    this.values = values;
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
    if (
      this.query.includes('from "oauth_clients"') &&
      this.values[0] === "client-1"
    ) {
      return [[
        "internal-client-1",
        "client-1",
        null,
        "public",
        "Test Client",
        null,
        null,
        null,
        null,
        null,
        '["https://example.com/callback"]',
        '["authorization_code","refresh_token"]',
        '["code"]',
        '["openid","profile"]',
        null,
        null,
        "active",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ]] as T[];
    }
    return [];
  }
}

class MockD1Database {
  prepare(query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(query);
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
      prepare: (query: string) => new MockD1PreparedStatement(query),
      batch: <T>(statements: MockD1PreparedStatement[]) =>
        this.batch<T>(statements),
      getBookmark: () => null,
    };
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
}

function createEnv(): Env {
  return {
    DB: new MockD1Database(),
    ADMIN_DOMAIN: "admin.takos.test",
    PLATFORM_PUBLIC_KEY: "test-public-key",
  } as unknown as Env;
}

async function callIntrospect(
  body: { token?: string; client_id?: string; client_secret?: string },
): Promise<Response> {
  const params = new URLSearchParams();
  if (body.token !== undefined) params.set("token", body.token);
  if (body.client_id !== undefined) params.set("client_id", body.client_id);
  if (body.client_secret !== undefined) {
    params.set("client_secret", body.client_secret);
  }

  return oauthIntrospect.fetch(
    new Request("http://localhost/introspect", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }),
    createEnv(),
    {} as ExecutionContext,
  );
}

Deno.test("oauth introspect returns invalid_request when required parameters are missing", async () => {
  const response = await callIntrospect({ client_id: "client-1" });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "invalid_request",
    error_description: "Missing required parameters",
  });
});

Deno.test("oauth introspect returns invalid_client when the client cannot be found", async () => {
  const response = await callIntrospect({
    token: "access-token",
    client_id: "missing-client",
    client_secret: "secret",
  });

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: "invalid_client",
    error_description: "Client not found",
  });
});

Deno.test("oauth introspect treats raw JWT access tokens as inactive", async () => {
  const response = await callIntrospect({
    token: "header.payload.signature",
    client_id: "client-1",
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { active: false });
});
