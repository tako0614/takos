import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  Resource,
  ResourcePermission,
} from "../../../shared/types/index.ts";
import { type AuthenticatedRouteEnv, parseJsonBody } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import {
  AuthorizationError,
  BadRequestError,
  InternalError,
  isAppError,
  NotFoundError,
  PayloadTooLargeError,
} from "@takos/worker-platform-utils/errors";
import { zValidator } from "../zod-validator.ts";
import { createOptionalCloudflareWfpBackend } from "../../../platform/backends/cloudflare/wfp.ts";
import {
  getPortableSqlDatabase,
  isPortableResourceBackend,
} from "./portable-runtime.ts";
import { checkResourceAccess } from "../../../application/services/resources/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import { resources } from "../../../infra/db/schema.ts";
import { and, eq, inArray } from "drizzle-orm";
import { logError } from "../../../shared/utils/logger.ts";
import { getResourceTypeQueryValues } from "../../../application/services/resources/capabilities.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";
import { resolvePostgresUrl } from "../../../node-platform/resolvers/env-utils.ts";

export const d1RouteDeps = {
  getDb,
  getPortableSqlDatabase,
  isPortableResourceBackend,
  createOptionalCloudflareWfpBackend,
  checkResourceAccess,
};

type D1ResourceData = {
  id: string;
  ownerAccountId: string;
  accountId: string | null;
  backendName?: string | null;
  name: string;
  type: string;
  status: string;
  backingResourceId?: string | null;
  backingResourceName?: string | null;
  config: string;
  metadata: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

/**
 * Maximum number of rows returned per table by the SQL export endpoint.
 *
 * The export endpoint materializes the full result set in memory and
 * returns a single JSON response, so it is inherently bounded by Worker
 * memory limits. Rather than streaming (which would force a breaking
 * change to the response shape), we cap per-table row count and instruct
 * callers above the cap to use cursor-based pagination via
 * `GET /:id/{d1,sql}/tables/:tableName`, which already implements
 * `parsePagination` limit/offset.
 *
 * Tables with row count <= cap keep the current response shape and return
 * their full contents.
 */
export const D1_EXPORT_ROW_LIMIT = 100_000;

/**
 * Aggregate cap across **all** tables in a single export request.
 *
 * Per-table cap (`D1_EXPORT_ROW_LIMIT`) alone does not bound the response
 * size when many tables are exported (100k × N can still OOM the worker).
 * This second cap is enforced as a running sum while iterating through the
 * requested tables; once the running total would exceed the cap we abort
 * fast with HTTP 413, telling the caller to reduce the table set or paginate
 * per table. Small exports below both caps continue to work unchanged.
 */
export const D1_EXPORT_AGGREGATE_ROW_LIMIT = 500_000;

/**
 * Enforce the export row cap. Returns the row array unchanged when within
 * the limit, otherwise throws `PayloadTooLargeError` (HTTP 413).
 *
 * Callers should query `LIMIT D1_EXPORT_ROW_LIMIT + 1` so this helper can
 * detect overflow without first materializing an unbounded set.
 */
export function enforceExportRowLimit<T>(
  tableName: string,
  rows: T[],
  limit: number = D1_EXPORT_ROW_LIMIT,
): T[] {
  if (rows.length > limit) {
    throw new PayloadTooLargeError(
      `Export exceeds row limit (${limit}) for table "${tableName}". ` +
        `Use cursor pagination via the table-details endpoint instead.`,
      { table: tableName, limit },
    );
  }
  return rows;
}

/**
 * Enforce the aggregate (cross-table) row cap. Throws `PayloadTooLargeError`
 * (HTTP 413, code `PAYLOAD_TOO_LARGE`) when `runningTotal` exceeds `limit`.
 *
 * This is intended to be called after each per-table fetch with the updated
 * running total, so the export aborts fast rather than continuing to
 * materialize additional tables into a response that is already too large.
 */
export function enforceExportAggregateRowLimit(
  runningTotal: number,
  limit: number = D1_EXPORT_AGGREGATE_ROW_LIMIT,
): void {
  if (runningTotal > limit) {
    throw new PayloadTooLargeError(
      "export aggregate rows exceeded; reduce tables in request or paginate per-table",
      { aggregateLimit: limit, aggregateRows: runningTotal },
    );
  }
}

const READ_ONLY_PREFIXES = new Set(["SELECT", "PRAGMA", "EXPLAIN", "WITH"]);
const MUTATING_SQL_KEYWORD_PATTERN =
  /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|ATTACH|DETACH|VACUUM|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

function stripLeadingSqlComments(sql: string): string {
  let remaining = sql.trim();

  while (remaining.length > 0) {
    if (remaining.startsWith("--")) {
      const nextLineBreak = remaining.indexOf("\n");
      remaining = (nextLineBreak >= 0 ? remaining.slice(nextLineBreak + 1) : "")
        .trimStart();
      continue;
    }

    if (remaining.startsWith("/*")) {
      const commentEnd = remaining.indexOf("*/", 2);
      if (commentEnd < 0) {
        return "";
      }
      remaining = remaining.slice(commentEnd + 2).trimStart();
      continue;
    }

    break;
  }

  return remaining;
}

function maskQuotedSqlLiterals(sql: string): string {
  return sql
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
}

function isReadOnlySql(sql: string): boolean {
  const sqlNoComments = stripLeadingSqlComments(sql);
  const firstWord = sqlNoComments.split(/\s+/)[0]?.toUpperCase() ?? "";
  if (!READ_ONLY_PREFIXES.has(firstWord)) {
    return false;
  }

  const sqlForKeywordScan = maskQuotedSqlLiterals(sqlNoComments);
  return !MUTATING_SQL_KEYWORD_PATTERN.test(sqlForKeywordScan);
}

function toSnakeCaseResource(resourceData: D1ResourceData): Resource {
  return {
    id: resourceData.id,
    owner_id: resourceData.ownerAccountId,
    space_id: resourceData.accountId,
    ...(resourceData.backendName !== undefined
      ? { backend_name: resourceData.backendName }
      : {}),
    name: resourceData.name,
    type: resourceData.type as Resource["type"],
    status: resourceData.status as Resource["status"],
    backing_resource_id: resourceData.backingResourceId ?? null,
    backing_resource_name: resourceData.backingResourceName ?? null,
    config: resourceData.config,
    metadata: resourceData.metadata,
    created_at: textDate(resourceData.createdAt),
    updated_at: textDate(resourceData.updatedAt),
  };
}

async function loadD1ResourceWithAccess(
  c: Context<AuthenticatedRouteEnv>,
  resourceId: string,
  userId: string,
  requiredPermissions?: ResourcePermission[],
): Promise<Resource> {
  const db = d1RouteDeps.getDb(c.env.DB);
  const resourceData = await db.select().from(resources).where(
    and(
      eq(resources.id, resourceId),
      inArray(resources.type, getResourceTypeQueryValues("sql")),
    ),
  ).get();

  if (!resourceData) {
    throw new NotFoundError("SQL resource");
  }

  const resource = toSnakeCaseResource(resourceData);
  const hasAccess = resource.owner_id === userId ||
    await d1RouteDeps.checkResourceAccess(
      c.env.DB,
      resourceId,
      userId,
      requiredPermissions,
    );

  if (!hasAccess) {
    throw new AuthorizationError();
  }

  return resource;
}

async function listPortableTables(resource: Resource) {
  const db = await d1RouteDeps.getPortableSqlDatabase(resource);
  const usePortablePostgres = !!resolvePostgresUrl() &&
    !!resource.backend_name &&
    resource.backend_name !== "cloudflare" &&
    resource.backend_name !== "local";

  if (usePortablePostgres) {
    const tablesResult = await db
      .prepare(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
      )
      .all<{ table_name: string }>();
    const tables = tablesResult.results ?? [];

    return Promise.all(
      tables.map(async ({ table_name: name }: { table_name: string }) => {
        const [columnsResult, countResult] = await Promise.all([
          db.prepare(
            `SELECT
               column_name as name,
               data_type as type,
               is_nullable as nullable
             FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = ?
             ORDER BY ordinal_position`,
          ).bind(name).all<Record<string, unknown>>(),
          db.prepare(`SELECT COUNT(*) as count FROM "${name}"`).first<
            { count?: number }
          >("count"),
        ]);
        return {
          name,
          columns: columnsResult.results ?? [],
          row_count: Number(countResult ?? 0),
        };
      }),
    );
  }

  const tablesResult = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all<{ name: string }>();
  const tables = tablesResult.results ?? [];

  return Promise.all(
    tables.map(async ({ name }: { name: string }) => {
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, "");
      const [columnsResult, countResult] = await Promise.all([
        db.prepare(`PRAGMA table_info(${safeName})`).all<
          Record<string, unknown>
        >(),
        db.prepare(`SELECT COUNT(*) as count FROM ${safeName}`).first<
          { count?: number }
        >("count"),
      ]);
      return {
        name: safeName,
        columns: columnsResult.results ?? [],
        row_count: Number(countResult ?? 0),
      };
    }),
  );
}

