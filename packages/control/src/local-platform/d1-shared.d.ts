import type { InArgs, ResultSet } from '@libsql/client';
import type { QueryResult } from 'pg';
import type { D1Database, D1Result } from '../shared/types/bindings.ts';
export type ServerD1Database = D1Database & {
    close(): void;
};
export type PostgresRunner = {
    query(queryText: string, values?: unknown[]): Promise<QueryResult<Record<string, unknown>>>;
};
export declare function createD1Meta(servedBy: string, overrides?: Partial<Record<string, unknown>>): Record<string, unknown>;
export declare function normalizeArgs(values: unknown[]): InArgs;
export declare function normalizePostgresArgs(values: unknown[]): unknown[];
export declare function rowToObject(row: ResultSet['rows'][number], columns: string[]): Record<string, unknown>;
export declare function rowToObjectFromRecord(row: Record<string, unknown>, columns: string[]): Record<string, unknown>;
export declare function resultSetToD1Result<T>(result: ResultSet): D1Result<T>;
export declare function queryResultToD1Result<T>(result: QueryResult<Record<string, unknown>>, servedBy: string): D1Result<T>;
export declare function normalizePostgresSql(query: string): string;
export declare function classifyTransactionSql(query: string): 'begin' | 'commit' | 'rollback' | null;
export declare function toPgRawRows(result: QueryResult<Record<string, unknown>>): [string[], ...unknown[]] | unknown[];
export declare function isExactTransactionControlSql(query: string): boolean;
//# sourceMappingURL=d1-shared.d.ts.map