import { executeD1RawStatement } from "@/runtime/container-hosts/d1-raw.ts";

import { assertEquals } from "jsr:@std/assert";
import { assertSpyCallArgs, spy } from "jsr:@std/testing/mock";

class ProxyD1PreparedStatement {
  constructor(
    private readonly proxy: {
      post: (
        path: string,
        body: Record<string, unknown>,
      ) => Promise<{ results: unknown }>;
    },
    private readonly sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  raw(rawOptions: Record<string, unknown>) {
    return this.proxy.post("/proxy/db/raw", {
      sql: this.sql,
      params: this.params,
      rawOptions,
    }).then((response) => response.results);
  }
}

class ProxyD1Database {
  constructor(
    private readonly proxy: {
      post: (
        path: string,
        body: Record<string, unknown>,
      ) => Promise<{ results: unknown }>;
    },
  ) {}

  prepare(sql: string) {
    return new ProxyD1PreparedStatement(this.proxy, sql);
  }
}
Deno.test(
  "agent executor D1 proxy contract - forwards columnNames raw options to D1 statements on the host side",
  async () => {
    const raw = spy(async (
      _rawOptions?: Record<string, unknown>,
    ) => [["id"], ["run-1"]]);

    const result = await executeD1RawStatement(
      { raw } as unknown as Parameters<typeof executeD1RawStatement>[0],
      { columnNames: true },
    );

    assertSpyCallArgs(raw, 0, [{ columnNames: true }]);
    assertEquals(result, [["id"], ["run-1"]]);
  },
);

Deno.test(
  "agent executor D1 proxy contract - forwards raw options through the container proxy stub",
  async () => {
    const post = spy(async () => ({ results: [["id"], ["run-1"]] }));
    const proxy = { post };

    const db = new ProxyD1Database(proxy as never);

    const result = await db
      .prepare("SELECT id FROM runs WHERE id = ?")
      .bind("run-1")
      .raw({ columnNames: true });

    assertSpyCallArgs(post, 0, [
      "/proxy/db/raw",
      {
        sql: "SELECT id FROM runs WHERE id = ?",
        params: ["run-1"],
        rawOptions: { columnNames: true },
      },
    ]);
    assertEquals(result, [["id"], ["run-1"]]);
  },
);
