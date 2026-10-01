import { expect, test } from "bun:test";
import { createClient, type Client, type ResultSet } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getDb } from "../../../infra/db/index.ts";
import * as schema from "../../../infra/db/schema.ts";
import { recordAppUsage, recordRunUsageBatch } from "./usage-recorder.ts";
import { adaptEdgeSqlBinding } from "../../../platform/adapters/edge-sql.ts";
import type { Env } from "../../../shared/types/index.ts";
import type {
  EdgeSqlBinding,
  EdgeSqlResult,
  EdgeSqlStatement,
  EdgeSqlValue,
  ObjectStoreBinding,
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
  SqlTransactionSessionBinding,
} from "../../../shared/types/bindings.ts";
import { createInMemoryObjectStore } from "../../../local-platform/in-memory-r2.ts";
import {
  usageSegmentKey,
  writeUsageEventSegmentToR2,
  type PersistedUsageEvent,
} from "../offload/usage-events.ts";
import type { AppUsageRecordInput } from "./usage-types.ts";

const ACCOUNT_ID = "usage-owner";
const RUN_ID = "usage-run";
const CREATED_AT = "2026-10-01T00:00:00.000Z";

type SqlExecutor = (
  sql: string,
  args: readonly unknown[],
) => Promise<ResultSet>;

function toSqlResult<T>(result: ResultSet): SqlResultBinding<T> {
  return {
    results: result.rows as unknown as T[],
    success: true,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: 0,
      rows_written: result.rowsAffected,
      last_row_id: Number(result.lastInsertRowid ?? 0),
      changed_db: result.rowsAffected > 0,
      changes: result.rowsAffected,
    },
  };
}

function preparedStatement(
  sql: string,
  execute: SqlExecutor,
): SqlPreparedStatementBinding {
  let args: readonly unknown[] = [];
  async function raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  async function raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async function raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const result = await execute(sql, args);
    const rows = result.rows.map((row) => Object.values(row)) as T[];
    if (options?.columnNames) {
      return [Object.keys(result.rows[0] ?? {}) as string[], ...rows];
    }
    return rows;
  }
  const statement: SqlPreparedStatementBinding = {
    bind(...values: unknown[]) {
      args = values;
      return statement;
    },
    async first<T = Record<string, unknown>>() {
      const result = await execute(sql, args);
      return (result.rows[0] as T | undefined) ?? null;
    },
    async run<T = Record<string, unknown>>() {
      return toSqlResult<T>(await execute(sql, args));
    },
    async all<T = Record<string, unknown>>() {
      return toSqlResult<T>(await execute(sql, args));
    },
    raw,
  };
  return statement;
}

