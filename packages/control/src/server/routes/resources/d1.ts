import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Resource, ResourcePermission } from '../../../shared/types';
import { parseJsonBody, parseLimit, parseOffset, type AuthenticatedRouteEnv } from '../shared/route-auth';
import { BadRequestError, NotFoundError, AuthorizationError, InternalError, isAppError } from '@takos/common/errors';
import { zValidator } from '../zod-validator';
import { createOptionalCloudflareWfpProvider } from '../../../platform/providers/cloudflare/wfp.ts';
import { checkResourceAccess } from '../../../application/services/resources';
import { toIsoString } from '../../../shared/utils';
import { getDb } from '../../../infra/db';
import { resources } from '../../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { logError } from '../../../shared/utils/logger';

type D1ResourceData = {
  id: string;
  ownerAccountId: string;
  accountId: string | null;
  name: string;
  type: string;
  status: string;
  cfId: string | null;
  cfName: string | null;
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
    name: resourceData.name,
    type: resourceData.type as Resource['type'],
    status: resourceData.status as Resource['status'],
    cf_id: resourceData.cfId,
    cf_name: resourceData.cfName,
    config: resourceData.config,
    metadata: resourceData.metadata,
    created_at: toIsoString(resourceData.createdAt),
    updated_at: toIsoString(resourceData.updatedAt),
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
    and(eq(resources.id, resourceId), eq(resources.type, 'd1'))
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

const resourcesD1 = new Hono<AuthenticatedRouteEnv>()

.get('/:id/d1/tables', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id);

  if (!resource.cf_id) {
    throw new BadRequestError( 'D1 database not provisioned');
  }

  try {
  const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const tables = await wfp.d1.listD1Tables(resource.cf_id);

    const tablesWithInfo = await Promise.all(
      tables.map(async (t: { name: string }) => {
        try {
          const [columns, count] = await Promise.all([
            wfp.d1.getD1TableInfo(resource.cf_id!, t.name),
            wfp.d1.getD1TableCount(resource.cf_id!, t.name),
          ]);
          return {
            name: t.name,
            columns,
            row_count: count,
          };
        } catch {
          // Table introspection failed (e.g. dropped mid-listing); return empty metadata
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
})

.get('/:id/d1/tables/:tableName', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const tableName = c.req.param('tableName');
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id);

  if (!resource.cf_id) {
    throw new BadRequestError( 'D1 database not provisioned');
  }

  const limit = parseLimit(c.req.query('limit'), 50, 1000);
  const offset = parseOffset(c.req.query('offset'));

  try {
    const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }

    const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
    if (safeName !== tableName) {
      throw new BadRequestError( 'Invalid table name');
    }

    const [columns, count, rowsResult] = await Promise.all([
      wfp.d1.getD1TableInfo(resource.cf_id, safeName),
      wfp.d1.getD1TableCount(resource.cf_id, safeName),
      wfp.d1.runD1SQL(resource.cf_id, `SELECT * FROM ${safeName} LIMIT ${limit} OFFSET ${offset}`),
    ]);

    // Validate WFP response structure
    if (!Array.isArray(rowsResult) || !rowsResult[0]?.results) {
      throw new InternalError('Invalid response from D1');
    }
    const rows = rowsResult[0].results;

    return c.json({
      table: safeName,
      columns,
      rows,
      total_count: count,
      limit,
      offset,
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to get table data', err, { module: 'routes/resources/d1' });
    throw new InternalError('Failed to get table data');
  }
})

.post('/:id/d1/query',
  zValidator('json', z.object({
    sql: z.string(),
  })),
  async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const body = c.req.valid('json');

  if (!body.sql?.trim()) {
    throw new BadRequestError( 'SQL query is required');
  }

  const sqlTrimmed = body.sql.trim();
  const isReadOnly = isReadOnlySql(sqlTrimmed);
  const requiredPermissions: ResourcePermission[] | undefined = isReadOnly ? undefined : ['write', 'admin'];
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id, requiredPermissions);

  if (!resource.cf_id) {
    throw new BadRequestError( 'D1 database not provisioned');
  }

  try {
    const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const result = await wfp.d1.runD1SQL(resource.cf_id, body.sql);

    return c.json({ result });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to execute SQL', err, { module: 'routes/resources/d1' });
    throw new InternalError('SQL execution failed');
  }
})

.post('/:id/d1/export', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const body = await parseJsonBody<{ tables?: string[] }>(c);
  const resource = await loadD1ResourceWithAccess(c, resourceId, user.id, ['read']);

  if (!resource.cf_id) {
    throw new BadRequestError( 'D1 database not provisioned');
  }

  try {
    const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const tableRows = body?.tables && body.tables.length > 0
      ? body.tables
      : (await wfp.d1.listD1Tables(resource.cf_id)).map((t: { name: string }) => t.name);

    const tables: Record<string, unknown[]> = {};
    for (const table of tableRows) {
      const safeName = String(table).replace(/[^a-zA-Z0-9_]/g, '');
      const result = await wfp.d1.runD1SQL(resource.cf_id, `SELECT * FROM ${safeName}`);
      // Validate WFP response structure
      if (!Array.isArray(result) || !result[0]?.results) {
        continue; // Skip tables with invalid response
      }
      const rows = result[0].results;
      tables[safeName] = rows;
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
});

export default resourcesD1;
