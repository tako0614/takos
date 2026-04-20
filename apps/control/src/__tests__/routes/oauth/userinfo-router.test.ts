import { assertEquals } from "jsr:@std/assert";

import type { Env } from "@/types";
import oauthUserinfo from "@/routes/oauth/userinfo";

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

async function callUserinfo(token?: string): Promise<Response> {
  const headers = token === undefined
    ? undefined
    : { Authorization: `Bearer ${token}` };
  return oauthUserinfo.fetch(
    new Request("http://localhost/userinfo", { headers }),
    createEnv(),
    {} as ExecutionContext,
  );
}

Deno.test("oauth userinfo rejects raw JWT bearer tokens", async () => {
  const response = await callUserinfo("header.payload.signature");

  assertEquals(response.status, 401);
  assertEquals(await response.json(), {
    error: "invalid_token",
    error_description: "Token verification failed",
  });
});
