/**
 * In-memory stub of Cloudflare D1 (SQLite-compatible edge database).
 *
 * Returns empty results for all queries. Useful as a no-op placeholder
 * during local development or in tests where database access is not
 * required.
 */

import type {
  D1Database,
  D1PreparedStatement,
} from '../shared/types/bindings.ts';

/**
 * Structural mirror interfaces for the Cloudflare abstract classes.
 * These allow `satisfies` checks on mock objects without requiring
 * class inheritance from the abstract originals.
 */
interface D1MetaShape {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
  [key: string]: unknown;
}

interface D1ResultShape<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: D1MetaShape;
}

interface D1PreparedStatementShape {
  bind(...values: unknown[]): D1PreparedStatementShape;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1ResultShape<T>>;
  all<T = Record<string, unknown>>(): Promise<D1ResultShape<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]>;
}

interface D1DatabaseShape {
  prepare(query: string): D1PreparedStatementShape;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatementShape[]): Promise<D1ResultShape<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  withSession(): { prepare(query: string): D1PreparedStatementShape; batch<T = Record<string, unknown>>(statements: D1PreparedStatementShape[]): Promise<D1ResultShape<T>[]>; getBookmark(): null };
  dump(): Promise<ArrayBuffer>;
}

function createD1Meta(): D1MetaShape {
  return {
    changed_db: false,
    changes: 0,
    duration: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    served_by: 'local',
    size_after: 0,
  };
}

function createPreparedStatement(): D1PreparedStatement {
  const statement: D1PreparedStatementShape = {
    bind(..._values: unknown[]) {
      return statement;
    },
    async first<T = Record<string, unknown>>(_colName?: string): Promise<T | null> {
      return null;
    },
    async run<T = Record<string, unknown>>(): Promise<D1ResultShape<T>> {
      return {
        results: [] as T[],
        success: true,
        meta: createD1Meta(),
      } satisfies D1ResultShape<T>;
    },
    async all<T = Record<string, unknown>>(): Promise<D1ResultShape<T>> {
      return {
        results: [] as T[],
        success: true,
        meta: createD1Meta(),
      } satisfies D1ResultShape<T>;
    },
    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
      if (options?.columnNames) {
        return [[]] as [string[], ...T[]];
      }
      return [];
    },
  };

  // The mock satisfies D1PreparedStatementShape structurally; the abstract class
  // boundary requires a cast at the return site.
  return statement as unknown as D1PreparedStatement;
}

export function createInMemoryD1Database(): D1Database {
  const session = {
    prepare(_query: string) {
      return createPreparedStatement();
    },
    async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
      return Promise.all(statements.map((statement) => statement.run<T>()));
    },
    getBookmark() {
      return null;
    },
  };

  const db = {
    prepare(_query: string) {
      return createPreparedStatement();
    },
    async batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]) {
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
  } satisfies D1DatabaseShape;

  // The mock satisfies D1DatabaseShape structurally; the abstract class
  // boundary requires a single cast at the return site.
  return db as unknown as D1Database;
}
