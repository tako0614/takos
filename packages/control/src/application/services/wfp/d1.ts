/**
 * D1 database methods for the WFP (Workers for Platforms) service.
 *
 * Manages Cloudflare D1 (SQLite) databases that are bound to tenant workers.
 * Provides creation, deletion, raw SQL execution, type-safe querying, table
 * introspection (list tables, column info, row counts), and result extraction
 * helpers.
 */

import { InternalError } from 'takos-common/errors';
import type { WfpContext, D1QueryResult } from './wfp-contracts.ts';
import { sanitizeTableName, extractD1Results } from './worker-metadata.ts';

// ---------------------------------------------------------------------------
// D1 CRUD & query
// ---------------------------------------------------------------------------

/**
 * Create a D1 database for tenant.
 */
export async function createD1Database(ctx: WfpContext, name: string): Promise<string> {
  const response = await ctx.cfFetchWithRetry<{ uuid: string }>(
    ctx.accountPath('/d1/database'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }
  );
  if (!response.result?.uuid) {
    throw new InternalError(`Failed to create D1 database: no UUID returned from API`);
  }
  return response.result.uuid;
}

/**
 * Delete a D1 database.
 */
export async function deleteD1Database(ctx: WfpContext, databaseId: string): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/d1/database/${databaseId}`),
    { method: 'DELETE' }
  );
}

/**
 * Run SQL on a D1 database.
 */
export async function runD1SQL(ctx: WfpContext, databaseId: string, sql: string): Promise<unknown> {
  const response = await ctx.cfFetch(
    ctx.accountPath(`/d1/database/${databaseId}/query`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    }
  );
  return response.result;
}

/**
 * Type-safe D1 query for internal use.
 * Callers specify the expected row shape via generic parameter T.
 */
export async function runD1SQLTyped<T>(ctx: WfpContext, databaseId: string, sql: string): Promise<D1QueryResult<T>[]> {
  const response = await ctx.cfFetch<D1QueryResult<T>[]>(
    ctx.accountPath(`/d1/database/${databaseId}/query`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    }
  );
  return response.result;
}

/**
 * List tables in a D1 database.
 */
export async function listD1Tables(ctx: WfpContext, databaseId: string): Promise<Array<{ name: string }>> {
  const result = await runD1SQLTyped<{ name: string }>(
    ctx,
    databaseId,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  );
  return extractD1Results(result);
}

/**
 * Get table info (columns) for a D1 table.
 */
export async function getD1TableInfo(ctx: WfpContext, databaseId: string, tableName: string): Promise<Array<{
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}>> {
  const safeName = sanitizeTableName(tableName);
  const result = await runD1SQLTyped<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>(ctx, databaseId, `PRAGMA table_info(${safeName})`);
  return extractD1Results(result);
}

/**
 * Get row count for a D1 table.
 */
export async function getD1TableCount(ctx: WfpContext, databaseId: string, tableName: string): Promise<number> {
  const safeName = sanitizeTableName(tableName);
  const result = await runD1SQLTyped<{ count: number }>(
    ctx,
    databaseId,
    `SELECT COUNT(*) as count FROM ${safeName}`
  );
  return extractD1Results(result)[0]?.count ?? 0;
}

/**
 * Execute SQL query on a D1 database (alias for runD1SQL).
 */
export async function executeD1Query(ctx: WfpContext, databaseId: string, sql: string): Promise<unknown> {
  return runD1SQL(ctx, databaseId, sql);
}

/**
 * Type-safe D1 query returning extracted results.
 */
export async function queryD1<T>(ctx: WfpContext, databaseId: string, sql: string): Promise<T[]> {
  const result = await runD1SQLTyped<T>(ctx, databaseId, sql);
  return extractD1Results(result);
}
