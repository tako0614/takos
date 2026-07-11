import type { Client, InStatement, ResultSet } from "@libsql/client";
import type { QueryResult } from "pg";
import type {
  SqlPreparedStatementBinding,
  SqlResultBinding,
} from "../shared/types/bindings.ts";
import {
  normalizeArgs,
  normalizePostgresStatement,
  type PostgresRunner,
  queryResultToSqlResult,
  resultSetToSqlResult,
  rowToObject,
  rowToObjectFromRecord,
  toPgRawRows,
} from "./d1-shared.ts";

export function createPreparedStatement(
  client: Client,
  query: string,
  boundArgs: unknown[] = [],
): SqlPreparedStatementBinding {
  const execute = async (): Promise<ResultSet> =>
    client.execute({
      sql: query,
      args: normalizeArgs(boundArgs),
    } as InStatement);

  async function raw<T = unknown[]>(options: {
    columnNames: true;
  }): Promise<[string[], ...T[]]>;
  async function raw<T = unknown[]>(options?: {
    columnNames?: false;
  }): Promise<T[]>;
  async function raw<T = unknown[]>(options?: {
    columnNames?: boolean;
  }): Promise<T[] | [string[], ...T[]]> {
    const result = await execute();
    const rows = result.rows.map((row) =>
      result.columns.map((column) => row[column]),
    ) as T[];
    if (options?.columnNames) {
      return [result.columns, ...rows] as [string[], ...T[]];
    }
    return rows;
  }

  const statement: SqlPreparedStatementBinding = {
    bind(...values: unknown[]) {
      return createPreparedStatement(client, query, values);
    },
    async first<T = Record<string, unknown>>(
      colName?: string,
    ): Promise<T | null> {
      const result = await execute();
      const row = result.rows[0];
      if (!row) return null;
      if (colName) return (row as Record<string, unknown>)[colName] as T;
      return rowToObject(row, result.columns) as T;
    },
    async run<T = Record<string, unknown>>(): Promise<SqlResultBinding<T>> {
      return resultSetToSqlResult<T>(await execute());
    },
    async all<T = Record<string, unknown>>(): Promise<SqlResultBinding<T>> {
      return resultSetToSqlResult<T>(await execute());
    },
    raw,
  };

  return statement;
}

export function createPostgresPreparedStatement(
  runner: PostgresRunner,
  query: string,
  boundArgs: unknown[] = [],
  servedBy = "local-postgres",
): SqlPreparedStatementBinding {
  const execute = async (): Promise<QueryResult<Record<string, unknown>>> => {
    const normalized = normalizePostgresStatement(query, boundArgs);
    return runner.query(normalized.query, normalized.values);
  };

  async function raw<T = unknown[]>(options: {
    columnNames: true;
  }): Promise<[string[], ...T[]]>;
  async function raw<T = unknown[]>(options?: {
    columnNames?: false;
  }): Promise<T[]>;
  async function raw<T = unknown[]>(options?: {
    columnNames?: boolean;
  }): Promise<T[] | [string[], ...T[]]> {
    const result = await execute();
    if (options?.columnNames) {
      return toPgRawRows(result) as [string[], ...T[]];
    }
    const columns = result.fields.map((field: { name: string }) => field.name);
    return result.rows.map((row: Record<string, unknown>) =>
      columns.map((column: string) => row[column]),
    ) as T[];
  }

  const statement: SqlPreparedStatementBinding = {
    bind(...values: unknown[]) {
      return createPostgresPreparedStatement(runner, query, values, servedBy);
    },
    async first<T = Record<string, unknown>>(
      colName?: string,
    ): Promise<T | null> {
      const result = await execute();
      const row = result.rows[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      if (colName) return row[colName] as T;
      const columns = result.fields.map(
        (field: { name: string }) => field.name,
      );
      return rowToObjectFromRecord(row, columns) as T;
    },
    async run<T = Record<string, unknown>>(): Promise<SqlResultBinding<T>> {
      return queryResultToSqlResult<T>(await execute(), servedBy);
    },
    async all<T = Record<string, unknown>>(): Promise<SqlResultBinding<T>> {
      return queryResultToSqlResult<T>(await execute(), servedBy);
    },
    raw,
  };

  return statement;
}

export function createSequentialBatch(
  runStatement: <T = Record<string, unknown>>(
    statement: SqlPreparedStatementBinding,
  ) => Promise<SqlResultBinding<T>>,
): <T = Record<string, unknown>>(
  statements: SqlPreparedStatementBinding[],
) => Promise<SqlResultBinding<T>[]> {
  return async <T = Record<string, unknown>>(
    statements: SqlPreparedStatementBinding[],
  ) => {
    const results: SqlResultBinding<T>[] = [];
    for (const statement of statements) {
      results.push(await runStatement<T>(statement));
    }
    return results;
  };
}