function createStatefulSqlBinding(
  client: Client,
  options: { pauseBeforeCallback?: boolean } = {},
) {
  let transactionCalls = 0;
  let outerBatchCalls = 0;
  let active = Promise.resolve();
  let signalEntered: (() => void) | undefined;
  let releaseCallback: (() => void) | undefined;
  const entered = options.pauseBeforeCallback
    ? new Promise<void>((resolve) => signalEntered = resolve)
    : Promise.resolve();
  const callbackGate = options.pauseBeforeCallback
    ? new Promise<void>((resolve) => releaseCallback = resolve)
    : Promise.resolve();

  const outerExecute: SqlExecutor = async (sql, args) =>
    client.execute({ sql, args: args as never });

  const binding: SqlDatabaseBinding = {
    prepare(sql) {
      return preparedStatement(sql, outerExecute);
    },
    async batch<T>(): Promise<SqlResultBinding<T>[]> {
      outerBatchCalls += 1;
      throw new Error("outer batch is forbidden for stateful usage writes");
    },
    async exec(query) {
      await client.executeMultiple(query);
      return { count: 0, duration: 0 };
    },
    withSession() {
      const prepare = (sql: string) => preparedStatement(sql, outerExecute);
      return {
        prepare,
        async batch<T>(statements: SqlPreparedStatementBinding[]) {
          return Promise.all(statements.map((statement) => statement.run<T>()));
        },
        getBookmark: () => null,
      };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
    async withTransaction<T>(callback: (tx: SqlTransactionSessionBinding) => Promise<T>) {
      const previous = active;
      let release: (() => void) | undefined;
      active = new Promise<void>((resolve) => release = resolve);
      await previous;
      transactionCalls += 1;
      const transaction = await client.transaction("write");
      const txExecute: SqlExecutor = async (sql, args) =>
        transaction.execute({ sql, args: args as never });
      const tx: SqlTransactionSessionBinding = {
        prepare(sql) {
          return preparedStatement(sql, txExecute);
        },
        async batch<T>(statements: SqlPreparedStatementBinding[]) {
          const results: SqlResultBinding<T>[] = [];
          for (const statement of statements) {
            results.push(await statement.run<T>());
          }
          return results;
        },
        async exec(query) {
          await transaction.executeMultiple(query);
          return { count: 0, duration: 0 };
        },
      };
      try {
        signalEntered?.();
        await callbackGate;
        const result = await callback(tx);
        await transaction.commit();
        return result;
      } catch (error) {
        await transaction.rollback();
        throw error;
      } finally {
        transaction.close();
        release?.();
      }
    },
  };

  return {
    binding,
    entered,
    releaseCallback() {
      releaseCallback?.();
    },
    counts() {
      return { transactionCalls, outerBatchCalls };
    },
  };
}

function createLibsqlEdgeBinding(client: Client) {
  const transactions: EdgeSqlStatement[][] = [];
  const execute = async (
    sql: string,
    params: readonly EdgeSqlValue[] = [],
  ): Promise<EdgeSqlResult> => {
    const result = await client.execute({ sql, args: params as never });
    return {
      rows: result.rows.map((row) =>
        Object.fromEntries(Object.entries(row)) as Record<string, EdgeSqlValue>
      ),
      rowsWritten: result.rowsAffected,
    };
  };
  const binding: EdgeSqlBinding = {
    execute,
    async query(sql, params) {
      const result = await execute(sql, params);
      return { rows: result.rows, rowsWritten: 0 };
    },
    async transaction(statements) {
      transactions.push(statements.map((statement) => ({
        sql: statement.sql,
        params: statement.params ? [...statement.params] : undefined,
      })));
      const results = await client.batch(
        statements.map((statement) => ({
          sql: statement.sql,
          args: (statement.params ?? []) as never,
        })),
        "write",
      );
      return {
        results: results.map((result) => ({
          rows: result.rows.map((row) =>
            Object.fromEntries(Object.entries(row)) as Record<string, EdgeSqlValue>
          ),
          rowsWritten: result.rowsAffected,
        })),
      };
    },
  };
  return { binding, transactions };
}

async function createFixture(options: {
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
  fileBacked?: boolean;
} = {}) {
  const directory = options.fileBacked
    ? await mkdtemp(join(tmpdir(), "takos-usage-recorder-"))
    : undefined;
  const client = createClient({
    url: directory
      ? pathToFileURL(join(directory, "usage.sqlite")).href
      : ":memory:",
  });
  await client.executeMultiple(`
    CREATE TABLE app_usage_events (
      id TEXT PRIMARY KEY NOT NULL,
      idempotency_key TEXT,
      owner_account_id TEXT NOT NULL,
      scope_type TEXT NOT NULL DEFAULT 'space',
      space_id TEXT,
      meter_type TEXT NOT NULL,
      units REAL NOT NULL,
      reference_id TEXT,
      reference_type TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_app_usage_events_idempotency_key
      ON app_usage_events (idempotency_key);
    CREATE TABLE app_usage_rollups (
      id TEXT PRIMARY KEY NOT NULL,
      owner_account_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      space_id TEXT,
      meter_type TEXT NOT NULL,
      period_start TEXT NOT NULL,
      units REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_app_usage_rollups_scope
      ON app_usage_rollups (
        owner_account_id, scope_type, scope_id, meter_type, period_start
      );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT,
      usage TEXT NOT NULL DEFAULT '{}'
    );
  `);
  const db = drizzle(client, { schema });
  await client.execute({
    sql: "INSERT INTO runs (id, account_id, usage) VALUES (?, ?, ?)",
    args: [RUN_ID, ACCOUNT_ID, JSON.stringify(options.tokenUsage ?? {})],
  });

  const baseBucket = createInMemoryObjectStore();
  const env = {
    DB: db,
    TAKOS_OFFLOAD: baseBucket,
  } as unknown as Env;

  return {
    client,
    db,
    env,
    bucket: baseBucket,
    async close() {
      client.close();
      if (directory) await rm(directory, { force: true, recursive: true });
    },
    async count(table: "app_usage_events" | "app_usage_rollups") {
      const result = await client.execute(`SELECT COUNT(*) AS count FROM ${table}`);
      return Number(result.rows[0]?.count ?? 0);
    },
    async meterUnits(table: "app_usage_events" | "app_usage_rollups") {
      const result = await client.execute(
        `SELECT meter_type, units FROM ${table} ORDER BY meter_type`,
      );
      return result.rows.map((row) => ({
        meterType: String(row.meter_type),
        units: Number(row.units),
      }));
    },
  };
}

function rawEvent(
  meterType: string,
  units: number,
  index: number,
): PersistedUsageEvent {
  return {
    meter_type: meterType,
    units,
    created_at: new Date(Date.parse(CREATED_AT) + index).toISOString(),
  };
}

async function putSegmentedEvents(
  bucket: ObjectStoreBinding,
  runId: string,
  events: PersistedUsageEvent[],
): Promise<void> {
  for (let offset = 0, segment = 1; offset < events.length; offset += 200, segment += 1) {
    await writeUsageEventSegmentToR2(
      bucket,
      runId,
      segment,
      events.slice(offset, offset + 200),
    );
  }
}

test("recordAppUsage rolls back its event when the rollup write fails, then retries once", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.execute(`
      CREATE TRIGGER reject_usage_rollup BEFORE INSERT ON app_usage_rollups
      BEGIN SELECT RAISE(ABORT, 'rollup unavailable'); END;
    `);

    await expect(recordAppUsage(fixture.db, {
      ownerAccountId: ACCOUNT_ID,
      meterType: "embedding_count",
      units: 7,
      idempotencyKey: "retryable-usage-event",
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);

    await fixture.client.execute("DROP TRIGGER reject_usage_rollup");
    const result = await recordAppUsage(fixture.db, {
      ownerAccountId: ACCOUNT_ID,
      meterType: "embedding_count",
      units: 7,
      idempotencyKey: "retryable-usage-event",
    });
    expect(result.applied).toBe(true);
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "embedding_count", units: 7 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "embedding_count", units: 7 },
    ]);
  } finally {
    await fixture.close();
  }
});

