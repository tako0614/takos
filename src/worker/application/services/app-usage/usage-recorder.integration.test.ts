import { expect, test } from "bun:test";
import { createClient, type Client, type ResultSet } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { getDb } from "../../../infra/db/index.ts";
import * as schema from "../../../infra/db/schema.ts";
import {
  projectRunUsageSnapshot as projectRunUsageSnapshotWithAuthority,
  recordAppUsage,
  recordRunUsageBatch,
} from "./usage-recorder.ts";
import { adaptEdgeSqlBinding } from "../../../platform/adapters/edge-sql.ts";
import type { Env } from "../../../shared/types/index.ts";
import type {
  EdgeSqlBinding,
  EdgeSqlResult,
  EdgeSqlStatement,
  EdgeSqlValue,
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
  SqlTransactionSessionBinding,
} from "../../../shared/types/bindings.ts";
import type { AppUsageRecordInput } from "./usage-types.ts";

const ACCOUNT_ID = "usage-owner";
const RUN_ID = "usage-run";
const CREATED_AT = "2026-10-01T00:00:00.000Z";
const OWNER_PROVIDER_SUB = "https://owner.example#owner-subject";
const projectRunUsageSnapshot = (
  ...args: Parameters<typeof projectRunUsageSnapshotWithAuthority> extends
    [infer B, infer R, infer T, ...unknown[]] ? [B, R, T] : never
) => projectRunUsageSnapshotWithAuthority(...args, { providerSub: OWNER_PROVIDER_SUB });

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
  workspaceId?: string;
  ownerAccountId?: string | null;
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
      status TEXT NOT NULL DEFAULT 'running',
      completion_key TEXT,
      usage TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY NOT NULL,
      owner_account_id TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE auth_identities (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      provider TEXT NOT NULL, provider_sub TEXT NOT NULL
    );
    CREATE TABLE run_usage_projection_assertions (
      id TEXT PRIMARY KEY, valid INTEGER NOT NULL
    );
  `);
  const db = drizzle(client, { schema });
  const workspaceId = options.workspaceId ?? ACCOUNT_ID;
  await client.execute({
    sql: "INSERT INTO runs (id, account_id, usage) VALUES (?, ?, ?)",
    args: [RUN_ID, workspaceId, JSON.stringify(options.tokenUsage ?? {})],
  });
  await client.execute({
    sql: "INSERT INTO accounts (id, owner_account_id) VALUES (?, ?)",
    args: [workspaceId, options.ownerAccountId ?? null],
  });
  const principalId = options.ownerAccountId ?? workspaceId;
  if (principalId !== workspaceId) {
    await client.execute({
      sql: "INSERT INTO accounts (id, owner_account_id) VALUES (?, NULL)",
      args: [principalId],
    });
  }
  await client.execute({
    sql: "INSERT INTO auth_identities (id, user_id, provider, provider_sub) VALUES (?, ?, 'oidc', ?)",
    args: ["fixture-owner-identity", principalId, OWNER_PROVIDER_SUB],
  });

  const env = {
    DB: db,
  } as unknown as Env;

  return {
    client,
    db,
    env,
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

function namedColumns(row: unknown, columns: readonly string[]) {
  const values = Object.fromEntries(Object.entries(row as object));
  return Object.fromEntries(columns.map((column) => [column, values[column]]));
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

test("Run snapshots add SQL tokens and converge monotonically on fixed event keys", async () => {
  const fixture = await createFixture({
    tokenUsage: { inputTokens: 2000, outputTokens: 3000 },
  });
  try {
    await projectRunUsageSnapshot(fixture.db, RUN_ID, { embedding_count: 4 });
    const first = await fixture.client.execute(
      "SELECT id, created_at FROM app_usage_events WHERE idempotency_key = ?",
      [`run:${RUN_ID}:embedding_count`],
    );
    await projectRunUsageSnapshot(fixture.db, RUN_ID, { embedding_count: 9 });
    await projectRunUsageSnapshot(fixture.db, RUN_ID, { embedding_count: 2 });

    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "embedding_count", units: 9 },
      { meterType: "llm_tokens_input", units: 2 },
      { meterType: "llm_tokens_output", units: 3 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "embedding_count", units: 9 },
      { meterType: "llm_tokens_input", units: 2 },
      { meterType: "llm_tokens_output", units: 3 },
    ]);
    const after = await fixture.client.execute(
      "SELECT id, created_at FROM app_usage_events WHERE idempotency_key = ?",
      [`run:${RUN_ID}:embedding_count`],
    );
    expect(after.rows[0]?.id).toBe(first.rows[0]?.id);
    expect(after.rows[0]?.created_at).toBe(first.rows[0]?.created_at);
    expect(await fixture.count("app_usage_events")).toBe(3);
  } finally {
    await fixture.close();
  }
});

test("zero Run totals are accepted as a no-op", async () => {
  const fixture = await createFixture();
  try {
    await projectRunUsageSnapshot(fixture.db, RUN_ID, {
      llm_tokens_input: 0,
      llm_tokens_output: 0,
      embedding_count: 0,
      vector_search_count: 0,
      exec_seconds: 0,
      r2_storage_gb_month: 0,
      wfp_requests: 0,
      queue_messages: 0,
    });
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("Run projection uses the workspace owner and reconciles the matching generic usage scope", async () => {
  const workspaceId = "usage-child-workspace";
  const ownerAccountId = "usage-parent-owner";
  const fixture = await createFixture({ workspaceId, ownerAccountId });
  try {
    await recordAppUsage(fixture.db, {
      ownerAccountId,
      spaceId: workspaceId,
      meterType: "embedding_count",
      units: 2,
      idempotencyKey: "workspace-generic-contribution",
    });
    await projectRunUsageSnapshot(fixture.db, RUN_ID, {
      embedding_count: 3,
    });

    const rows = await fixture.client.execute(`
      SELECT owner_account_id, scope_type, space_id, meter_type, units,
        reference_id, reference_type
      FROM app_usage_events ORDER BY idempotency_key
    `);
    expect(rows.rows.map((row) => namedColumns(row, [
      "owner_account_id",
      "scope_type",
      "space_id",
      "meter_type",
      "units",
      "reference_id",
      "reference_type",
    ]))).toEqual([
      {
        owner_account_id: ownerAccountId,
        scope_type: "space",
        space_id: workspaceId,
        meter_type: "embedding_count",
        units: 3,
        reference_id: RUN_ID,
        reference_type: "run",
      },
      {
        owner_account_id: ownerAccountId,
        scope_type: "space",
        space_id: workspaceId,
        meter_type: "embedding_count",
        units: 2,
        reference_id: null,
        reference_type: null,
      },
    ]);
    const rollup = await fixture.client.execute(`
      SELECT owner_account_id, scope_type, scope_id, space_id, units
      FROM app_usage_rollups WHERE meter_type = 'embedding_count'
    `);
    expect(rollup.rows[0]).toMatchObject({
      owner_account_id: ownerAccountId,
      scope_type: "space",
      scope_id: workspaceId,
      space_id: workspaceId,
      units: 5,
    });
  } finally {
    await fixture.close();
  }
});

test("Run projection refuses a legacy fixed event owned by the workspace instead of its owner", async () => {
  const workspaceId = "usage-child-workspace";
  const ownerAccountId = "usage-parent-owner";
  const fixture = await createFixture({ workspaceId, ownerAccountId });
  try {
    await fixture.client.execute(`
      INSERT INTO app_usage_events
        (id, idempotency_key, owner_account_id, scope_type, space_id, meter_type,
         units, reference_id, reference_type, metadata, created_at)
      VALUES ('legacy-workspace-owner', 'run:${RUN_ID}:embedding_count',
        '${workspaceId}', 'space', '${workspaceId}', 'embedding_count', 8,
        '${RUN_ID}', 'run', '{"legacy":true}', '${CREATED_AT}');
    `);
    await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {
      embedding_count: 4,
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_rollups")).toBe(0);
    const row = await fixture.client.execute(`
      SELECT id, owner_account_id, units, metadata
      FROM app_usage_events WHERE idempotency_key = ?
    `, [`run:${RUN_ID}:embedding_count`]);
    expect(namedColumns(row.rows[0], [
      "id",
      "owner_account_id",
      "units",
      "metadata",
    ])).toEqual({
      id: "legacy-workspace-owner",
      owner_account_id: workspaceId,
      units: 8,
      metadata: '{"legacy":true}',
    });
  } finally {
    await fixture.close();
  }
});

test("Run projection aborts when the Run workspace row is missing", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.execute("DELETE FROM accounts WHERE id = ?", [ACCOUNT_ID]);
    await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {})).rejects.toThrow(
      "Run usage workspace is unavailable",
    );
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("Run token and accepted totals overflow is rejected before writing", async () => {
  const fixture = await createFixture({
    tokenUsage: { inputTokens: Number.MAX_VALUE },
  });
  try {
    await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {
      llm_tokens_input: Number.MAX_VALUE,
    })).rejects.toThrow("Invalid aggregated Run usage");
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("Run projection rejects malformed and nonobject token usage before writing", async () => {
  const fixture = await createFixture();
  try {
    for (const usage of ["{", "[]", "null"]) {
      await fixture.client.execute({
        sql: "UPDATE runs SET usage = ? WHERE id = ?",
        args: [usage, RUN_ID],
      });
      await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {
        embedding_count: 3,
      })).rejects.toThrow("Run usage JSON is invalid");
      expect(await fixture.count("app_usage_events")).toBe(0);
      expect(await fixture.count("app_usage_rollups")).toBe(0);
    }
  } finally {
    await fixture.close();
  }
});

test("Run projection repairs a partial event and rollup from every canonical event in its month", async () => {
  const fixture = await createFixture();
  try {
    const period = "2026-09-01";
    await fixture.client.execute(`
      INSERT INTO app_usage_events
        (id, idempotency_key, owner_account_id, scope_type, space_id, meter_type,
         units, reference_id, reference_type, metadata, created_at)
      VALUES ('partial', 'run:${RUN_ID}:embedding_count', '${ACCOUNT_ID}', 'space',
        '${ACCOUNT_ID}', 'embedding_count', 5, '${RUN_ID}', 'run', '{}',
        '2026-09-12T00:00:00.000Z'),
        ('ordinary', NULL, '${ACCOUNT_ID}', 'space', '${ACCOUNT_ID}',
         'embedding_count', 2, NULL, NULL, '{}', '2026-09-18T00:00:00.000Z');
      INSERT INTO app_usage_rollups
        (id, owner_account_id, scope_type, scope_id, space_id, meter_type,
         period_start, units, updated_at)
      VALUES ('partial-rollup', '${ACCOUNT_ID}', 'space', '${ACCOUNT_ID}',
        '${ACCOUNT_ID}', 'embedding_count', '${period}', 99, '2026-09-30T00:00:00Z');
    `);

    await projectRunUsageSnapshot(fixture.db, RUN_ID, { embedding_count: 3 });
    const event = await fixture.client.execute(
      "SELECT id, units, created_at FROM app_usage_events WHERE idempotency_key = ?",
      [`run:${RUN_ID}:embedding_count`],
    );
    const rollup = await fixture.client.execute(
      "SELECT id, period_start, units FROM app_usage_rollups WHERE meter_type = 'embedding_count'",
    );
    expect(event.rows[0]).toMatchObject({
      id: "partial",
      units: 5,
      created_at: "2026-09-12T00:00:00.000Z",
    });
    expect(rollup.rows).toHaveLength(1);
    expect(rollup.rows[0]?.period_start).toBe("2026-09-01");
    expect(rollup.rows[0]?.units).toBe(7);
  } finally {
    await fixture.close();
  }
});

test("Run projection aborts foreign fixed-key identity without changing any meter", async () => {
  const fixture = await createFixture({ tokenUsage: { inputTokens: 1000 } });
  try {
    await fixture.client.execute(`
      INSERT INTO app_usage_events
        (id, idempotency_key, owner_account_id, scope_type, space_id, meter_type,
         units, reference_id, reference_type, metadata, created_at)
      VALUES ('foreign', 'run:${RUN_ID}:embedding_count', 'other-owner', 'space',
        'other-owner', 'embedding_count', 20, '${RUN_ID}', 'run', '{}',
        '${CREATED_AT}');
    `);
    await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {
      embedding_count: 3,
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(1);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
    const foreign = await fixture.client.execute(
      "SELECT owner_account_id, units FROM app_usage_events WHERE id = 'foreign'",
    );
    expect(namedColumns(foreign.rows[0], ["owner_account_id", "units"])).toEqual({
      owner_account_id: "other-owner",
      units: 20,
    });
  } finally {
    await fixture.close();
  }
});

test("Run projection aborts a conflicting rollup space identity without rewriting it", async () => {
  const fixture = await createFixture();
  try {
    const periodStart = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;
    await fixture.client.execute({
      sql: `INSERT INTO app_usage_rollups
        (id, owner_account_id, scope_type, scope_id, space_id, meter_type,
         period_start, units, updated_at)
        VALUES (?, ?, 'space', ?, 'foreign-space', 'vector_search_count', ?, 12, ?)`,
      args: ["wrong-space-rollup", ACCOUNT_ID, ACCOUNT_ID, periodStart, CREATED_AT],
    });
    await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {
      embedding_count: 3,
      vector_search_count: 4,
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(1);
    const row = await fixture.client.execute(
      "SELECT id, space_id, meter_type, units FROM app_usage_rollups",
    );
    expect(namedColumns(row.rows[0], ["id", "space_id", "meter_type", "units"]))
      .toEqual({
      id: "wrong-space-rollup",
      space_id: "foreign-space",
      meter_type: "vector_search_count",
      units: 12,
    });
  } finally {
    await fixture.close();
  }
});

test("Run projection failure is atomic across meters and can be retried", async () => {
  const fixture = await createFixture({ tokenUsage: { inputTokens: 1000 } });
  try {
    await fixture.client.execute(`
      CREATE TRIGGER reject_later_usage_rollup
      BEFORE UPDATE ON app_usage_rollups
      WHEN NEW.meter_type = 'vector_search_count'
      BEGIN SELECT RAISE(ABORT, 'later rollup unavailable'); END;
    `);
    await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {
      vector_search_count: 6,
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);

    await fixture.client.execute("DROP TRIGGER reject_later_usage_rollup");
    await projectRunUsageSnapshot(fixture.db, RUN_ID, {
      vector_search_count: 6,
    });
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "llm_tokens_input", units: 1 },
      { meterType: "vector_search_count", units: 6 },
    ]);
  } finally {
    await fixture.close();
  }
});

test("recordRunUsageBatch delegates to the notifier and rejects failed RPC results", async () => {
  const fixture = await createFixture();
  try {
    const requests: Request[] = [];
    let status = 200;
    let body = { success: true };
    fixture.env.RUN_NOTIFIER = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (request: Request) => {
          requests.push(request);
          return Response.json(body, { status });
        },
      }),
    } as unknown as Env["RUN_NOTIFIER"];
    await recordRunUsageBatch(fixture.env, RUN_ID);
    expect(requests[0]?.url).toBe(
      `http://internal/usage-project?runId=${RUN_ID}`,
    );
    status = 503;
    await expect(recordRunUsageBatch(fixture.env, RUN_ID)).rejects.toThrow();
    status = 200;
    body = { success: false };
    await expect(recordRunUsageBatch(fixture.env, RUN_ID)).rejects.toThrow();
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

