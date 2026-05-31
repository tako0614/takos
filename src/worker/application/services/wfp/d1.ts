/**
 * SQL database methods for the Cloudflare provider adapter.
 *
 * Manages Cloudflare provider SQL databases that are bound to tenant
 * runtimes. Provides creation, deletion, raw SQL execution, type-safe
 * querying, table introspection (list tables, column info, row counts), and
 * result extraction helpers.
 */

import { InternalError } from "@takos/worker-platform-utils/errors";
import type { D1QueryResult, WfpContext } from "./wfp-contracts.ts";
import { extractD1Results, sanitizeTableName } from "./worker-metadata.ts";

// ---------------------------------------------------------------------------
// SQL database CRUD & query
// ---------------------------------------------------------------------------

/**
 * Create a SQL database for a tenant.
 */
export async function createD1Database(
  ctx: WfpContext,
  name: string,
): Promise<string> {
  const response = await ctx.cfFetchWithRetry<{ uuid: string }>(
    ctx.accountPath("/d1/database"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!response.result?.uuid) {
    throw new InternalError(
      `Failed to create SQL database: no UUID returned from API`,
    );
  }
  return response.result.uuid;
}

/**
 * Delete a SQL database.
 */
export async function deleteD1Database(
  ctx: WfpContext,
  databaseId: string,
): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/d1/database/${databaseId}`),
    { method: "DELETE" },
  );
}

/**
 * Run SQL on a provider SQL database.
 */
export async function runD1SQL(
  ctx: WfpContext,
  databaseId: string,
  sql: string,
): Promise<unknown> {
  const response = await ctx.cfFetch(
    ctx.accountPath(`/d1/database/${databaseId}/query`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    },
  );
  return response.result;
}

/**
 * Type-safe provider SQL query for internal use.
 * Callers specify the expected row shape via generic parameter T.
 */
export async function runD1SQLTyped<T>(
  ctx: WfpContext,
  databaseId: string,
  sql: string,
): Promise<D1QueryResult<T>[]> {
  const response = await ctx.cfFetch<D1QueryResult<T>[]>(
    ctx.accountPath(`/d1/database/${databaseId}/query`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    },
  );
  return response.result;
}

/**
 * List tables in a provider SQL database.
 */
export async function listD1Tables(
  ctx: WfpContext,
  databaseId: string,
): Promise<Array<{ name: string }>> {
  const result = await runD1SQLTyped<{ name: string }>(
    ctx,
    databaseId,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  );
  return extractD1Results(result);
}

/**
 * Get table info (columns) for a provider SQL table.
 */
export async function getD1TableInfo(
  ctx: WfpContext,
  databaseId: string,
  tableName: string,
): Promise<
  Array<{
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
  }>
> {
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
 * Get row count for a provider SQL table.
 */
export async function getD1TableCount(
  ctx: WfpContext,
  databaseId: string,
  tableName: string,
): Promise<number> {
  const safeName = sanitizeTableName(tableName);
  const result = await runD1SQLTyped<{ count: number }>(
    ctx,
    databaseId,
    `SELECT COUNT(*) as count FROM ${safeName}`,
  );
  return extractD1Results(result)[0]?.count ?? 0;
}

/**
 * Execute SQL query on a provider SQL database (alias for runD1SQL).
 */
export async function executeD1Query(
  ctx: WfpContext,
  databaseId: string,
  sql: string,
): Promise<unknown> {
  return runD1SQL(ctx, databaseId, sql);
}

/**
 * Type-safe provider SQL query returning extracted results.
 */
export async function queryD1<T>(
  ctx: WfpContext,
  databaseId: string,
  sql: string,
): Promise<T[]> {
  const result = await runD1SQLTyped<T>(ctx, databaseId, sql);
  return extractD1Results(result);
}