test("recordRunUsageBatch rejects more than 50000 raw events before writing SQL", async () => {
  const fixture = await createFixture({ tokenUsage: { inputTokens: 1000 } });
  try {
    await putSegmentedEvents(
      fixture.bucket,
      RUN_ID,
      Array.from({ length: 50_001 }, (_, index) =>
        rawEvent("embedding_count", 1, index)
      ),
    );

    await expect(recordRunUsageBatch(fixture.env, RUN_ID)).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("recordRunUsageBatch records the exact event limit once and ignores unknown meters", async () => {
  const fixture = await createFixture({ tokenUsage: { inputTokens: 1000 } });
  try {
    const events = Array.from({ length: 49_999 }, (_, index) =>
      rawEvent("embedding_count", 1, index)
    );
    events.push(rawEvent("future_unrecognized_meter", 900, 49_999));
    await putSegmentedEvents(fixture.bucket, RUN_ID, events);

    await recordRunUsageBatch(fixture.env, RUN_ID);
    await recordRunUsageBatch(fixture.env, RUN_ID);

    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "embedding_count", units: 49_999 },
      { meterType: "llm_tokens_input", units: 1 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "embedding_count", units: 49_999 },
      { meterType: "llm_tokens_input", units: 1 },
    ]);
    expect(await fixture.count("app_usage_events")).toBe(2);
  } finally {
    await fixture.close();
  }
});