test("concurrent generic events preserve both contributions to one rollup", async () => {
  const fixture = await createFixture({ fileBacked: true });
  try {
    const stateful = createStatefulSqlBinding(fixture.client);
    const results = await Promise.all([
      recordAppUsage(stateful.binding, {
        ownerAccountId: ACCOUNT_ID,
        meterType: "vector_search_count",
        units: 5,
        idempotencyKey: "concurrent-contribution-a",
      }),
      recordAppUsage(stateful.binding, {
        ownerAccountId: ACCOUNT_ID,
        meterType: "vector_search_count",
        units: 7,
        idempotencyKey: "concurrent-contribution-b",
      }),
    ]);

    expect(results.every((result) => result.applied)).toBe(true);
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "vector_search_count", units: 5 },
      { meterType: "vector_search_count", units: 7 },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "vector_search_count", units: 12 },
    ]);
  } finally {
    await fixture.close();
  }
});

test("concurrent generic and Run projection keep canonical events and rollups equal", async () => {
  for (const existingRollup of [false, true]) {
    const fixture = await createFixture({ fileBacked: true });
    try {
      const stateful = createStatefulSqlBinding(fixture.client);
      if (existingRollup) {
        await recordAppUsage(stateful.binding, {
          ownerAccountId: ACCOUNT_ID,
          spaceId: ACCOUNT_ID,
          meterType: "embedding_count",
          units: 1,
          idempotencyKey: "preexisting-concurrent-usage",
        });
      }
      await Promise.all([
        recordAppUsage(stateful.binding, {
          ownerAccountId: ACCOUNT_ID,
          spaceId: ACCOUNT_ID,
          meterType: "embedding_count",
          units: 2,
          idempotencyKey: `concurrent-generic-${existingRollup}`,
        }),
        projectRunUsageSnapshot(stateful.binding, RUN_ID, {
          embedding_count: 6,
        }),
      ]);

      const expected = existingRollup ? 9 : 8;
      const events = await fixture.client.execute(
        `SELECT SUM(units) AS units FROM app_usage_events
         WHERE owner_account_id = ? AND scope_type = 'space' AND space_id = ?
           AND meter_type = 'embedding_count'`,
        [ACCOUNT_ID, ACCOUNT_ID],
      );
      const rollup = await fixture.client.execute(
        `SELECT units FROM app_usage_rollups WHERE owner_account_id = ?
          AND scope_type = 'space' AND scope_id = ? AND meter_type = 'embedding_count'`,
        [ACCOUNT_ID, ACCOUNT_ID],
      );
      expect(Number(events.rows[0]?.units)).toBe(expected);
      expect(Number(rollup.rows[0]?.units)).toBe(expected);
    } finally {
      await fixture.close();
    }
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
    expect(host.transactions[0]).toHaveLength(3);
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

async function assertEdgeSqlRunProjection(wrapped: boolean): Promise<void> {
  const fixture = await createFixture({ fileBacked: true });
  try {
    const host = createLibsqlEdgeBinding(fixture.client);
    const adapted = adaptEdgeSqlBinding(host.binding);
    const database = wrapped ? getDb(adapted) : adapted;
    await projectRunUsageSnapshot(database, RUN_ID, { embedding_count: 4 });
    const first = await fixture.client.execute(
      "SELECT id, created_at FROM app_usage_events WHERE idempotency_key = ?",
      [`run:${RUN_ID}:embedding_count`],
    );
    await projectRunUsageSnapshot(database, RUN_ID, { embedding_count: 9 });
    await projectRunUsageSnapshot(database, RUN_ID, { embedding_count: 2 });
    const largeUnits = 2 ** 53 + 2;
    await projectRunUsageSnapshot(database, RUN_ID, { queue_messages: largeUnits });

    expect(host.transactions).toHaveLength(4);
    for (const statements of host.transactions) {
      expect(statements.length).toBeLessThanOrEqual(100);
      for (const statement of statements) {
        for (const parameter of statement.params ?? []) {
          if (typeof parameter === "number") {
            expect(Number.isFinite(parameter)).toBe(true);
            expect(Math.abs(parameter)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
          }
        }
      }
    }
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "embedding_count", units: 9 },
      { meterType: "queue_messages", units: largeUnits },
    ]);
    expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
      { meterType: "embedding_count", units: 9 },
      { meterType: "queue_messages", units: largeUnits },
    ]);
    const after = await fixture.client.execute(
      "SELECT id, created_at FROM app_usage_events WHERE idempotency_key = ?",
      [`run:${RUN_ID}:embedding_count`],
    );
    expect(after.rows[0]?.id).toBe(first.rows[0]?.id);
    expect(after.rows[0]?.created_at).toBe(first.rows[0]?.created_at);
  } finally {
    await fixture.close();
  }
}

