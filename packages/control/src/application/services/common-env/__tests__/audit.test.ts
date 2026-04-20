import type { D1Database } from "../../../../shared/types/bindings.ts";
import type { Env } from "../../../../shared/types/index.ts";

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";

import { hashAuditIp, writeCommonEnvAuditLog } from "../audit.ts";

type QueryKind = "first" | "all" | "run" | "raw";

type PreparedStatementRecord = {
  sql: string;
  args: unknown[];
  methods: QueryKind[];
};

function createFakeD1Database() {
  const prepared: PreparedStatementRecord[] = [];
  const db = {
    prepare(sql: string) {
      const record: PreparedStatementRecord = { sql, args: [], methods: [] };
      prepared.push(record);

      let statement: {
        bind(...values: unknown[]): typeof statement;
        first<T = Record<string, unknown>>(): Promise<T | null>;
        all<T = Record<string, unknown>>(): Promise<
          { results: T[]; success: true; meta: Record<string, unknown> }
        >;
        run<T = Record<string, unknown>>(): Promise<
          { results: T[]; success: true; meta: Record<string, unknown> }
        >;
        raw<T = unknown[]>(
          options?: { columnNames?: boolean },
        ): Promise<T[] | [string[], ...T[]]>;
      };

      statement = {
        bind(...values: unknown[]) {
          record.args = values;
          return statement;
        },
        async first<T = Record<string, unknown>>() {
          record.methods.push("first");
          return null as T | null;
        },
        async all<T = Record<string, unknown>>() {
          record.methods.push("all");
          return {
            results: [] as T[],
            success: true as const,
            meta: {
              changed_db: false,
              changes: 0,
              duration: 0,
              last_row_id: 0,
              rows_read: 0,
              rows_written: 0,
              served_by: "test",
              size_after: 0,
            },
          };
        },
        async run<T = Record<string, unknown>>() {
          record.methods.push("run");
          return {
            results: [] as T[],
            success: true as const,
            meta: {
              changed_db: false,
              changes: 0,
              duration: 0,
              last_row_id: 0,
              rows_read: 0,
              rows_written: 0,
              served_by: "test",
              size_after: 0,
            },
          };
        },
        async raw<T = unknown[]>(options?: { columnNames?: boolean }) {
          record.methods.push("raw");
          if (options?.columnNames) {
            return [[]] as [string[], ...T[]];
          }
          return [] as T[];
        },
      };

      return statement;
    },
    async batch<T = Record<string, unknown>>(
      statements: Array<
        {
          run(): Promise<
            { results: T[]; success: true; meta: Record<string, unknown> }
          >;
        }
      >,
    ) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    withSession() {
      return db;
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database & { prepared: PreparedStatementRecord[] };

  return { db, prepared };
}

Deno.test("hashAuditIp - returns undefined for empty ip", async () => {
  const env = { AUDIT_IP_HASH_KEY: "secret" } as unknown as Env;
  const result = await hashAuditIp(env, "");
  assertEquals(result, undefined);
});

Deno.test("hashAuditIp - returns undefined for undefined ip", async () => {
  const env = { AUDIT_IP_HASH_KEY: "secret" } as unknown as Env;
  const result = await hashAuditIp(env, undefined);
  assertEquals(result, undefined);
});

Deno.test("hashAuditIp - returns undefined when AUDIT_IP_HASH_KEY is not set", async () => {
  const env = {} as unknown as Env;
  const result = await hashAuditIp(env, "127.0.0.1");
  assertEquals(result, undefined);
});

Deno.test("hashAuditIp - returns a hex string for valid ip and key", async () => {
  const env = { AUDIT_IP_HASH_KEY: "test-secret-key" } as unknown as Env;
  const result = await hashAuditIp(env, "192.168.1.1");
  assert(result !== undefined);
  assertEquals(typeof result, "string");
  assertEquals(result!.length, 64);
  assertEquals(/^[0-9a-f]+$/.test(result!), true);
});

Deno.test("hashAuditIp - produces consistent hashes for the same input", async () => {
  const env = { AUDIT_IP_HASH_KEY: "test-secret-key" } as unknown as Env;
  const result1 = await hashAuditIp(env, "10.0.0.1");
  const result2 = await hashAuditIp(env, "10.0.0.1");
  assertEquals(result1, result2);
});

Deno.test("hashAuditIp - produces different hashes for different ips", async () => {
  const env = { AUDIT_IP_HASH_KEY: "test-secret-key" } as unknown as Env;
  const result1 = await hashAuditIp(env, "10.0.0.1");
  const result2 = await hashAuditIp(env, "10.0.0.2");
  assertNotEquals(result1, result2);
});

Deno.test("writeCommonEnvAuditLog - inserts an audit log entry with the expected values", async () => {
  const { db, prepared } = createFakeD1Database();

  await writeCommonEnvAuditLog({
    db,
    spaceId: "space-1",
    eventType: "workspace_env_created",
    envName: "MY_VAR",
    workerId: "worker-1",
    linkSource: "manual",
    changeBefore: { exists: false },
    changeAfter: { exists: true },
    actor: {
      type: "user",
      userId: "user-1",
      requestId: "req-1",
      ipHash: "hash-1",
      userAgent: "test-agent",
    },
  });

  assertEquals(prepared.length, 1);
  assert(prepared[0].sql.includes("common_env_audit_logs"));
  assertEquals(prepared[0].methods.length > 0, true);

  const args = prepared[0].args;
  assert(args.includes("space-1"));
  assert(args.includes("workspace_env_created"));
  assert(args.includes("MY_VAR"));
  assert(args.includes("worker-1"));
  assert(args.includes("manual"));
  assert(args.includes("req-1"));
  assert(args.includes("hash-1"));
  assert(args.includes("test-agent"));
  assert(args.includes("user"));
  assert(args.includes("user-1"));
});

Deno.test("writeCommonEnvAuditLog - uses system actor defaults when actor is not provided", async () => {
  const { prepared, db } = createFakeD1Database();

  await writeCommonEnvAuditLog({
    db,
    spaceId: "space-1",
    eventType: "workspace_env_deleted",
    envName: "MY_VAR",
  });

  const args = prepared[0].args;
  assertEquals(prepared.length, 1);
  assertEquals(args.includes("system"), true);
  assertEquals(args.includes(null), true);
});

Deno.test("writeCommonEnvAuditLog - handles null/undefined optional fields", async () => {
  const { prepared, db } = createFakeD1Database();

  await writeCommonEnvAuditLog({
    db,
    spaceId: "space-1",
    eventType: "worker_link_added",
    envName: "MY_VAR",
  });

  const args = prepared[0].args;
  assertEquals(prepared.length, 1);
  assertEquals(args.includes(null), true);
  assertEquals(args.some((value) => value === "{}"), true);
});