test("recordRunUsageBatch rejects an overflowing raw aggregate before any meter writes", async () => {
  const fixture = await createFixture({ tokenUsage: { inputTokens: 1000 } });
  try {
    await putSegmentedEvents(fixture.bucket, RUN_ID, [
      rawEvent("embedding_count", Number.MAX_VALUE, 1),
      rawEvent("embedding_count", Number.MAX_VALUE, 2),
    ]);

    await expect(recordRunUsageBatch(fixture.env, RUN_ID)).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("recordRunUsageBatch leaves every meter absent after an object GET failure, then retries", async () => {
  const fixture = await createFixture({
    tokenUsage: { inputTokens: 2000, outputTokens: 3000 },
  });
  try {
    const validEvents = [rawEvent("exec_seconds", 4, 1)];
    await putSegmentedEvents(fixture.bucket, RUN_ID, validEvents);

    const base = fixture.bucket;
    let failGet = true;
    fixture.env.TAKOS_OFFLOAD = {
      ...base,
      get: async (...args: Parameters<typeof base.get>) => {
        if (failGet) throw new Error("object store read failed");
        return base.get(...args);
      },
    } as unknown as ObjectStoreBinding;
    await expect(recordRunUsageBatch(fixture.env, RUN_ID)).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);

    failGet = false;
    await recordRunUsageBatch(fixture.env, RUN_ID);
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "exec_seconds", units: 4 },
      { meterType: "llm_tokens_input", units: 2 },
      { meterType: "llm_tokens_output", units: 3 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "exec_seconds", units: 4 },
      { meterType: "llm_tokens_input", units: 2 },
      { meterType: "llm_tokens_output", units: 3 },
    ]);
  } finally {
    await fixture.close();
  }
});

test("recordRunUsageBatch leaves every meter absent after gzip decode failure, then retries", async () => {
  const fixture = await createFixture({
    tokenUsage: { inputTokens: 2000, outputTokens: 3000 },
  });
  try {
    const validEvents = [rawEvent("exec_seconds", 4, 1)];
    await putSegmentedEvents(fixture.bucket, RUN_ID, validEvents);
    await fixture.bucket.put(usageSegmentKey(RUN_ID, 1), new Uint8Array([0, 1, 2]));

    await expect(recordRunUsageBatch(fixture.env, RUN_ID)).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);

    await putSegmentedEvents(fixture.bucket, RUN_ID, validEvents);
    await recordRunUsageBatch(fixture.env, RUN_ID);
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "exec_seconds", units: 4 },
      { meterType: "llm_tokens_input", units: 2 },
      { meterType: "llm_tokens_output", units: 3 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "exec_seconds", units: 4 },
      { meterType: "llm_tokens_input", units: 2 },
      { meterType: "llm_tokens_output", units: 3 },
    ]);
  } finally {
    await fixture.close();
  }
});

test("recordAppUsage applies idempotent duplicates once and records non-idempotent calls twice", async () => {
  const fixture = await createFixture();
  try {
    const idempotentInput = {
      ownerAccountId: ACCOUNT_ID,
      meterType: "embedding_count" as const,
      units: 3,
      idempotencyKey: "duplicate-usage-event",
    };
    expect((await recordAppUsage(fixture.db, idempotentInput)).applied).toBe(true);
    expect((await recordAppUsage(fixture.db, idempotentInput)).applied).toBe(false);

    const nonIdempotentInput = {
      ownerAccountId: ACCOUNT_ID,
      meterType: "vector_search_count" as const,
      units: 3,
    };
    expect((await recordAppUsage(fixture.db, nonIdempotentInput)).applied).toBe(true);
    expect((await recordAppUsage(fixture.db, nonIdempotentInput)).applied).toBe(true);

    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "embedding_count", units: 3 },
      { meterType: "vector_search_count", units: 3 },
      { meterType: "vector_search_count", units: 3 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "embedding_count", units: 3 },
      { meterType: "vector_search_count", units: 6 },
    ]);
  } finally {
    await fixture.close();
  }
});

