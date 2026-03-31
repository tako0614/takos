import type { Client, InStatement, ResultSet } from '@libsql/client';
import type { QueryResult } from 'pg';
import type { D1PreparedStatement, D1Result } from '../shared/types/bindings.ts';
import {
  normalizeArgs,
  normalizePostgresArgs,
  normalizePostgresSql,
  queryResultToD1Result,
  resultSetToD1Result,
  rowToObject,
  rowToObjectFromRecord,
  toPgRawRows,
  type PostgresRunner,
} from './d1-shared.ts';

export function createPreparedStatement(client: Client, query: string, boundArgs: unknown[] = []): D1PreparedStatement {
  const execute = async (): Promise<ResultSet> => client.execute({
    sql: query,
    args: normalizeArgs(boundArgs),
  } as InStatement);

  const statement = {
    bind(...values: unknown[]) {
      return createPreparedStatement(client, query, values);
    },
    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const result = await execute();
      const row = result.rows[0];
      if (!row) return null;
      if (colName) return (row as Record<string, unknown>)[colName] as T;
      return rowToObject(row, result.columns) as T;
    },
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return resultSetToD1Result<T>(await execute());
    },
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return resultSetToD1Result<T>(await execute());
    },
    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
      const result = await execute();
      const rows = result.rows.map((row) => result.columns.map((column) => row[column])) as T[];
      if (options?.columnNames) {
        return [result.columns, ...rows] as [string[], ...T[]];
      }
      return rows;
    },
  };

  return statement as unknown as D1PreparedStatement;
}

export function createPostgresPreparedStatement(
  runner: PostgresRunner,
  query: string,
  boundArgs: unknown[] = [],
  servedBy = 'local-postgres',
): D1PreparedStatement {
  const execute = async (): Promise<QueryResult<Record<string, unknown>>> => {
    const normalized = normalizePostgresSql(query);
    return runner.query(normalized, normalizePostgresArgs(boundArgs));
  };

  const statement = {
    bind(...values: unknown[]) {
      return createPostgresPreparedStatement(runner, query, values, servedBy);
    },
    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const result = await execute();
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      if (colName) return row[colName] as T;
      const columns = result.fields.map((field: { name: string }) => field.name);
      return rowToObjectFromRecord(row, columns) as T;
    },
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return queryResultToD1Result<T>(await execute(), servedBy);
    },
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      return queryResultToD1Result<T>(await execute(), servedBy);
    },
    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
      const result = await execute();
      if (options?.columnNames) {
        return toPgRawRows(result) as [string[], ...T[]];
      }
      const columns = result.fields.map((field: { name: string }) => field.name);
      return result.rows.map((row: Record<string, unknown>) => columns.map((column: string) => row[column])) as T[];
    },
  };

  return statement as unknown as D1PreparedStatement;
}

export function createSequentialBatch<T>(
  runStatement: (statement: D1PreparedStatement) => Promise<D1Result<T>>,
): (statements: D1PreparedStatement[]) => Promise<D1Result<T>[]> {
  return async (statements: D1PreparedStatement[]) => {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      results.push(await runStatement(statement));
    }
    return results;
  };
}
