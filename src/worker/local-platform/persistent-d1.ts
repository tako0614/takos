/**
 * Persistent local implementations of the SQL database (SQLite-compatible edge database) interface.
 *
 * Provides two adapters for local/server use where a real SQL database binding is
 * unavailable:
 *   - `createSqliteSqlDatabase`   -- backed by a local SQLite file via libSQL
 *   - `createPostgresSqlDatabase` -- backed by a PostgreSQL connection pool
 *
 * Both expose the same SQL-compatible API (prepare / batch / exec / withSession)
 * so that the rest of the codebase can treat them identically to SQL database.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool, type PoolClient, type QueryResult } from "pg";
import type {
  SqlPreparedStatementBinding,
  SqlTransactionSessionBinding,
} from "../shared/types/bindings.ts";
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
  type PostgresRunner,
  type ServerSqlDatabase,
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
export type { ServerSqlDatabase } from "./d1-shared.ts";

async function loadLibsqlCreateClient(): Promise<typeof createLibsqlClient> {
  const libsql = await import("@libsql/client");
  return libsql.createClient;
}

/**
 * FIFO async gate used to serialize transactional access on the Postgres
 * adapters. The `pg` Pool hands out a different backend connection per
 * `pool.query()`, so a transaction (BEGIN..COMMIT) must run on a single
 * dedicated `PoolClient`. The previous design stored that client in a shared
 * adapter slot and routed *every* query to it whenever a transaction was open,
 * which silently leaked unrelated callers' statements into the open
 * transaction (broken isolation + atomicity).
 *
 * This gate fixes the cross-talk by making a transaction an exclusive critical
 * section: the BEGIN handler acquires the gate and holds it until
 * COMMIT/ROLLBACK, so on the single-threaded event loop the only statements
 * that can arrive in that window belong to the transaction owner (every other
 * caller is parked in the gate queue). Non-transactional queries acquire the
 * gate momentarily and run on the pool, so they never observe or join an
 * in-flight transaction.
 */