test("recordAppUsage rejects a nonfinite rollup total without losing retryability", async () => {
  const fixture = await createFixture();
  try {
    const firstInput: AppUsageRecordInput = {
      ownerAccountId: ACCOUNT_ID,
      meterType: "embedding_count",
      units: Number.MAX_VALUE,
      idempotencyKey: "finite-maximum-usage",
    };
    expect((await recordAppUsage(fixture.db, firstInput)).applied).toBe(true);

    await expect(recordAppUsage(fixture.db, {
      ...firstInput,
      units: Number.MAX_VALUE,
      idempotencyKey: "overflowing-usage-total",
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(1);
    expect(await fixture.count("app_usage_rollups")).toBe(1);
    const afterOverflow = await fixture.meterUnits("app_usage_rollups");
    expect(afterOverflow).toHaveLength(1);
    expect(afterOverflow[0]?.units).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(afterOverflow[0]?.units)).toBe(true);

    expect((await recordAppUsage(fixture.db, firstInput)).applied).toBe(false);
    expect(await fixture.count("app_usage_events")).toBe(1);
    const afterDuplicate = await fixture.meterUnits("app_usage_rollups");
    expect(afterDuplicate).toHaveLength(1);
    expect(afterDuplicate[0]?.units).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(afterDuplicate[0]?.units)).toBe(true);
  } finally {
    await fixture.close();
  }
});

test("recordAppUsage returns committed no-key writes without a post-batch SELECT", async () => {
  const fixture = await createFixture();
  try {
    let committed = false;
    let preCommitSelectCalls = 0;
    let postCommitSelectCalls = 0;
    const db = new Proxy(fixture.db, {
      get(target, property) {
        if (property === "batch") {
          return async (...args: Parameters<typeof target.batch>) => {
            const result = await target.batch(...args);
            committed = true;
            return result;
          };
        }
        if (property === "select") {
          return (...args: unknown[]) => {
            if (committed) {
              postCommitSelectCalls += 1;
              throw new Error("post-commit select is forbidden");
            }
            preCommitSelectCalls += 1;
            return target.select(...args as Parameters<typeof target.select>);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const result = await recordAppUsage(db, {
      ownerAccountId: ACCOUNT_ID,
      meterType: "embedding_count",
      units: 13,
    });

    expect(result.success).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.eventId).not.toBe("");
    expect(preCommitSelectCalls).toBe(1);
    expect(postCommitSelectCalls).toBe(0);
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "embedding_count", units: 13 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "embedding_count", units: 13 },
    ]);
    expect(await fixture.count("app_usage_events")).toBe(1);
    expect(await fixture.count("app_usage_rollups")).toBe(1);
  } finally {
    await fixture.close();
  }
});

async function assertStatefulSqlRollbackAndRetry(wrapped: boolean): Promise<void> {
  const fixture = await createFixture({ fileBacked: true });
  try {
    const stateful = createStatefulSqlBinding(fixture.client);
    await fixture.client.execute(`
      CREATE TRIGGER reject_stateful_usage_rollup
      BEFORE INSERT ON app_usage_rollups
      BEGIN SELECT RAISE(ABORT, 'stateful rollup unavailable'); END;
    `);
    const database = wrapped ? getDb(stateful.binding) : stateful.binding;
    const input: AppUsageRecordInput = {
      ownerAccountId: ACCOUNT_ID,
      spaceId: "stateful-space",
      meterType: "embedding_count",
      units: 11,
      idempotencyKey: wrapped ? "wrapped-stateful-retry" : "raw-stateful-retry",
    };

    await expect(recordAppUsage(database, input)).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
    expect(stateful.counts()).toEqual({ transactionCalls: 1, outerBatchCalls: 0 });

    await fixture.client.execute("DROP TRIGGER reject_stateful_usage_rollup");
    expect((await recordAppUsage(database, input)).applied).toBe(true);
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "embedding_count", units: 11 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "embedding_count", units: 11 },
    ]);
    expect(stateful.counts()).toEqual({ transactionCalls: 2, outerBatchCalls: 0 });
  } finally {
    await fixture.close();
  }
}