test("raw edge.sql projects cumulative Run snapshots in bounded atomic batches", async () => {
  await assertEdgeSqlRunProjection(false);
});

test("raw and wrapped edge.sql preserve large finite generic units", async () => {
  const largeUnits = 2 ** 53 + 2;
  for (const wrapped of [false, true]) {
    const fixture = await createFixture({ fileBacked: true });
    try {
      const host = createLibsqlEdgeBinding(fixture.client);
      const adapted = adaptEdgeSqlBinding(host.binding);
      await recordAppUsage(wrapped ? getDb(adapted) : adapted, {
        ownerAccountId: ACCOUNT_ID,
        meterType: "queue_messages",
        units: largeUnits,
      });
      expect(await fixture.meterUnits("app_usage_events")).toEqual([
        { meterType: "queue_messages", units: largeUnits },
      ]);
      expect(await fixture.meterUnits("app_usage_rollups")).toEqual([
        { meterType: "queue_messages", units: largeUnits },
      ]);
      expect(host.transactions).toHaveLength(1);
      expect(host.transactions[0]?.flatMap((statement) => statement.params ?? [])
        .some((parameter) => parameter === largeUnits)).toBe(false);
    } finally {
      await fixture.close();
    }
  }
});

test("generic rollup refuses an existing space-id identity collision", async () => {
  const fixture = await createFixture();
  try {
    const periodStart = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;
    await fixture.client.execute({
      sql: `INSERT INTO app_usage_rollups
        (id, owner_account_id, scope_type, scope_id, space_id, meter_type,
         period_start, units, updated_at)
        VALUES (?, ?, 'space', ?, 'foreign-space', 'embedding_count', ?, 12, ?)`,
      args: ["wrong-space-rollup", ACCOUNT_ID, ACCOUNT_ID, periodStart, CREATED_AT],
    });

    await expect(recordAppUsage(fixture.db, {
      ownerAccountId: ACCOUNT_ID,
      spaceId: ACCOUNT_ID,
      meterType: "embedding_count",
      units: 3,
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    const row = await fixture.client.execute(
      "SELECT id, space_id, units FROM app_usage_rollups",
    );
    expect(namedColumns(row.rows[0], ["id", "space_id", "units"])).toEqual({
      id: "wrong-space-rollup",
      space_id: "foreign-space",
      units: 12,
    });
  } finally {
    await fixture.close();
  }
});

test("generic contribution absorbed by a large existing rollup aborts without persisting its event", async () => {
  const fixture = await createFixture();
  try {
    const periodStart = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;
    const largeUnits = 2 ** 53;
    await fixture.client.execute({
      sql: `INSERT INTO app_usage_rollups
        (id, owner_account_id, scope_type, scope_id, space_id, meter_type,
         period_start, units, updated_at)
        VALUES (?, ?, 'account', ?, NULL, 'embedding_count', ?, ?, ?)`,
      args: ["large-rollup", ACCOUNT_ID, ACCOUNT_ID, periodStart, largeUnits, CREATED_AT],
    });
    await expect(recordAppUsage(fixture.db, {
      ownerAccountId: ACCOUNT_ID,
      meterType: "embedding_count",
      units: 1,
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    const row = await fixture.client.execute("SELECT units FROM app_usage_rollups");
    expect(row.rows[0]?.units).toBe(largeUnits);
  } finally {
    await fixture.close();
  }
});

test("Run SQL token and supplied total addition rejects absorbed positive units", async () => {
  const fixture = await createFixture({ tokenUsage: { inputTokens: 1000 } });
  try {
    await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {
      llm_tokens_input: 2 ** 53,
    })).rejects.toThrow("Invalid aggregated Run usage");
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("wrapped edge.sql projects cumulative Run snapshots in bounded atomic batches", async () => {
  await assertEdgeSqlRunProjection(true);
});

test("Run projection rejects an unseen key that appears in a different month after prefetch", async () => {
  const fixture = await createFixture({ fileBacked: true });
  try {
    const stateful = createStatefulSqlBinding(fixture.client);
    const transaction = stateful.binding.withTransaction!;
    let injectStaleWriter = true;
    const binding: SqlDatabaseBinding = {
      ...stateful.binding,
      async withTransaction(callback) {
        if (injectStaleWriter) {
          injectStaleWriter = false;
          await fixture.client.execute(`
            INSERT INTO app_usage_events
              (id, idempotency_key, owner_account_id, scope_type, space_id,
               meter_type, units, reference_id, reference_type, metadata, created_at)
            VALUES ('september-writer', 'run:${RUN_ID}:embedding_count',
              '${ACCOUNT_ID}', 'space', '${ACCOUNT_ID}', 'embedding_count', 8,
              '${RUN_ID}', 'run', '{}', '2026-09-30T23:59:59.000Z');
          `);
        }
        return transaction(callback);
      },
    };
    await expect(projectRunUsageSnapshot(binding, RUN_ID, {
      embedding_count: 4,
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(1);
    expect(await fixture.count("app_usage_rollups")).toBe(0);

    await projectRunUsageSnapshot(binding, RUN_ID, {
      embedding_count: 4,
    });
    const event = await fixture.client.execute(
      "SELECT id, units, created_at FROM app_usage_events WHERE idempotency_key = ?",
      [`run:${RUN_ID}:embedding_count`],
    );
    const rollup = await fixture.client.execute(
      "SELECT period_start, units FROM app_usage_rollups WHERE meter_type = 'embedding_count'",
    );
    expect(event.rows[0]).toMatchObject({
      id: "september-writer",
      units: 8,
      created_at: "2026-09-30T23:59:59.000Z",
    });
    expect(rollup.rows).toHaveLength(1);
    expect(rollup.rows[0]?.period_start).toBe("2026-09-01");
    expect(rollup.rows[0]?.units).toBe(8);
  } finally {
    await fixture.close();
  }
});

test("Run projection rolls back every meter on SQL rollup failure, then retries", async () => {
  const fixture = await createFixture({ tokenUsage: { inputTokens: 1000 } });
  try {
    await fixture.client.execute(`
      CREATE TRIGGER reject_usage_rollup BEFORE UPDATE ON app_usage_rollups
      BEGIN SELECT RAISE(ABORT, 'rollup unavailable'); END;
    `);

    await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {
      vector_search_count: 6,
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);

    await fixture.client.execute("DROP TRIGGER reject_usage_rollup");
    await projectRunUsageSnapshot(fixture.db, RUN_ID, {
      vector_search_count: 6,
    });
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

test("Run projection leaves all meters absent when a later meter insert fails", async () => {
  const fixture = await createFixture({ tokenUsage: { inputTokens: 1000 } });
  try {
    await fixture.client.execute(`
      CREATE TRIGGER reject_later_usage_rollup
      BEFORE INSERT ON app_usage_rollups
      WHEN NEW.meter_type = 'vector_search_count'
      BEGIN SELECT RAISE(ABORT, 'later rollup unavailable'); END;
    `);

    await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {
      vector_search_count: 6,
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("Run projection rejects when the run does not exist", async () => {
  const fixture = await createFixture();
  try {
    await expect(projectRunUsageSnapshot(fixture.db, "missing-run", {})).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);
  } finally {
    await fixture.close();
  }
});

test("atomic meter group fences a terminal CAS and recorded owner even with zero meters", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.executeMultiple(`
      CREATE TABLE run_usage_projection_outbox (
        id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE,
        completion_key TEXT NOT NULL, run_status TEXT NOT NULL,
        workspace_id TEXT NOT NULL, owner_account_id TEXT NOT NULL,
        delivery_status TEXT NOT NULL DEFAULT 'queued',
        claim_token TEXT, claimed_at TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT, last_error TEXT, projected_revision INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    // The active Run becomes terminal after the prefetch but before the
    // transactional assertion. It cannot project under active-run rules.
    let race = async () => {
      await fixture.client.execute({
        sql: "UPDATE runs SET status = 'completed', completion_key = 'terminal-key' WHERE id = ?",
        args: [RUN_ID],
      });
    };
    const racingDb = new Proxy(fixture.db, {
      get(target, key, receiver) {
        if (key === "batch") return async (statements: Parameters<typeof target.batch>[0]) => {
          await race();
          return target.batch(statements);
        };
        return Reflect.get(target, key, receiver);
      },
    });
    await expect(projectRunUsageSnapshot(racingDb, RUN_ID, {
      embedding_count: 2,
    })).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    expect(await fixture.count("app_usage_rollups")).toBe(0);

    await expect(projectRunUsageSnapshot(fixture.db, RUN_ID, {})).rejects.toThrow(
      "Terminal Run usage authority witness is unavailable",
    );
    await fixture.client.execute({
      sql: `INSERT INTO run_usage_projection_outbox
        (id, run_id, completion_key, run_status, workspace_id, owner_account_id,
         created_at, updated_at) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)`,
      args: ["run-usage-projection:terminal-key", RUN_ID, "terminal-key",
        ACCOUNT_ID, ACCOUNT_ID, CREATED_AT, CREATED_AT],
    });
    // Zero-meter projections still validate the owner in the SQL group.
    race = async () => {
      await fixture.client.execute({
        sql: "UPDATE accounts SET owner_account_id = 'former-owner' WHERE id = ?",
        args: [ACCOUNT_ID],
      });
    };
    await expect(projectRunUsageSnapshot(racingDb, RUN_ID, {})).rejects.toThrow();
    expect(await fixture.count("app_usage_events")).toBe(0);
    await fixture.client.execute({
      sql: "UPDATE accounts SET owner_account_id = NULL WHERE id = ?",
      args: [ACCOUNT_ID],
    });
    await fixture.client.execute({
      sql: "UPDATE runs SET usage = ? WHERE id = ?",
      args: [JSON.stringify({ inputTokens: 1000 }), RUN_ID],
    });
    await projectRunUsageSnapshot(fixture.db, RUN_ID, {});
    expect(await fixture.meterUnits("app_usage_events")).toEqual([
      { meterType: "llm_tokens_input", units: 1 },
    ]);
    const assertionRows = await fixture.client.execute(
      "SELECT COUNT(*) AS count FROM run_usage_projection_assertions",
    );
    expect(Number(assertionRows.rows[0]?.count)).toBe(0);
  } finally {
    await fixture.close();
  }
});