async function listTablesHandler(c: Context<AuthenticatedRouteEnv>) {
  const user = c.get("user");
  const resourceId = c.req.param("id");
  if (!resourceId) {
    throw new BadRequestError("Resource ID is required");
  }
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id);

  if (d1RouteDeps.isPortableResourceBackend(resource.backend_name)) {
    try {
      const tables = await listPortableTables(resource);
      return c.json({ tables });
    } catch (err) {
      if (isAppError(err)) throw err;
      logError("Failed to list portable SQL tables", err, {
        module: "routes/resources/d1",
      });
      throw new InternalError("Failed to list tables");
    }
  }

  const databaseId = resource.backing_resource_id;
  if (!databaseId) {
    throw new BadRequestError("SQL database not provisioned");
  }

  try {
    const wfp = d1RouteDeps.createOptionalCloudflareWfpBackend(c.env);
    if (!wfp) {
      throw new InternalError("platform backend not configured");
    }
    const tables = await wfp.d1.listD1Tables(databaseId);

    const tablesWithInfo = await Promise.all(
      tables.map(async (t: { name: string }) => {
        try {
          const [columns, count] = await Promise.all([
            wfp.d1.getD1TableInfo(databaseId, t.name),
            wfp.d1.getD1TableCount(databaseId, t.name),
          ]);
          return {
            name: t.name,
            columns,
            row_count: count,
          };
        } catch {
          return { name: t.name, columns: [], row_count: 0 };
        }
      }),
    );

    return c.json({ tables: tablesWithInfo });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError("Failed to list SQL tables", err, {
      module: "routes/resources/d1",
    });
    throw new InternalError("Failed to list tables");
  }
}