test("raw stateful SQL bindings use the dedicated transaction session and roll back", async () => {
  await assertStatefulSqlRollbackAndRetry(false);
});

test("getDb-wrapped stateful SQL bindings retain the dedicated transaction session", async () => {
  await assertStatefulSqlRollbackAndRetry(true);
});

test("recordAppUsage captures its input before a suspended transaction callback", async () => {
  const fixture = await createFixture({ fileBacked: true });
  try {
    const stateful = createStatefulSqlBinding(fixture.client, {
      pauseBeforeCallback: true,
    });
    const input: AppUsageRecordInput = {
      ownerAccountId: "snapshot-owner",
      spaceId: "snapshot-space",
      meterType: "embedding_count",
      units: 7,
      metadata: { source: "before-transaction" },
      idempotencyKey: "snapshot-usage-input",
    };
    const pending = recordAppUsage(stateful.binding, input);
    await stateful.entered;

    input.ownerAccountId = "mutated-owner";
    input.spaceId = "mutated-space";
    input.units = 99;
    input.metadata!.source = "after-transaction-entry";
    stateful.releaseCallback();
    expect((await pending).applied).toBe(true);

    const eventRows = await fixture.client.execute(
      "SELECT * FROM app_usage_events WHERE idempotency_key = ?",
      ["snapshot-usage-input"],
    );
    const rollupRows = await fixture.client.execute(
      "SELECT * FROM app_usage_rollups WHERE owner_account_id = ?",
      ["snapshot-owner"],
    );
    expect(eventRows.rows).toHaveLength(1);
    expect(rollupRows.rows).toHaveLength(1);
    const event = eventRows.rows[0]!;
    const rollup = rollupRows.rows[0]!;
    expect(event.owner_account_id).toBe("snapshot-owner");
    expect(event.scope_type).toBe("space");
    expect(event.space_id).toBe("snapshot-space");
    expect(event.units).toBe(7);
    expect(JSON.parse(String(event.metadata))).toEqual({
      source: "before-transaction",
    });
    expect(rollup.scope_id).toBe("snapshot-space");
    expect(rollup.space_id).toBe("snapshot-space");
    expect(rollup.units).toBe(7);
    const createdAt = new Date(String(event.created_at));
    expect(rollup.period_start).toBe(
      `${createdAt.getUTCFullYear()}-${String(createdAt.getUTCMonth() + 1).padStart(2, "0")}-01`,
    );
    expect(stateful.counts()).toEqual({ transactionCalls: 1, outerBatchCalls: 0 });
  } finally {
    await fixture.close();
  }
});

test("concurrent stateful calls with the same idempotency key apply once", async () => {
  const fixture = await createFixture({ fileBacked: true });
  try {
    const stateful = createStatefulSqlBinding(fixture.client);
    const input: AppUsageRecordInput = {
      ownerAccountId: ACCOUNT_ID,
      meterType: "vector_search_count",
      units: 5,
      idempotencyKey: "concurrent-stateful-usage",
    };
    const results = await Promise.all([
      recordAppUsage(stateful.binding, input),
      recordAppUsage(stateful.binding, input),
    ]);

    expect(results.map((result) => result.applied).sort()).toEqual([false, true]);
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "vector_search_count", units: 5 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "vector_search_count", units: 5 },
    ]);
    expect(stateful.counts()).toEqual({ transactionCalls: 2, outerBatchCalls: 0 });
  } finally {
    await fixture.close();
  }
});

