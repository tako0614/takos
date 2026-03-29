/**
 * D1 database methods for the WFP (Workers for Platforms) service.
 *
 * Manages Cloudflare D1 (SQLite) databases that are bound to tenant workers.
 * Provides creation, deletion, raw SQL execution, type-safe querying, table
 * introspection (list tables, column info, row counts), and result extraction
 * helpers.
 */
import type { WfpContext, D1QueryResult } from './wfp-contracts';
/**
 * Create a D1 database for tenant.
 */
export declare function createD1Database(ctx: WfpContext, name: string): Promise<string>;
/**
 * Delete a D1 database.
 */
export declare function deleteD1Database(ctx: WfpContext, databaseId: string): Promise<void>;
/**
 * Run SQL on a D1 database.
 */
export declare function runD1SQL(ctx: WfpContext, databaseId: string, sql: string): Promise<unknown>;
/**
 * Type-safe D1 query for internal use.
 * Callers specify the expected row shape via generic parameter T.
 */
export declare function runD1SQLTyped<T>(ctx: WfpContext, databaseId: string, sql: string): Promise<D1QueryResult<T>[]>;
/**
 * List tables in a D1 database.
 */
export declare function listD1Tables(ctx: WfpContext, databaseId: string): Promise<Array<{
    name: string;
}>>;
/**
 * Get table info (columns) for a D1 table.
 */
export declare function getD1TableInfo(ctx: WfpContext, databaseId: string, tableName: string): Promise<Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
}>>;
/**
 * Get row count for a D1 table.
 */
export declare function getD1TableCount(ctx: WfpContext, databaseId: string, tableName: string): Promise<number>;
/**
 * Execute SQL query on a D1 database (alias for runD1SQL).
 */
export declare function executeD1Query(ctx: WfpContext, databaseId: string, sql: string): Promise<unknown>;
/**
 * Type-safe D1 query returning extracted results.
 */
export declare function queryD1<T>(ctx: WfpContext, databaseId: string, sql: string): Promise<T[]>;
//# sourceMappingURL=d1.d.ts.map