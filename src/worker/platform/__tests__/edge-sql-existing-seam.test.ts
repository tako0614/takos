import { expect, test } from "bun:test";
import { TAKOSUMI_WELL_KNOWN_PATH } from "@takosjp/takosumi-contract/discovery";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { getDb } from "../../infra/db/client.ts";
import type { SqlDatabaseBinding } from "../../shared/types/bindings.ts";
import type { Env } from "../../shared/types/index.ts";
import { createWebWorker } from "../../web.ts";
import { buildWorkersWebPlatform } from "../adapters/workers.ts";

const edgeSqlProbe = sqliteTable("edge_sql_probe", {
  id: integer("id").notNull(),
  label: text("label").notNull(),
});

test("the workers platform maps structured selects without host key-order assumptions", async () => {
  const calls: string[] = [];
  const external = {
    execute: async () => {
      calls.push("execute");
      throw new Error("a structured select must use rollback-only query");
    },
    query: async (statement: string) => {
      calls.push("query");
      const aliases = [...statement.matchAll(/ as "([^"]+)"/g)].map(
        (match) => match[1]!,
      );
      expect(aliases).toHaveLength(2);
      expect(aliases.every((alias) => !/^(?:0|[1-9][0-9]*)$/.test(alias)))
        .toBe(true);
      return {
        // Deliberately reverse insertion order. The published binding returns
        // JSON records and gives consumers no property-order guarantee.
        rows: [{ [aliases[1]!]: "alpha", [aliases[0]!]: 7 }],
        rowsWritten: 0,
      };
    },
    transaction: async () => ({ results: [] }),
  };
  const platform = buildWorkersWebPlatform({ DB: external } as unknown as Env);
  const db = getDb(platform.services.sql!.binding!);

  const result = await db.select().from(edgeSqlProbe);

  expect(result).toEqual([{ id: 7, label: "alpha" }]);
  expect(calls).toEqual(["query"]);
});

test("the existing getDb raw run seam uses edge.sql execute", async () => {
  const calls: string[] = [];
  const external = {
    async execute(statement: string) {
      calls.push(statement);
      return { rows: [{ "1": 1 }], rowsWritten: 0 };
    },
    async query() {
      throw new Error("raw SQL cannot be classified as rollback-only");
    },
    async transaction() {
      throw new Error("unexpected transaction");
    },
  };
  const platform = buildWorkersWebPlatform({ DB: external } as unknown as Env);
  const db = getDb(platform.services.sql!.binding!);

  const result = await db.run(sql.raw("SELECT 1"));

  expect(result.results).toEqual([{ "1": 1 }]);
  expect(result.meta.changes).toBe(0);
  expect(calls).toEqual(["SELECT 1"]);
});

test("externally managed edge.sql skips Worker-owned migration triggers", async () => {
  const sqlCalls: string[] = [];
  const external = {
    async execute() {
      sqlCalls.push("execute");
      throw new Error("runtime migration SQL must not execute");
    },
    async query() {
      sqlCalls.push("query");
      throw new Error("runtime migration SQL must not query");
    },
    async transaction() {
      sqlCalls.push("transaction");
      throw new Error("runtime migrations must not transact");
    },
  };
  const env = {
    DB: external,
    HOSTNAME_ROUTING: {},
    SESSION_DO: {},
    RUN_NOTIFIER: {},
    RUN_QUEUE: {},
    OIDC_ISSUER_URL: "https://accounts.example",
    OIDC_CLIENT_ID: "takos-public-client",
    ADMIN_DOMAIN: "takos.example",
    TENANT_BASE_DOMAIN: "tenant.example",
    PLATFORM_PRIVATE_KEY: "test-private-key",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    TAKOS_AGENT_START_TOKEN: "test-agent-token",
    ENCRYPTION_KEY: "test-encryption-key",
    ENVIRONMENT: "development",
  } as unknown as Env;
  const worker = createWebWorker();

  const response = await worker.fetch(
    new Request(`https://takos.example${TAKOSUMI_WELL_KNOWN_PATH}`),
    env,
    {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as never,
  );
  await worker.scheduled({ cron: "not-a-runtime-cron" } as never, env);

  expect(response.status).toBe(200);
  expect(sqlCalls).toEqual([]);
});

test("native D1 keeps the pinned drizzle-orm/d1 driver", () => {
  const native = {
    prepare() {
      throw new Error("not executed");
    },
    async batch() {
      return [];
    },
  } as unknown as SqlDatabaseBinding;

  const db = getDb(native);

  expect(db.$client).toBe(native);
  expect(getDb(native)).toBe(db);
});