async function assertEdgeSqlUsageBatch(wrapped: boolean): Promise<void> {
  const fixture = await createFixture({ fileBacked: true });
  try {
    const host = createLibsqlEdgeBinding(fixture.client);
    const adapted = adaptEdgeSqlBinding(host.binding);
    const database = wrapped ? getDb(adapted) : adapted;
    const result = await recordAppUsage(database, {
      ownerAccountId: ACCOUNT_ID,
      meterType: "embedding_count",
      units: 13.25,
      idempotencyKey: wrapped ? "edge-wrapped-usage" : "edge-raw-usage",
    });

    expect(result.success).toBe(true);
    expect(result.applied).toBe(true);
    expect(result.eventId).not.toBe("");
    expect(host.transactions).toHaveLength(1);
    expect(host.transactions[0]).toHaveLength(2);
    for (const statement of host.transactions[0]!) {
      for (const parameter of statement.params ?? []) {
        if (typeof parameter === "number") {
          expect(Number.isFinite(parameter)).toBe(true);
          expect(Math.abs(parameter)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
        }
      }
    }
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "embedding_count", units: 13.25 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "embedding_count", units: 13.25 },
    ]);
    expect(await fixture.count("app_usage_events")).toBe(1);
    expect(await fixture.count("app_usage_rollups")).toBe(1);
  } finally {
    await fixture.close();
  }
}

test("raw adapted edge.sql writes usage through one real atomic transaction", async () => {
  await assertEdgeSqlUsageBatch(false);
});

test("getDb-wrapped edge.sql writes usage through one real atomic transaction", async () => {
  await assertEdgeSqlUsageBatch(true);
});

test("recordRunUsageBatch rejects a SQL rollup failure and a retry records the batch", async () => {
  const fixture = await createFixture({ tokenUsage: { inputTokens: 1000 } });
  try {
    await putSegmentedEvents(fixture.bucket, RUN_ID, [
      rawEvent("vector_search_count", 6, 1),
    ]);
    await fixture.client.execute(`
      CREATE TRIGGER reject_usage_rollup BEFORE INSERT ON app_usage_rollups
      BEGIN SELECT RAISE(ABORT, 'rollup unavailable'); END;
    `);

    await expect(recordRunUsageBatch(fixture.env, RUN_ID)).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);

    await fixture.client.execute("DROP TRIGGER reject_usage_rollup");
    await recordRunUsageBatch(fixture.env, RUN_ID);
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "llm_tokens_input", units: 1 },
      { meterType: "vector_search_count", units: 6 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "llm_tokens_input", units: 1 },
      { meterType: "vector_search_count", units: 6 },
    ]);
  } finally {
    await fixture.close();
  }
});

test("recordRunUsageBatch leaves all meters absent when a later meter rollup fails", async () => {
  const fixture = await createFixture({ tokenUsage: { inputTokens: 1000 } });
  try {
    await putSegmentedEvents(fixture.bucket, RUN_ID, [
      rawEvent("vector_search_count", 6, 1),
    ]);
    await fixture.client.execute(`
      CREATE TRIGGER reject_later_usage_rollup
      BEFORE INSERT ON app_usage_rollups
      WHEN NEW.meter_type = 'vector_search_count'
      BEGIN SELECT RAISE(ABORT, 'later rollup unavailable'); END;
    `);

    await expect(recordRunUsageBatch(fixture.env, RUN_ID)).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("recordRunUsageBatch rejects when the run does not exist", async () => {
  const fixture = await createFixture();
  try {
    await expect(recordRunUsageBatch(fixture.env, "missing-run")).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
  } finally {
    await fixture.close();
  }
});