export function createSerializationGate(): {
  acquire(): Promise<() => void>;
} {
  let tail: Promise<void> = Promise.resolve();
  return {
    acquire() {
      let release!: () => void;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = tail.then(() => release);
      tail = next;
      return ready;
    },
  };
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
  // Keep this fallback available for Node/Bun local-platform runs without
  // making Wrangler's Worker bundler resolve node:sqlite, which is not part of
  // the Workers runtime even with nodejs_compat.
  const sqlite = await import("node:" + "sqlite");
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

export async function createSqliteSqlDatabase(
  dbPath: string,
  migrationsDir: string,
): Promise<ServerSqlDatabase> {
  await ensureParentDirectory(dbPath);
  let client: SqliteLikeClient;
  try {
    const createClient = await loadLibsqlCreateClient();
    client = createClient({
      url: pathToFileURL(dbPath).href,
    }) as SqliteLikeClient;
  } catch (error) {
    logWarn("Falling back to node:sqlite local SQL adapter", {
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
    statement: SqlPreparedStatementBinding,
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

  const db: ServerSqlDatabase = {
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

export async function createPostgresSqlDatabase(
  connectionString: string,
  migrationsDirOverride?: string,
): Promise<ServerSqlDatabase> {
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
  // A transaction (BEGIN..COMMIT) must execute on a single dedicated
  // `PoolClient`, because `pool.query()` may hand out a different backend
  // connection per call. While a transaction is open we hold an exclusive
  // serialization gate so that *only* the transaction owner's statements reach
  // the dedicated client; every other (transactional or non-transactional)
  // caller is parked in the gate queue and resumes once the transaction ends.
  // Non-transactional queries run on the pool, never on the transaction client,
  // so they can never observe or join an in-flight transaction.
  const gate = createSerializationGate();
  let activeTransactionClient: PoolClient | null = null;
  let releaseGate: (() => void) | null = null;
  // True only while an explicit `withTransaction()` scope owns the gate + client.
  // In that window the callback MUST issue statements via the `tx` binding; raw
  // transaction-control SQL routed through the outer adapter (`runQuery`) would
  // corrupt the manual BEGIN/COMMIT bracket, so `runQuery` rejects it (below).
  let inExplicitTx = false;

  async function beginTransaction(
    normalized: string,
    values: unknown[],
  ): Promise<QueryResult<Record<string, unknown>>> {
    // Block until any in-flight transaction has fully committed/rolled back.
    const release = await gate.acquire();
    if (activeTransactionClient) {
      // Defensive: a previous transaction's release path failed to clear the
      // slot. Surface loudly rather than silently sharing a connection.
      release();
      throw new Error(
        "transaction_in_progress: a transaction client is still bound while a new BEGIN acquired the gate on this Postgres adapter",
      );
    }
    // Release the serialization gate if acquiring a connection fails — otherwise
    // the gate (taken just above) leaks and the whole adapter deadlocks: every
    // later runQuery/withTransaction/beginTransaction blocks forever on acquire().
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      release();
      throw error;
    }
    activeTransactionClient = client;
    releaseGate = release;
    try {
      return await client.query(normalized, values);
    } catch (error) {
      finishTransaction();
      throw error;
    }
  }

  function finishTransaction(): void {
    const client = activeTransactionClient;
    const release = releaseGate;
    activeTransactionClient = null;
    releaseGate = null;
    client?.release();
    release?.();
  }

  async function runQuery(
    queryText: string,
    values: unknown[] = [],
  ): Promise<QueryResult<Record<string, unknown>>> {
    const normalized = normalizePostgresSql(queryText);
    const transactionKind = isExactTransactionControlSql(normalized)
      ? classifyTransactionSql(normalized)
      : null;

    // An explicit withTransaction() scope owns the gate + dedicated client; raw
    // transaction-control SQL routed through the adapter here would self-deadlock
    // (a BEGIN re-acquires the already-held gate) or double-release (a COMMIT/
    // ROLLBACK frees the client + gate the bracket still owns). Fail loudly — the
    // callback must issue statements via the `tx` binding, not the outer adapter.
    if (inExplicitTx && transactionKind !== null) {
      throw new Error(
        `transaction_control_in_explicit_tx: ${transactionKind} is not allowed ` +
          `through the adapter inside withTransaction(); use the tx binding`,
      );
    }

    if (transactionKind === "begin") {
      return beginTransaction(normalized, values);
    }

    // Statements issued while we hold the gate belong to the transaction owner
    // (all other callers are blocked in the gate queue on the single-threaded
    // event loop), so route them to the dedicated transaction client.
    if (activeTransactionClient) {
      const client = activeTransactionClient;
      try {
        const result = await client.query(normalized, values);
        if (transactionKind === "commit" || transactionKind === "rollback") {
          finishTransaction();
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
        finishTransaction();
        throw error;
      }
    }

    // Non-transactional query: take the gate momentarily so it waits for any
    // open transaction to finish, then run on the pool (its own connection).
    const release = await gate.acquire();
    try {
      return await pool.query(normalized, values);
    } finally {
      release();
    }
  }

  const runStatement = <T = Record<string, unknown>>(
    statement: SqlPreparedStatementBinding,
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

  // Explicit transaction entry point (DQ1 fix, Option A). Unlike the flag-based
  // `runQuery` routing, this acquires the serialization gate EXCLUSIVELY for the
  // whole callback and runs BEGIN / the callback / COMMIT on one dedicated
  // `PoolClient`. Because the gate is held for the entire transaction, no other
  // caller can observe or join the open transaction: concurrent BEGINs and
  // non-transactional queries park in the gate queue until COMMIT/ROLLBACK.
  //
  // `activeTransactionClient` is also set so statements issued against this same
  // adapter binding from inside the callback (e.g. via a drizzle client wrapping
  // `db.prepare(...)`) are routed to the dedicated client by the existing
  // `runQuery` path. Those statements never release the gate, so the critical
  // section stays exclusive end-to-end.
  async function withTransaction<T>(
    cb: (tx: SqlTransactionSessionBinding) => Promise<T>,
  ): Promise<T> {
    const release = await gate.acquire();
    if (activeTransactionClient) {
      release();
      throw new Error(
        "transaction_in_progress: a transaction client is still bound while withTransaction acquired the gate on this Postgres adapter",
      );
    }
    // Release the serialization gate if acquiring a connection fails — otherwise
    // the gate (taken just above) leaks and the whole adapter deadlocks: every
    // later runQuery/withTransaction/beginTransaction blocks forever on acquire().
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      release();
      throw error;
    }
    activeTransactionClient = client;
    releaseGate = release;
    const txRunner: PostgresRunner = {
      query: (queryText, values = []) =>
        client.query(normalizePostgresSql(queryText), values),
    };
    const txRunStatement = <T = Record<string, unknown>>(
      statement: SqlPreparedStatementBinding,
    ) => statement.run<T>();
    const tx: SqlTransactionSessionBinding = {
      prepare(query: string) {
        return createPostgresPreparedStatement(txRunner, query);
      },
      batch: createSequentialBatch(txRunStatement),
      async exec(query: string) {
        const startedAt = Date.now();
        await txRunner.query(query);
        return { count: 0, duration: Date.now() - startedAt };
      },
    };
    inExplicitTx = true;
    try {
      await client.query("BEGIN");
      const result = await cb(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch((e: unknown) => {
        logWarn("ROLLBACK failed after withTransaction error (non-critical)", {
          module: "persistent-d1",
          error: e instanceof Error ? e.message : String(e),
        });
      });
      throw error;
    } finally {
      inExplicitTx = false;
      activeTransactionClient = null;
      releaseGate = null;
      client.release();
      release();
    }
  }

  const db: ServerSqlDatabase = {
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
    withTransaction,
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

/**
 * Establish DATABASE-ENFORCED tenant isolation for a portable-postgres resource
 * schema. `search_path` is only name resolution, not a privilege boundary — when
 * the tenant SQL adapter and the control plane share one Postgres database/role,
 * a tenant could read/write `public.*` (accounts, sessions, resource secrets) and
 * any other tenant's `resource_*.*` via fully-qualified names. The privilege
 * boundary is a dedicated NOLOGIN role, 1:1 with the schema, that can only touch
 * its own schema; every connection checkout enters it via `SET ROLE`, so Postgres
 * itself rejects cross-schema access regardless of the SQL the tenant submits.
 *
 * Returns `{ ok: true }` only after probing that `SET ROLE` actually drops into
 * the tenant role on this server. If the connection role cannot create/assume the
 * role (e.g. lacks CREATEROLE and is not a superuser) the caller MUST fail closed
 * rather than silently fall back to shared-role access.
 */
async function establishSchemaRoleIsolation(
  pool: Pool,
  schemaName: string,
): Promise<{ ok: true; quotedRole: string } | { ok: false; reason: string }> {
  // The role shares the schema name (roles and schemas are separate Postgres
  // namespaces, so the 1:1 mapping is unambiguous). schemaName is already
  // sanitized to [a-zA-Z0-9_] upstream (resolvePortableSqlSchemaName →
  // sanitizeSqlIdentifier); the quoting/escaping below is defense-in-depth.
  const quotedSchema = `"${schemaName.replace(/"/g, '""')}"`;
  const quotedRole = `"${schemaName.replace(/"/g, '""')}"`;
  const roleLiteral = `'${schemaName.replace(/'/g, "''")}'`;
  try {
    await pool.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${roleLiteral}) THEN
           CREATE ROLE ${quotedRole} NOLOGIN NOINHERIT;
         END IF;
       END $$;`,
    );
    await pool.query(`GRANT USAGE, CREATE ON SCHEMA ${quotedSchema} TO ${quotedRole}`);
    await pool.query(
      `GRANT ALL ON ALL TABLES IN SCHEMA ${quotedSchema} TO ${quotedRole}`,
    );
    await pool.query(
      `GRANT ALL ON ALL SEQUENCES IN SCHEMA ${quotedSchema} TO ${quotedRole}`,
    );
    // Membership lets a non-superuser connection role assume the tenant role.
    // Superusers (the documented node-postgres profile) can SET ROLE without it,
    // and a CREATEROLE creator is already a member, so this is best-effort.
    await pool.query(`GRANT ${quotedRole} TO CURRENT_USER`).catch(() => {});
    // Definitive probe: SET ROLE must succeed for the isolation to be real.
    const probe = await pool.connect();
    try {
      await probe.query(`SET ROLE ${quotedRole}`);
      await probe.query("RESET ROLE");
    } finally {
      probe.release();
    }
    return { ok: true, quotedRole };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function createSchemaScopedPostgresSqlDatabase(
  connectionString: string,
  schemaName: string,
): Promise<ServerSqlDatabase> {
  const pool = new Pool({ connectionString });
  const quotedSchema = `"${schemaName.replace(/"/g, '""')}"`;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);

  // DB-enforced isolation is mandatory: without it a tenant SQL resource can
  // reach the control plane (accounts/sessions/resource secrets in `public`) and
  // other tenants' schemas. Fail closed if the connection role cannot establish
  // it rather than serving cross-tenant access.
  const isolation = await establishSchemaRoleIsolation(pool, schemaName);
  if (!isolation.ok) {
    await pool.end().catch(() => {});
    throw new Error(
      `portable_postgres_isolation_unavailable: cannot establish per-schema role ` +
        `isolation for "${schemaName}" (${isolation.reason}). The Postgres ` +
        `connection role must be able to CREATE ROLE and SET ROLE so tenant SQL ` +
        `resources stay isolated from the control plane and other tenants. Grant ` +
        `CREATEROLE (or use a superuser) on the self-host Postgres profile.`,
    );
  }
  const quotedRole = isolation.quotedRole;

  // Per-checkout scoping: enter the least-privilege tenant role, then pin
  // search_path to ONLY the tenant schema (NOT `public`) so unqualified names
  // cannot fall through to control-plane tables and qualified cross-schema names
  // are rejected by the role's privileges.
  async function applyScopedSession(client: PoolClient): Promise<void> {
    await client.query(`SET ROLE ${quotedRole}`);
    await client.query(`SET search_path TO ${quotedSchema}`);
  }

  // Same serialization model as createPostgresSqlDatabase: a transaction holds
  // an exclusive gate and runs on a dedicated PoolClient (with search_path set
  // to the scoped schema); concurrent callers park in the gate queue. This
  // prevents unrelated statements from leaking into an open transaction on a
  // shared connection. See the gate rationale on createSerializationGate.
  const gate = createSerializationGate();
  let activeTransactionClient: PoolClient | null = null;
  let releaseGate: (() => void) | null = null;
  // See createPostgresSqlDatabase: true only inside an explicit withTransaction()
  // scope, where `runQuery` must reject raw transaction-control SQL.
  let inExplicitTx = false;

  async function beginTransaction(
    normalized: string,
    values: unknown[],
  ): Promise<QueryResult<Record<string, unknown>>> {
    const release = await gate.acquire();
    if (activeTransactionClient) {
      release();
      throw new Error(
        "transaction_in_progress: a transaction client is still bound while a new BEGIN acquired the gate on this schema-scoped Postgres adapter",
      );
    }
    // Release the serialization gate if acquiring a connection fails — otherwise
    // the gate (taken just above) leaks and the whole adapter deadlocks: every
    // later runQuery/withTransaction/beginTransaction blocks forever on acquire().
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      release();
      throw error;
    }
    activeTransactionClient = client;
    releaseGate = release;
    try {
      await applyScopedSession(client);
      return await client.query(normalized, values);
    } catch (error) {
      finishTransaction();
      throw error;
    }
  }

  function finishTransaction(): void {
    const client = activeTransactionClient;
    const release = releaseGate;
    activeTransactionClient = null;
    releaseGate = null;
    client?.release();
    release?.();
  }

  async function withScopedClient<T>(
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await applyScopedSession(client);
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

    // An explicit withTransaction() scope owns the gate + dedicated client; raw
    // transaction-control SQL routed through the adapter here would self-deadlock
    // (a BEGIN re-acquires the already-held gate) or double-release (a COMMIT/
    // ROLLBACK frees the client + gate the bracket still owns). Fail loudly — the
    // callback must issue statements via the `tx` binding, not the outer adapter.
    if (inExplicitTx && transactionKind !== null) {
      throw new Error(
        `transaction_control_in_explicit_tx: ${transactionKind} is not allowed ` +
          `through the adapter inside withTransaction(); use the tx binding`,
      );
    }

    if (transactionKind === "begin") {
      return beginTransaction(normalized, values);
    }

    if (activeTransactionClient) {
      const client = activeTransactionClient;
      try {
        const result = await client.query(normalized, values);
        if (transactionKind === "commit" || transactionKind === "rollback") {
          finishTransaction();
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
        finishTransaction();
        throw error;
      }
    }

    const release = await gate.acquire();
    try {
      return await withScopedClient((client) =>
        client.query(normalized, values)
      );
    } finally {
      release();
    }
  }

  const runStatement = <T = Record<string, unknown>>(
    statement: SqlPreparedStatementBinding,
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

  // Schema-scoped variant of the DQ1 fix. Identical exclusive-gate model to
  // createPostgresSqlDatabase, with `search_path` pinned to the scoped schema on
  // the dedicated client before BEGIN so transactional statements resolve
  // against the same schema as the non-transactional path.
  async function withTransaction<T>(
    cb: (tx: SqlTransactionSessionBinding) => Promise<T>,
  ): Promise<T> {
    const release = await gate.acquire();
    if (activeTransactionClient) {
      release();
      throw new Error(
        "transaction_in_progress: a transaction client is still bound while withTransaction acquired the gate on this schema-scoped Postgres adapter",
      );
    }
    // Release the serialization gate if acquiring a connection fails — otherwise
    // the gate (taken just above) leaks and the whole adapter deadlocks: every
    // later runQuery/withTransaction/beginTransaction blocks forever on acquire().
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      release();
      throw error;
    }
    activeTransactionClient = client;
    releaseGate = release;
    const txRunner: PostgresRunner = {
      query: (queryText, values = []) =>
        client.query(normalizePostgresSql(queryText), values),
    };
    const txRunStatement = <T = Record<string, unknown>>(
      statement: SqlPreparedStatementBinding,
    ) => statement.run<T>();
    const tx: SqlTransactionSessionBinding = {
      prepare(query: string) {
        return createPostgresPreparedStatement(
          txRunner,
          query,
          [],
          `portable-postgres:${schemaName}`,
        );
      },
      batch: createSequentialBatch(txRunStatement),
      async exec(query: string) {
        const startedAt = Date.now();
        await txRunner.query(query);
        return { count: 0, duration: Date.now() - startedAt };
      },
    };
    inExplicitTx = true;
    try {
      await applyScopedSession(client);
      await client.query("BEGIN");
      const result = await cb(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch((e: unknown) => {
        logWarn(
          "ROLLBACK failed after schema-scoped withTransaction error (non-critical)",
          {
            module: "persistent-d1",
            error: e instanceof Error ? e.message : String(e),
          },
        );
      });
      throw error;
    } finally {
      inExplicitTx = false;
      activeTransactionClient = null;
      releaseGate = null;
      client.release();
      release();
    }
  }

  const db: ServerSqlDatabase = {
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
    withTransaction,
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
