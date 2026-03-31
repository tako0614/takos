import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { Resource, ResourcePermission } from '../../../shared/types';
import { type AuthenticatedRouteEnv, parseJsonBody } from '../route-auth';
import { parsePagination } from '../../../shared/utils';
import { AuthorizationError, BadRequestError, InternalError, NotFoundError, isAppError } from 'takos-common/errors';
import { zValidator } from '../zod-validator';
import { createOptionalCloudflareWfpProvider } from '../../../platform/providers/cloudflare/wfp.ts';
import { getPortableSqlDatabase, isPortableResourceProvider } from './portable-runtime.ts';
import { checkResourceAccess } from '../../../application/services/resources';
import { getDb } from '../../../infra/db';
import { resources } from '../../../infra/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { logError } from '../../../shared/utils/logger';
import { getResourceTypeQueryValues } from '../../../application/services/resources/capabilities';
import { textDate } from '../../../shared/utils/db-guards';
import { resolvePostgresUrl } from '../../../node-platform/resolvers/env-utils.ts';

type D1ResourceData = {
  id: string;
  ownerAccountId: string;
  accountId: string | null;
  providerName?: string | null;
  name: string;
  type: string;
  status: string;
  providerResourceId?: string | null;
  providerResourceName?: string | null;
  config: string;
  metadata: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

const READ_ONLY_PREFIXES = new Set(['SELECT', 'PRAGMA', 'EXPLAIN', 'WITH']);
const MUTATING_SQL_KEYWORD_PATTERN =
  /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|TRUNCATE|ATTACH|DETACH|VACUUM|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;

function stripLeadingSqlComments(sql: string): string {
  let remaining = sql.trim();

  while (remaining.length > 0) {
    if (remaining.startsWith('--')) {
      const nextLineBreak = remaining.indexOf('\n');
      remaining = (nextLineBreak >= 0 ? remaining.slice(nextLineBreak + 1) : '').trimStart();
      continue;
    }

    if (remaining.startsWith('/*')) {
      const commentEnd = remaining.indexOf('*/', 2);
      if (commentEnd < 0) {
        return '';
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
  const firstWord = sqlNoComments.split(/\s+/)[0]?.toUpperCase() ?? '';
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
    ...(resourceData.providerName !== undefined ? { provider_name: resourceData.providerName } : {}),
    name: resourceData.name,
    type: resourceData.type as Resource['type'],
    status: resourceData.status as Resource['status'],
    provider_resource_id: resourceData.providerResourceId ?? null,
    provider_resource_name: resourceData.providerResourceName ?? null,
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
  requiredPermissions?: ResourcePermission[]
): Promise<Resource> {
  const db = getDb(c.env.DB);
  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), inArray(resources.type, getResourceTypeQueryValues('sql')))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('D1 resource');
  }

  const resource = toSnakeCaseResource(resourceData);
  const hasAccess = resource.owner_id === userId ||
    await checkResourceAccess(c.env.DB, resourceId, userId, requiredPermissions);

  if (!hasAccess) {
    throw new AuthorizationError();
  }

  return resource;
}

async function listPortableTables(resource: Resource) {
  const db = await getPortableSqlDatabase(resource);
  const usePortablePostgres =
    !!resolvePostgresUrl()
    && !!resource.provider_name
    && resource.provider_name !== 'cloudflare'
    && resource.provider_name !== 'local';

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
      tables.map(async ({ table_name: name }) => {
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
          db.prepare(`SELECT COUNT(*) as count FROM "${name}"`).first<{ count?: number }>('count'),
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
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all<{ name: string }>();
  const tables = tablesResult.results ?? [];

  return Promise.all(
    tables.map(async ({ name }) => {
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, '');
      const [columnsResult, countResult] = await Promise.all([
        db.prepare(`PRAGMA table_info(${safeName})`).all<Record<string, unknown>>(),
        db.prepare(`SELECT COUNT(*) as count FROM ${safeName}`).first<{ count?: number }>('count'),
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
  const user = c.get('user');
  const resourceId = c.req.param('id');
  if (!resourceId) {
    throw new BadRequestError('Resource ID is required');
  }
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id);

  if (isPortableResourceProvider(resource.provider_name)) {
    try {
      const tables = await listPortableTables(resource);
      return c.json({ tables });
    } catch (err) {
      if (isAppError(err)) throw err;
      logError('Failed to list portable SQL tables', err, { module: 'routes/resources/d1' });
      throw new InternalError('Failed to list tables');
    }
  }

  const databaseId = resource.provider_resource_id;
  if (!databaseId) {
    throw new BadRequestError('D1 database not provisioned');
  }

  try {
    const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
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
      })
    );

    return c.json({ tables: tablesWithInfo });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to list D1 tables', err, { module: 'routes/resources/d1' });
    throw new InternalError('Failed to list tables');
  }
}

async function tableDetailsHandler(c: Context<AuthenticatedRouteEnv>) {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const tableName = c.req.param('tableName');
  if (!resourceId) {
    throw new BadRequestError('Resource ID is required');
  }
  if (!tableName) {
    throw new BadRequestError('Table name is required');
  }
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id);
  const { limit, offset } = parsePagination(c.req.query(), { limit: 50, maxLimit: 1000 });
  const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
  if (safeName !== tableName) {
    throw new BadRequestError('Invalid table name');
  }

  if (isPortableResourceProvider(resource.provider_name)) {
    try {
      const db = await getPortableSqlDatabase(resource);
      const usePortablePostgres =
        !!resolvePostgresUrl()
        && !!resource.provider_name
        && resource.provider_name !== 'cloudflare'
        && resource.provider_name !== 'local';

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
          db.prepare(`SELECT COUNT(*) as count FROM "${safeName}"`).first<number>('count'),
          db.prepare(`SELECT * FROM "${safeName}" LIMIT ${limit} OFFSET ${offset}`).all<Record<string, unknown>>(),
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
        db.prepare(`PRAGMA table_info(${safeName})`).all<Record<string, unknown>>(),
        db.prepare(`SELECT COUNT(*) as count FROM ${safeName}`).first<number>('count'),
        db.prepare(`SELECT * FROM ${safeName} LIMIT ${limit} OFFSET ${offset}`).all<Record<string, unknown>>(),
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
      logError('Failed to get portable table data', err, { module: 'routes/resources/d1' });
      throw new InternalError('Failed to get table data');
    }
  }

  const databaseId = resource.provider_resource_id;
  if (!databaseId) {
    throw new BadRequestError('D1 database not provisioned');
  }

  try {
    const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }

    const [columns, count, rowsResult] = await Promise.all([
      wfp.d1.getD1TableInfo(databaseId, safeName),
      wfp.d1.getD1TableCount(databaseId, safeName),
      wfp.d1.runD1SQL(databaseId, `SELECT * FROM ${safeName} LIMIT ${limit} OFFSET ${offset}`),
    ]);

    if (!Array.isArray(rowsResult) || !rowsResult[0]?.results) {
      throw new InternalError('Invalid response from D1');
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
    logError('Failed to get table data', err, { module: 'routes/resources/d1' });
    throw new InternalError('Failed to get table data');
  }
}

async function queryHandler(c: Context<AuthenticatedRouteEnv>) {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  if (!resourceId) {
    throw new BadRequestError('Resource ID is required');
  }
  const body = await parseJsonBody<{ sql?: string }>(c);

  if (!body?.sql?.trim()) {
    throw new BadRequestError('SQL query is required');
  }

  const sqlTrimmed = body.sql.trim();
  const isReadOnly = isReadOnlySql(sqlTrimmed);
  const requiredPermissions: ResourcePermission[] | undefined = isReadOnly ? undefined : ['write', 'admin'];
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id, requiredPermissions);

  if (isPortableResourceProvider(resource.provider_name)) {
    try {
      const db = await getPortableSqlDatabase(resource);
      const statement = db.prepare(body.sql);
      const result = isReadOnly
        ? await statement.all<Record<string, unknown>>()
        : await statement.run<Record<string, unknown>>();
      return c.json({ result: [result] });
    } catch (err) {
      if (isAppError(err)) throw err;
      logError('Failed to execute portable SQL', err, { module: 'routes/resources/d1' });
      throw new InternalError('SQL execution failed');
    }
  }

  const databaseId = resource.provider_resource_id;
  if (!databaseId) {
    throw new BadRequestError('D1 database not provisioned');
  }

  try {
    const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const result = await wfp.d1.runD1SQL(databaseId, body.sql);
    return c.json({ result });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to execute SQL', err, { module: 'routes/resources/d1' });
    throw new InternalError('SQL execution failed');
  }
}

async function exportHandler(c: Context<AuthenticatedRouteEnv>) {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  if (!resourceId) {
    throw new BadRequestError('Resource ID is required');
  }
  const body = await parseJsonBody<{ tables?: string[] }>(c);
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id, ['read']);

  if (isPortableResourceProvider(resource.provider_name)) {
    try {
      const db = await getPortableSqlDatabase(resource);
      const tableRows = body?.tables && body.tables.length > 0
        ? body.tables
        : (await listPortableTables(resource)).map((table) => table.name);

      const tables: Record<string, unknown[]> = {};
      for (const table of tableRows) {
        const safeName = String(table).replace(/[^a-zA-Z0-9_]/g, '');
        const result = await db.prepare(`SELECT * FROM ${safeName}`).all<Record<string, unknown>>();
        tables[safeName] = result.results ?? [];
      }

      return c.json({
        database: resource.name,
        tables,
      });
    } catch (err) {
      if (isAppError(err)) throw err;
      logError('Failed to export portable SQL resource', err, { module: 'routes/resources/d1' });
      throw new InternalError('Export failed');
    }
  }

  const databaseId = resource.provider_resource_id;
  if (!databaseId) {
    throw new BadRequestError('D1 database not provisioned');
  }

  try {
    const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const tableRows = body?.tables && body.tables.length > 0
      ? body.tables
      : (await wfp.d1.listD1Tables(databaseId)).map((t: { name: string }) => t.name);

    const tables: Record<string, unknown[]> = {};
    for (const table of tableRows) {
      const safeName = String(table).replace(/[^a-zA-Z0-9_]/g, '');
      const result = await wfp.d1.runD1SQL(databaseId, `SELECT * FROM ${safeName}`);
      if (!Array.isArray(result) || !result[0]?.results) {
        continue;
      }
      tables[safeName] = result[0].results;
    }

    return c.json({
      database: resource.name,
      tables,
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to export D1', err, { module: 'routes/resources/d1' });
    throw new InternalError('Export failed');
  }
}

const resourcesD1 = new Hono<AuthenticatedRouteEnv>()
.get('/:id/d1/tables', listTablesHandler)
.get('/:id/sql/tables', listTablesHandler)

.get('/:id/d1/tables/:tableName', tableDetailsHandler)
.get('/:id/sql/tables/:tableName', tableDetailsHandler)

.post('/:id/d1/query',
  zValidator('json', z.object({
    sql: z.string(),
  })),
  queryHandler)

.post('/:id/sql/query',
  zValidator('json', z.object({
    sql: z.string(),
  })),
  queryHandler)

.post('/:id/d1/export', exportHandler)
.post('/:id/sql/export', exportHandler);

export default resourcesD1;
