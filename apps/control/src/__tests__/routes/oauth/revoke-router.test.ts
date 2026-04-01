import { assertEquals } from "jsr:@std/assert";

import type { Env } from "@/types";
import oauthRevoke from "../../../../../../packages/control/src/server/routes/oauth/revoke.ts";

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

function createEnv(): Env {
  return {
    DB: new MockD1Database(),
    ADMIN_DOMAIN: "admin.takos.test",
    PLATFORM_PUBLIC_KEY: "test-public-key",
  } as unknown as Env;
}

async function callRevoke(
  body: {
    token?: string;
    client_id?: string;
    client_secret?: string;
    token_type_hint?: string;
  },
): Promise<Response> {
  const params = new URLSearchParams();
  if (body.token !== undefined) params.set("token", body.token);
  if (body.client_id !== undefined) params.set("client_id", body.client_id);
  if (body.client_secret !== undefined) {
    params.set("client_secret", body.client_secret);
  }
  if (body.token_type_hint !== undefined) {
    params.set("token_type_hint", body.token_type_hint);
  }

  return oauthRevoke.fetch(
    new Request("http://localhost/revoke", {
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

Deno.test("oauth revoke returns invalid_request when required parameters are missing", async () => {
  const response = await callRevoke({ client_id: "client-1" });

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    error: "invalid_request",
    error_description: "Missing required parameters",
  });
});

Deno.test("oauth revoke returns invalid_client when the client cannot be found", async () => {
  const response = await callRevoke({
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
