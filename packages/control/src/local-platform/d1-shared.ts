import type { InArgs, ResultSet } from '@libsql/client';
import type { QueryResult } from 'pg';
import type { D1Database, D1Result } from '../shared/types/bindings.ts';

export type ServerD1Database = D1Database & {
  close(): void;
};

export type PostgresRunner = {
  query(queryText: string, values?: unknown[]): Promise<QueryResult<Record<string, unknown>>>;
};

export function createD1Meta(
  servedBy: string,
  overrides?: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    changed_db: false,
    changes: 0,
    duration: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    served_by: servedBy,
    size_after: 0,
    ...overrides,
  };
}

function normalizeArg(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value === undefined) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' || typeof value === 'string' || value === null) return value;
  return JSON.stringify(value);
}

export function normalizeArgs(values: unknown[]): InArgs {
  return values.map((value) => normalizeArg(value)) as InArgs;
}

function normalizePostgresArg(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  return JSON.stringify(value);
}

export function normalizePostgresArgs(values: unknown[]): unknown[] {
  return values.map((value) => normalizePostgresArg(value));
}

export function rowToObject(row: ResultSet['rows'][number], columns: string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
}

export function rowToObjectFromRecord(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

export function resultSetToD1Result<T>(result: ResultSet): D1Result<T> {
  return {
    results: result.rows.map((row) => rowToObject(row, result.columns) as T),
    success: true,
    meta: createD1Meta('local-sqlite', {
      changed_db: result.rowsAffected > 0,
      changes: result.rowsAffected,
      last_row_id: result.lastInsertRowid == null ? 0 : Number(result.lastInsertRowid),
      rows_read: result.rows.length,
      rows_written: result.rowsAffected,
    }),
  } as D1Result<T>;
}

export function queryResultToD1Result<T>(
  result: QueryResult<Record<string, unknown>>,
  servedBy: string,
): D1Result<T> {
  const columns = result.fields.map((field: { name: string }) => field.name);
  return {
    results: result.rows.map((row: Record<string, unknown>) => rowToObjectFromRecord(row, columns) as T),
    success: true,
    meta: createD1Meta(servedBy, {
      changed_db: (result.rowCount ?? 0) > 0,
      changes: result.rowCount ?? 0,
      last_row_id: 0,
      rows_read: result.rows.length,
      rows_written: result.rowCount ?? 0,
    }),
  } as D1Result<T>;
}

function replaceQuestionMarkParameters(query: string): string {
  let index = 0;
  return query.replace(/\?/g, () => `$${++index}`);
}

export function normalizePostgresSql(query: string): string {
  return replaceQuestionMarkParameters(
    query.replace(/\bBEGIN\s+(IMMEDIATE|EXCLUSIVE|DEFERRED)\b/gi, 'BEGIN'),
  );
}

export function classifyTransactionSql(query: string): 'begin' | 'commit' | 'rollback' | null {
  const trimmed = query.trim().replace(/;$/, '');
  if (/^BEGIN$/i.test(trimmed)) return 'begin';
  if (/^COMMIT$/i.test(trimmed)) return 'commit';
  if (/^ROLLBACK$/i.test(trimmed)) return 'rollback';
  return null;
}

export function toPgRawRows(result: QueryResult<Record<string, unknown>>): [string[], ...unknown[]] | unknown[] {
  const columns = result.fields.map((field: { name: string }) => field.name);
  const rows = result.rows.map((row: Record<string, unknown>) => columns.map((column) => row[column]));
  return [columns, ...rows];
}

export function isExactTransactionControlSql(query: string): boolean {
  const trimmed = query.trim().replace(/;$/, '');
  return /^(BEGIN|COMMIT|ROLLBACK)$/i.test(trimmed);
}
