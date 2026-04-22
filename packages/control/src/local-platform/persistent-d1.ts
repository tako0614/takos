/**
 * Persistent local implementations of the Cloudflare D1 (SQLite-compatible edge database) interface.
 *
 * Provides two adapters for local/server use where a real D1 binding is
 * unavailable:
 *   - `createSqliteD1Database`   -- backed by a local SQLite file via libSQL
 *   - `createPostgresD1Database` -- backed by a PostgreSQL connection pool
 *
 * Both expose the same D1-compatible API (prepare / batch / exec / withSession)
 * so that the rest of the codebase can treat them identically to Cloudflare D1.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool, type PoolClient, type QueryResult } from "pg";
import type { D1PreparedStatement } from "../shared/types/bindings.ts";
import type {
  Client as LibsqlClient,
  createClient as createLibsqlClient,
  ResultSet,
  Row as LibsqlRow,
  Value as LibsqlValue,
} from "@libsql/client";
import {
  classifyTransactionSql,
  isExactTransactionControlSql,
  normalizePostgresSql,
  type ServerD1Database,
} from "./d1-shared.ts";
import { logWarn } from "../shared/utils/logger.ts";
import { UnsupportedOperationError } from "../shared/utils/unsupported-operation.ts";
import {
  ensurePostgresAccountsTableShape,
  ensurePostgresDeploymentsTableShape,
  ensurePostgresResourcesTableShape,
  ensurePostgresRunsTableShape,
  ensurePostgresServicesTableShape,
  ensureServerMigrations,
  ensureServerPostgresMigrations,
  ensureSqliteAccountsTableShape,
  ensureSqliteDeploymentsTableShape,
  ensureSqliteResourcesTableShape,
  ensureSqliteServicesTableShape,
} from "./d1-migrations.ts";
import {
  createPostgresPreparedStatement,
  createPreparedStatement,
  createSequentialBatch,
} from "./d1-prepared-statement.ts";
import { ensureParentDirectory } from "./persistent-shared.ts";

export { splitSqlStatements } from "./d1-sql-rewrite.ts";
export type { ServerD1Database } from "./d1-shared.ts";

async function loadLibsqlCreateClient(): Promise<typeof createLibsqlClient> {
  const libsql = await import("@libsql/client");
  return libsql.createClient;
}

type SqliteLikeClient = {
  execute(
    statementOrSql: string | { sql: string; args?: unknown[] },
  ): Promise<ResultSet>;
  transaction(mode?: string): Promise<{
    execute(
      statementOrSql: string | { sql: string; args?: unknown[] },
    ): Promise<ResultSet>;
    executeMultiple(sql: string): Promise<void>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    close(): void;
  }>;
  executeMultiple(sql: string): Promise<void>;
  close(): void;
};

type NodeSqliteArg = string | number | bigint | Uint8Array | null;

function normalizeSqliteValue(value: unknown): LibsqlValue {
  if (value === null) return null;
  if (value instanceof Uint8Array) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (
    typeof value === "string" || typeof value === "number" ||
    typeof value === "bigint" || value instanceof ArrayBuffer
  ) {
    return value;
  }
  return String(value);
}

function toHybridSqliteRow(
  columns: string[],
  row: unknown[],
): LibsqlRow {
  const values = row.map((value) => normalizeSqliteValue(value));
  const namedEntries: Array<[string, LibsqlValue]> = columns.map((
    column,
    index,
  ) => [column, values[index]]);
  return Object.assign([...values], Object.fromEntries(namedEntries));
}

function toNodeSqliteResultSet(
  columns: string[],
  rows: unknown[][],
  rowsAffected = 0,
  lastInsertRowid: number | bigint | undefined = undefined,
): ResultSet {
  const result: ResultSet = {
    columns,
    columnTypes: columns.map(() => ""),
    rows: rows.map((row) => toHybridSqliteRow(columns, row)),
    rowsAffected,
    lastInsertRowid: typeof lastInsertRowid === "number"
      ? BigInt(lastInsertRowid)
      : lastInsertRowid,
    toJSON() {
      return {
        columns,
        columnTypes: columns.map(() => ""),
        rows: rows.map((row) => toHybridSqliteRow(columns, row)),
        rowsAffected,
        lastInsertRowid: typeof lastInsertRowid === "number"
          ? BigInt(lastInsertRowid).toString()
          : lastInsertRowid?.toString(),
      };
    },
  };
  return result;
}

function normalizeNodeSqliteArg(value: unknown): NodeSqliteArg {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" || typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return JSON.stringify(value);
}

async function createNodeSqliteClient(
  dbPath: string,
): Promise<SqliteLikeClient> {
  const sqlite = await import("node:sqlite");
  const db = new sqlite.DatabaseSync(dbPath);

  const execute = async (
    statementOrSql: string | { sql: string; args?: unknown[] },
  ): Promise<ResultSet> => {
    const statement = typeof statementOrSql === "string"
      ? { sql: statementOrSql, args: [] as unknown[] }
      : { sql: statementOrSql.sql, args: statementOrSql.args ?? [] };
    const args = statement.args.map((value) => normalizeNodeSqliteArg(value));
    const prepared = db.prepare(statement.sql);
    const columns = prepared.columns().map((column: { name: string }) =>
      column.name
    );

    if (columns.length > 0) {
      prepared.setReturnArrays(true);
      const rawRows = prepared.all(...args);
      const rows = rawRows.map((row) =>
        Array.isArray(row) ? row : columns.map((column) => row[column])
      );
      return toNodeSqliteResultSet(columns, rows, 0);
    }

    const result = prepared.run(...args) as {
      changes?: number;
      lastInsertRowid?: number | bigint;
    };
    return toNodeSqliteResultSet(
      [],
      [],
      result.changes ?? 0,
      result.lastInsertRowid,
    );
  };

  return {
    execute,
    async transaction(
      _mode?: "write" | "read" | "deferred" | "immediate" | "exclusive",
    ) {
      db.exec("BEGIN");
      let finished = false;

      return {
        execute,
        async executeMultiple(sql: string) {
          db.exec(sql);
        },
        async commit() {
          if (finished) return;
          db.exec("COMMIT");
          finished = true;
        },
        async rollback() {
          if (finished) return;
          db.exec("ROLLBACK");
          finished = true;
        },
        close() {
          return;
        },
      };
    },
    async executeMultiple(sql: string) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}

export async function createSqliteD1Database(
  dbPath: string,
  migrationsDir: string,
): Promise<ServerD1Database> {
  await ensureParentDirectory(dbPath);
  let client: SqliteLikeClient;
  try {
    const createClient = await loadLibsqlCreateClient();
    client = createClient({
      url: pathToFileURL(dbPath).href,
    }) as SqliteLikeClient;
  } catch (error) {
    logWarn("Falling back to node:sqlite local D1 adapter", {
      module: "persistent-d1",
      dbPath,
      error: error instanceof Error ? error.message : String(error),
    });
    client = await createNodeSqliteClient(dbPath);
  }
  const libsqlClient = client as LibsqlClient;
  await ensureServerMigrations(libsqlClient, migrationsDir);
  await ensureSqliteServicesTableShape(libsqlClient);
  await ensureSqliteAccountsTableShape(libsqlClient);
  await ensureSqliteDeploymentsTableShape(libsqlClient);
  await ensureSqliteResourcesTableShape(libsqlClient);

  const runStatement = <T = Record<string, unknown>>(
    statement: D1PreparedStatement,
  ) => statement.run<T>();
  const session = {
    prepare(query: string) {
      return createPreparedStatement(libsqlClient, query);
    },
    batch: createSequentialBatch(runStatement),
    getBookmark() {
      return null;
    },
  };

  const db: ServerD1Database = {
    prepare(query: string) {
      return createPreparedStatement(libsqlClient, query);
    },
    batch: createSequentialBatch(runStatement),
    async exec(query: string) {
      const startedAt = Date.now();
      await client.executeMultiple(query);
      return { count: 0, duration: Date.now() - startedAt };
    },
    withSession() {
      return session;
    },
    async dump() {
      const bytes = await readFile(dbPath);
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    },
    close() {
      client.close();
    },
  };

  return db;
}

export async function createPostgresD1Database(
  connectionString: string,
  migrationsDirOverride?: string,
): Promise<ServerD1Database> {
  const pool = new Pool({ connectionString });
  const migrationsDir = migrationsDirOverride ?? path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "apps",
    "control",
    "db",
    "migrations",
  );
  await ensureServerPostgresMigrations(pool, migrationsDir);
  await ensurePostgresServicesTableShape(pool);
  await ensurePostgresAccountsTableShape(pool);
  await ensurePostgresDeploymentsTableShape(pool);
  await ensurePostgresResourcesTableShape(pool);
  await ensurePostgresRunsTableShape(pool);
  let transactionClient: PoolClient | null = null;

  async function getTransactionClient(): Promise<PoolClient> {
    if (transactionClient) return transactionClient;
    const client = await pool.connect();
    transactionClient = client;
    return client;
  }

  async function releaseTransactionClient(): Promise<void> {
    const client = transactionClient;
    transactionClient = null;
    client?.release();
  }

  async function runQuery(
    queryText: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Record<string, unknown>>> {
    const normalized = normalizePostgresSql(queryText);
    const transactionKind = isExactTransactionControlSql(normalized)
      ? classifyTransactionSql(normalized)
      : null;

    if (transactionKind === "begin") {
      const client = await getTransactionClient();
      try {
        return await client.query(normalized, values);
      } catch (error) {
        await releaseTransactionClient();
        throw error;
      }
    }

    if (transactionClient) {
      const client = transactionClient;
      try {
        const result = await client.query(normalized, values);
        if (transactionKind === "commit" || transactionKind === "rollback") {
          await releaseTransactionClient();
        }
        return result;
      } catch (error) {
        if (transactionKind === "commit") {
          await client.query("ROLLBACK").catch((e: unknown) => {
            logWarn("ROLLBACK failed after transaction error (non-critical)", {
              module: "persistent-d1",
              error: e instanceof Error ? e.message : String(e),
            });
          });
        }
        await releaseTransactionClient();
        throw error;
      }
    }

    return pool.query(normalized, values);
  }

  const runStatement = <T = Record<string, unknown>>(
    statement: D1PreparedStatement,
  ) => statement.run<T>();
  const session = {
    prepare(query: string) {
      return createPostgresPreparedStatement({ query: runQuery }, query);
    },
    batch: createSequentialBatch(runStatement),
    getBookmark() {
      return null;
    },
  };

  const db: ServerD1Database = {
    prepare(query: string) {
      return createPostgresPreparedStatement({ query: runQuery }, query);
    },
    batch: createSequentialBatch(runStatement),
    async exec(query: string) {
      const startedAt = Date.now();
      await runQuery(query);
      return { count: 0, duration: Date.now() - startedAt };
    },
    withSession() {
      return session;
    },
    async dump() {
      throw new UnsupportedOperationError(
        "dump",
        "DB.dump() is not implemented for the local Postgres adapter",
      );
    },
    close() {
      void pool.end();
    },
  };

  return db;
}

export async function createSchemaScopedPostgresD1Database(
  connectionString: string,
  schemaName: string,
): Promise<ServerD1Database> {
  const pool = new Pool({ connectionString });
  const quotedSchema = `"${schemaName.replace(/"/g, '""')}"`;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
  let transactionClient: PoolClient | null = null;

  async function getTransactionClient(): Promise<PoolClient> {
    if (transactionClient) return transactionClient;
    const client = await pool.connect();
    transactionClient = client;
    try {
      await client.query(`SET search_path TO ${quotedSchema}, public`);
      return client;
    } catch (error) {
      transactionClient = null;
      client.release();
      throw error;
    }
  }

  async function releaseTransactionClient(): Promise<void> {
    const client = transactionClient;
    transactionClient = null;
    client?.release();
  }

  async function withScopedClient<T>(
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${quotedSchema}, public`);
      return await run(client);
    } finally {
      client.release();
    }
  }

  async function runQuery(
    queryText: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Record<string, unknown>>> {
    const normalized = normalizePostgresSql(queryText);
    const transactionKind = isExactTransactionControlSql(normalized)
      ? classifyTransactionSql(normalized)
      : null;

    if (transactionKind === "begin") {
      const client = await getTransactionClient();
      try {
        return await client.query(normalized, values);
      } catch (error) {
        await releaseTransactionClient();
        throw error;
      }
    }

    if (transactionClient) {
      const client = transactionClient;
      try {
        const result = await client.query(normalized, values);
        if (transactionKind === "commit" || transactionKind === "rollback") {
          await releaseTransactionClient();
        }
        return result;
      } catch (error) {
        if (transactionKind === "commit") {
          await client.query("ROLLBACK").catch((e: unknown) => {
            logWarn(
              "ROLLBACK failed after schema-scoped transaction error (non-critical)",
              {
                module: "persistent-d1",
                error: e instanceof Error ? e.message : String(e),
              },
            );
          });
        }
        await releaseTransactionClient();
        throw error;
      }
    }

    return withScopedClient((client) => client.query(normalized, values));
  }

  const runStatement = <T = Record<string, unknown>>(
    statement: D1PreparedStatement,
  ) => statement.run<T>();
  const session = {
    prepare(query: string) {
      return createPostgresPreparedStatement(
        { query: runQuery },
        query,
        [],
        `portable-postgres:${schemaName}`,
      );
    },
    batch: createSequentialBatch(runStatement),
    getBookmark() {
      return null;
    },
  };

  const db: ServerD1Database = {
    prepare(query: string) {
      return createPostgresPreparedStatement(
        { query: runQuery },
        query,
        [],
        `portable-postgres:${schemaName}`,
      );
    },
    batch: createSequentialBatch(runStatement),
    async exec(query: string) {
      const startedAt = Date.now();
      await runQuery(query);
      return { count: 0, duration: Date.now() - startedAt };
    },
    withSession() {
      return session;
    },
    async dump() {
      throw new UnsupportedOperationError(
        "dump",
        "DB.dump() is not implemented for the schema-scoped Postgres adapter",
      );
    },
    close() {
      void pool.end();
    },
  };

  return db;
}
