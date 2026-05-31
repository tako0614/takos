import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
/**
 * No-op stub of the SQL database (SQLite-compatible edge database) interface.
 *
 * IMPORTANT: this adapter is TEST/DEV-ONLY and is NOT durable. It does NOT
 * store anything: every query returns empty results, run()/batch() report
 * `changes: 0` / `changed_db: false`, and dump() returns an empty buffer. Any
 * read-after-write against it returns nothing. It exists only as a no-op
 * placeholder for tests and throwaway local development where database access
 * is not actually required.
 *
 * Unlike the in-memory KV / queue / object-store siblings (which keep an
 * in-process Map and so honour read-after-write), this SQL stub keeps no state
 * at all. It must NEVER back the control plane's persistent tables in a
 * production-shaped environment: doing so would silently fake write success
 * and drop durability. `createInMemorySqlDatabase` therefore fails closed
 * (throws) when it is constructed with `ENVIRONMENT=production`, and otherwise
 * logs a loud warning so a stray non-durable fallback is never silent.
 */

import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
} from "../shared/types/bindings.ts";
import { logWarn } from "../shared/utils/logger.ts";

/**
 * Refuse to back the control plane with this non-durable stub in a
 * production-shaped environment. Reading `ENVIRONMENT`/`VITEST` directly mirrors
 * the env-signal convention used elsewhere in local-platform (e.g.
 * runtime-http.ts). Under the test runner we allow it silently; in any other
 * non-production environment we warn loudly so a stray fallback is visible.
 */
function assertNotDurableInProduction(): void {
  if (getEnv("VITEST") !== undefined) return;

  const environment = getEnv("ENVIRONMENT");
  if (environment === "production") {
    throw new Error(
      "in-memory SQL database refused: the non-durable in-memory SQL stub cannot back the control plane in a production environment. Configure a durable store (POSTGRES_URL/DATABASE_URL or TAKOS_LOCAL_DATA_DIR) instead.",
    );
  }

  logWarn(
    "Using the non-durable in-memory SQL stub for the control database; writes will NOT persist and every read-after-write returns empty. This adapter is TEST/DEV-only.",
    { module: "in-memory-d1", environment: environment ?? "unset" },
  );
}

/**
 * Structural mirror interfaces for the Cloudflare abstract classes.
 * These allow `satisfies` checks on mock objects without requiring
 * class inheritance from the abstract originals.
 */
interface SqlResultMetaShape {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
  [key: string]: unknown;
}

interface SqlResultShape<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: SqlResultMetaShape;
}

interface SqlPreparedStatementShape {
  bind(...values: unknown[]): SqlPreparedStatementShape;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<SqlResultShape<T>>;
  all<T = Record<string, unknown>>(): Promise<SqlResultShape<T>>;
  raw<T = unknown[]>(
    options?: { columnNames?: boolean },
  ): Promise<T[] | [string[], ...T[]]>;
}

interface SqlDatabaseShape {
  prepare(query: string): SqlPreparedStatementShape;
  batch<T = Record<string, unknown>>(
    statements: SqlPreparedStatementShape[],
  ): Promise<SqlResultShape<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  withSession(): {
    prepare(query: string): SqlPreparedStatementShape;
    batch<T = Record<string, unknown>>(
      statements: SqlPreparedStatementShape[],
    ): Promise<SqlResultShape<T>[]>;
    getBookmark(): null;
  };
  dump(): Promise<ArrayBuffer>;
}

function createSqlResultMeta(): SqlResultMetaShape {
  return {
    changed_db: false,
    changes: 0,
    duration: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    served_by: "local",
    size_after: 0,
  };
}

function createPreparedStatement(): SqlPreparedStatementBinding {
  async function raw<T = unknown[]>(options: {
    columnNames: true;
  }): Promise<[string[], ...T[]]>;
  async function raw<T = unknown[]>(options?: {
    columnNames?: false;
  }): Promise<T[]>;
  async function raw<T = unknown[]>(
    options?: { columnNames?: boolean },
  ): Promise<T[] | [string[], ...T[]]> {
    if (options?.columnNames) {
      return [[]] as [string[], ...T[]];
    }
    return [];
  }

  const statement: SqlPreparedStatementBinding = {
    bind(..._values: unknown[]) {
      return statement;
    },
    async first<T = Record<string, unknown>>(
      _colName?: string,
    ): Promise<T | null> {
      return null;
    },
    async run<T = Record<string, unknown>>(): Promise<SqlResultShape<T>> {
      return {
        results: [] as T[],
        success: true,
        meta: createSqlResultMeta(),
      } satisfies SqlResultShape<T>;
    },
    async all<T = Record<string, unknown>>(): Promise<SqlResultShape<T>> {
      return {
        results: [] as T[],
        success: true,
        meta: createSqlResultMeta(),
      } satisfies SqlResultShape<T>;
    },
    raw,
  };

  return statement;
}

export function createInMemorySqlDatabase(): SqlDatabaseBinding {
  assertNotDurableInProduction();
  const session = {
    prepare(_query: string) {
      return createPreparedStatement();
    },
    async batch<T = Record<string, unknown>>(
      statements: SqlPreparedStatementBinding[],
    ) {
      return Promise.all(statements.map((statement) => statement.run<T>()));
    },
    getBookmark() {
      return null;
    },
  };

  const db: SqlDatabaseBinding = {
    prepare(_query: string) {
      return createPreparedStatement();
    },
    async batch<T = Record<string, unknown>>(
      statements: SqlPreparedStatementBinding[],
    ) {
      return Promise.all(statements.map((statement) => statement.run<T>()));
    },
    async exec(_query: string) {
      return { count: 0, duration: 0 };
    },
    withSession() {
      return session;
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  };

  return db;
}
