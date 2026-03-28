import { Hono } from 'hono';
import { z } from 'zod';
import type { Resource } from '../../../shared/types';
import { parseLimit, type AuthenticatedRouteEnv } from '../shared/route-auth';
import { BadRequestError } from 'takos-common/errors';
import { zValidator } from '../zod-validator';
import { createOptionalCloudflareWfpProvider } from '../../../platform/providers/cloudflare/wfp.ts';
import { checkResourceAccess } from '../../../application/services/resources';
import { AuthorizationError, NotFoundError, InternalError } from 'takos-common/errors';
import { getDb } from '../../../infra/db';
import { resources } from '../../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { logError } from '../../../shared/utils/logger';

function toResource(data: {
  id: string;
  ownerAccountId: string;
  accountId: string | null;
  name: string;
  type: string;
  status: string;
  cfId: string | null;
  cfName: string | null;
  config: string | null;
  metadata: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}): Resource {
  const createdAt = typeof data.createdAt === 'string' ? data.createdAt : data.createdAt.toISOString();
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : data.updatedAt.toISOString();
  return {
    id: data.id,
    owner_id: data.ownerAccountId,
    space_id: data.accountId,
    name: data.name,
    type: data.type as Resource['type'],
    status: data.status as Resource['status'],
    cf_id: data.cfId,
    cf_name: data.cfName,
    config: data.config ?? '{}',
    metadata: data.metadata ?? '{}',
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

const resourcesR2 = new Hono<AuthenticatedRouteEnv>()

.get('/:id/r2/objects',
  zValidator('query', z.object({
    prefix: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.string().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const db = getDb(c.env.DB);

  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('R2 resource');
  }

  const resource = toResource(resourceData);

  const hasAccess = resource.owner_id === user.id || await checkResourceAccess(c.env.DB, resourceId, user.id);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  if (!resource.cf_name) {
    throw new BadRequestError( 'R2 bucket not provisioned');
  }

  const prefix = c.req.query('prefix') || undefined;
  const cursor = c.req.query('cursor') || undefined;
  const limit = parseLimit(c.req.query('limit'), 100, 1000);

  try {
    const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const result = await wfp.r2.listR2Objects(resource.cf_name, {
      prefix,
      cursor,
      limit,
    });

    return c.json({
      objects: result.objects,
      truncated: result.truncated,
      cursor: result.cursor,
    });
  } catch (err) {
    logError('Failed to list R2 objects', err, { module: 'routes/resources/r2' });
    throw new InternalError('Failed to list objects');
  }
})

.get('/:id/r2/stats', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const db = getDb(c.env.DB);

  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('R2 resource');
  }

  const resource = toResource(resourceData);

  const hasAccess = resource.owner_id === user.id || await checkResourceAccess(c.env.DB, resourceId, user.id);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  if (!resource.cf_name) {
    throw new BadRequestError( 'R2 bucket not provisioned');
  }

  try {
    const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const stats = await wfp.r2.getR2BucketStats(resource.cf_name);

    return c.json({ stats });
  } catch (err) {
    logError('Failed to get R2 stats', err, { module: 'routes/resources/r2' });
    throw new InternalError('Failed to get stats');
  }
})

.delete('/:id/r2/objects/:key', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const key = decodeURIComponent(c.req.param('key'));
  const db = getDb(c.env.DB);

  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('R2 resource');
  }

  const resource = toResource(resourceData);

  const hasAccess = resource.owner_id === user.id || await checkResourceAccess(c.env.DB, resourceId, user.id, ['write', 'admin']);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  if (!resource.cf_name) {
    throw new BadRequestError( 'R2 bucket not provisioned');
  }

  try {
    const wfp = createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    await wfp.r2.deleteR2Object(resource.cf_name, key);
    return c.json({ success: true });
  } catch (err) {
    logError('Failed to delete R2 object', err, { module: 'routes/resources/r2' });
    throw new InternalError('Failed to delete object');
  }
});

export default resourcesR2;