async function tableDetailsHandler(c: Context<AuthenticatedRouteEnv>) {
  const user = c.get("user");
  const resourceId = c.req.param("id");
  const tableName = c.req.param("tableName");
  if (!resourceId) {
    throw new BadRequestError("Resource ID is required");
  }
  if (!tableName) {
    throw new BadRequestError("Table name is required");
  }
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id);
  const { limit, offset } = parsePagination(c.req.query(), {
    limit: 50,
    maxLimit: 1000,
  });
  const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, "");
  if (safeName !== tableName) {
    throw new BadRequestError("Invalid table name");
  }

  if (d1RouteDeps.isPortableResourceBackend(resource.backend_name)) {
    try {
      const db = await d1RouteDeps.getPortableSqlDatabase(resource);
      const usePortablePostgres = !!resolvePostgresUrl() &&
        !!resource.backend_name &&
        resource.backend_name !== "cloudflare" &&
        resource.backend_name !== "local";

      if (usePortablePostgres) {
        const [columnsResult, countValue, rowsResult] = await Promise.all([
          db.prepare(
            `SELECT
               column_name as name,
               data_type as type,
               is_nullable as nullable
             FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = ?
             ORDER BY ordinal_position`,
          ).bind(safeName).all<Record<string, unknown>>(),
          db.prepare(`SELECT COUNT(*) as count FROM "${safeName}"`).first<
            number
          >("count"),
          db.prepare(
            `SELECT * FROM "${safeName}" LIMIT ${limit} OFFSET ${offset}`,
          ).all<Record<string, unknown>>(),
        ]);

        return c.json({
          table: safeName,
          columns: columnsResult.results ?? [],
          rows: rowsResult.results ?? [],
          total_count: Number(countValue ?? 0),
          limit,
          offset,
        });
      }

      const [columnsResult, countValue, rowsResult] = await Promise.all([
        db.prepare(`PRAGMA table_info(${safeName})`).all<
          Record<string, unknown>
        >(),
        db.prepare(`SELECT COUNT(*) as count FROM ${safeName}`).first<number>(
          "count",
        ),
        db.prepare(`SELECT * FROM ${safeName} LIMIT ${limit} OFFSET ${offset}`)
          .all<Record<string, unknown>>(),
      ]);

      return c.json({
        table: safeName,
        columns: columnsResult.results ?? [],
        rows: rowsResult.results ?? [],
        total_count: Number(countValue ?? 0),
        limit,
        offset,
      });
    } catch (err) {
      if (isAppError(err)) throw err;
      logError("Failed to get portable table data", err, {
        module: "routes/resources/d1",
      });
      throw new InternalError("Failed to get table data");
    }
  }

  const databaseId = resource.backing_resource_id;
  if (!databaseId) {
    throw new BadRequestError("SQL database not provisioned");
  }

  try {
    const wfp = d1RouteDeps.createOptionalCloudflareWfpBackend(c.env);
    if (!wfp) {
      throw new InternalError("platform backend not configured");
    }

    const [columns, count, rowsResult] = await Promise.all([
      wfp.d1.getD1TableInfo(databaseId, safeName),
      wfp.d1.getD1TableCount(databaseId, safeName),
      wfp.d1.runD1SQL(
        databaseId,
        `SELECT * FROM ${safeName} LIMIT ${limit} OFFSET ${offset}`,
      ),
    ]);

    if (!Array.isArray(rowsResult) || !rowsResult[0]?.results) {
      throw new InternalError("Invalid response from SQL backend");
    }

    return c.json({
      table: safeName,
      columns,
      rows: rowsResult[0].results,
      total_count: count,
      limit,
      offset,
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError("Failed to get table data", err, {
      module: "routes/resources/d1",
    });
    throw new InternalError("Failed to get table data");
  }
}

async function queryHandler(c: Context<AuthenticatedRouteEnv>) {
  const user = c.get("user");
  const resourceId = c.req.param("id");
  if (!resourceId) {
    throw new BadRequestError("Resource ID is required");
  }
  const body = await parseJsonBody<{ sql?: string }>(c);

  if (!body?.sql?.trim()) {
    throw new BadRequestError("SQL query is required");
  }

  const sqlTrimmed = body.sql.trim();
  const isReadOnly = isReadOnlySql(sqlTrimmed);
  const requiredPermissions: ResourcePermission[] | undefined = isReadOnly
    ? undefined
    : ["write", "admin"];
  const resource = await loadD1ResourceWithAccess(
    c,
    resourceId,
    user.id,
    requiredPermissions,
  );

  if (d1RouteDeps.isPortableResourceBackend(resource.backend_name)) {
    try {
      const db = await d1RouteDeps.getPortableSqlDatabase(resource);
      const statement = db.prepare(body.sql);
      const result = isReadOnly
        ? await statement.all<Record<string, unknown>>()
        : await statement.run<Record<string, unknown>>();
      return c.json({ result: [result] });
    } catch (err) {
      if (isAppError(err)) throw err;
      logError("Failed to execute portable SQL", err, {
        module: "routes/resources/d1",
      });
      throw new InternalError("SQL execution failed");
    }
  }

  const databaseId = resource.backing_resource_id;
  if (!databaseId) {
    throw new BadRequestError("SQL database not provisioned");
  }

  try {
    const wfp = d1RouteDeps.createOptionalCloudflareWfpBackend(c.env);
    if (!wfp) {
      throw new InternalError("platform backend not configured");
    }
    const result = await wfp.d1.runD1SQL(databaseId, body.sql);
    return c.json({ result });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError("Failed to execute SQL", err, { module: "routes/resources/d1" });
    throw new InternalError("SQL execution failed");
  }
}

/**
 * Export all rows from one or more tables as a single JSON response.
 *
 * NOTE: Bounded by `D1_EXPORT_ROW_LIMIT` per table **and**
 * `D1_EXPORT_AGGREGATE_ROW_LIMIT` across all tables to prevent worker OOM
 * (the response is materialized in memory, not streamed). Tables that
 * exceed the per-table cap, or requests whose running aggregate exceeds
 * the cross-table cap, cause a 413 `PayloadTooLargeError`; the caller is
 * expected to fall back to cursor pagination via the table-details
 * endpoint (which already implements `parsePagination` limit/offset) or
 * to reduce the table set in the export request.
 *
 * Requests with row counts below both caps keep the current response
 * shape and contents.
 */
async function exportHandler(c: Context<AuthenticatedRouteEnv>) {
  const user = c.get("user");
  const resourceId = c.req.param("id");
  if (!resourceId) {
    throw new BadRequestError("Resource ID is required");
  }
  const body = await parseJsonBody<{ tables?: string[] }>(c);
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id, [
    "read",
  ]);

  // Probe LIMIT+1 so overflow is detected without materializing an
  // unbounded result set.
  const probeLimit = D1_EXPORT_ROW_LIMIT + 1;

  if (d1RouteDeps.isPortableResourceBackend(resource.backend_name)) {
    try {
      const db = await d1RouteDeps.getPortableSqlDatabase(resource);
      const tableRows = body?.tables && body.tables.length > 0
        ? body.tables
        : (await listPortableTables(resource)).map((table: { name: string }) =>
          table.name
        );

      const tables: Record<string, unknown[]> = {};
      let aggregateRows = 0;
      for (const table of tableRows) {
        const safeName = String(table).replace(/[^a-zA-Z0-9_]/g, "");
        const result = await db.prepare(
          `SELECT * FROM ${safeName} LIMIT ${probeLimit}`,
        ).all<Record<string, unknown>>();
        const rows = enforceExportRowLimit(safeName, result.results ?? []);
        aggregateRows += rows.length;
        enforceExportAggregateRowLimit(aggregateRows);
        tables[safeName] = rows;
      }

      return c.json({
        database: resource.name,
        tables,
      });
    } catch (err) {
      if (isAppError(err)) throw err;
      logError("Failed to export portable SQL resource", err, {
        module: "routes/resources/d1",
      });
      throw new InternalError("Export failed");
    }
  }

  const databaseId = resource.backing_resource_id;
  if (!databaseId) {
    throw new BadRequestError("SQL database not provisioned");
  }

  try {
    const wfp = d1RouteDeps.createOptionalCloudflareWfpBackend(c.env);
    if (!wfp) {
      throw new InternalError("platform backend not configured");
    }
    const tableRows = body?.tables && body.tables.length > 0
      ? body.tables
      : (await wfp.d1.listD1Tables(databaseId)).map((t: { name: string }) =>
        t.name
      );

    const tables: Record<string, unknown[]> = {};
    let aggregateRows = 0;
    for (const table of tableRows) {
      const safeName = String(table).replace(/[^a-zA-Z0-9_]/g, "");
      const result = await wfp.d1.runD1SQL(
        databaseId,
        `SELECT * FROM ${safeName} LIMIT ${probeLimit}`,
      );
      if (!Array.isArray(result) || !result[0]?.results) {
        continue;
      }
      const rows = enforceExportRowLimit(safeName, result[0].results);
      aggregateRows += rows.length;
      enforceExportAggregateRowLimit(aggregateRows);
      tables[safeName] = rows;
    }

    return c.json({
      database: resource.name,
      tables,
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError("Failed to export SQL resource", err, {
      module: "routes/resources/d1",
    });
    throw new InternalError("Export failed");
  }
}

const resourcesD1 = new Hono<AuthenticatedRouteEnv>()
  .get("/:id/d1/tables", listTablesHandler)
  .get("/:id/sql/tables", listTablesHandler)
  .get("/:id/d1/tables/:tableName", tableDetailsHandler)
  .get("/:id/sql/tables/:tableName", tableDetailsHandler)
  .post(
    "/:id/d1/query",
    zValidator(
      "json",
      z.object({
        sql: z.string(),
      }),
    ),
    queryHandler,
  )
  .post(
    "/:id/sql/query",
    zValidator(
      "json",
      z.object({
        sql: z.string(),
      }),
    ),
    queryHandler,
  )
  .post("/:id/d1/export", exportHandler)
  .post("/:id/sql/export", exportHandler);

export default resourcesD1;
