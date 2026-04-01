import { Hono } from 'hono';
import { z } from 'zod';
import type { Resource } from '../../../shared/types/index.ts';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import { parsePagination } from '../../../shared/utils/index.ts';
import { BadRequestError } from 'takos-common/errors';
import { zValidator } from '../zod-validator.ts';
import { createOptionalCloudflareWfpProvider } from '../../../platform/providers/cloudflare/wfp.ts';
import { getPortableObjectStore, isPortableResourceProvider } from './portable-runtime.ts';
import { checkResourceAccess } from '../../../application/services/resources/index.ts';
import { AuthorizationError, NotFoundError, InternalError } from 'takos-common/errors';
import { getDb } from '../../../infra/db/index.ts';
import { resources } from '../../../infra/db/schema.ts';
import { eq, and } from 'drizzle-orm';
import { logError } from '../../../shared/utils/logger.ts';
import { textDate } from '../../../shared/utils/db-guards.ts';
import type { R2Bucket, R2Object, R2ObjectBody } from '../../../shared/types/bindings.ts';

export const r2RouteDeps = {
  getDb,
  getPortableObjectStore,
  isPortableResourceProvider,
  createOptionalCloudflareWfpProvider,
  checkResourceAccess,
};

function toResource(data: {
  id: string;
  ownerAccountId: string;
  accountId: string | null;
  providerName?: string | null;
  name: string;
  type: string;
  status: string;
  providerResourceId: string | null;
  providerResourceName: string | null;
  config: string | null;
  metadata: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}): Resource {
  const createdAt = textDate(data.createdAt);
  const updatedAt = textDate(data.updatedAt);
  return {
    id: data.id,
    owner_id: data.ownerAccountId,
    space_id: data.accountId,
    ...(data.providerName !== undefined ? { provider_name: data.providerName } : {}),
    name: data.name,
    type: data.type as Resource['type'],
    status: data.status as Resource['status'],
    provider_resource_id: data.providerResourceId,
    provider_resource_name: data.providerResourceName,
    config: data.config ?? '{}',
    metadata: data.metadata ?? '{}',
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

async function listAllObjects(bucket: R2Bucket) {
  const objects: R2Object[] = [];
  let cursor: string | undefined;

  do {
    const page = await bucket.list({ limit: 1000, cursor });
    objects.push(...(page.objects ?? []));
    cursor = page.truncated && 'cursor' in page ? page.cursor : undefined;
  } while (cursor);

  return objects;
}

function getR2ListCursor(result: Awaited<ReturnType<R2Bucket['list']>>): string | null {
  return result.truncated && 'cursor' in result ? result.cursor ?? null : null;
}

function getPortableObjectContentType(object: R2ObjectBody): string | null {
  const metadata = object.httpMetadata;
  if (metadata && typeof metadata === 'object' && 'contentType' in metadata) {
    const contentType = metadata.contentType;
    return typeof contentType === 'string' ? contentType : null;
  }
  if (typeof object.writeHttpMetadata === 'function') {
    const headers = new Headers();
    object.writeHttpMetadata(headers as unknown as Parameters<NonNullable<R2ObjectBody['writeHttpMetadata']>>[0]);
    return headers.get('content-type');
  }
  return null;
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
  const db = r2RouteDeps.getDb(c.env.DB);

  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('R2 resource');
  }

  const resource = toResource(resourceData);

  const hasAccess = resource.owner_id === user.id || await r2RouteDeps.checkResourceAccess(c.env.DB, resourceId, user.id);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  const prefix = c.req.query('prefix') || undefined;
  const cursor = c.req.query('cursor') || undefined;
  const { limit } = parsePagination(c.req.query(), { limit: 100, maxLimit: 1000 });

  if (r2RouteDeps.isPortableResourceProvider(resource.provider_name)) {
    try {
      const bucket = r2RouteDeps.getPortableObjectStore(resource);
      const result = await bucket.list({
        prefix,
        cursor,
        limit,
      });
      return c.json({
        objects: result.objects ?? [],
        truncated: result.truncated ?? false,
        cursor: getR2ListCursor(result),
      });
    } catch (err) {
      logError('Failed to list portable objects', err, { module: 'routes/resources/r2' });
      throw new InternalError('Failed to list objects');
    }
  }

  if (!resource.provider_resource_name) {
    throw new BadRequestError( 'R2 bucket not provisioned');
  }

  try {
    const wfp = r2RouteDeps.createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const result = await wfp.r2.listR2Objects(resource.provider_resource_name, {
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

.get('/:id/objects',
  zValidator('query', z.object({
    prefix: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.string().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const db = r2RouteDeps.getDb(c.env.DB);

  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('R2 resource');
  }

  const resource = toResource(resourceData);

  const hasAccess = resource.owner_id === user.id || await r2RouteDeps.checkResourceAccess(c.env.DB, resourceId, user.id);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  const prefix = c.req.query('prefix') || undefined;
  const cursor = c.req.query('cursor') || undefined;
  const { limit } = parsePagination(c.req.query(), { limit: 100, maxLimit: 1000 });

  if (r2RouteDeps.isPortableResourceProvider(resource.provider_name)) {
    try {
      const bucket = r2RouteDeps.getPortableObjectStore(resource);
      const result = await bucket.list({
        prefix,
        cursor,
        limit,
      });
      return c.json({
        objects: result.objects ?? [],
        truncated: result.truncated ?? false,
        cursor: getR2ListCursor(result),
      });
    } catch (err) {
      logError('Failed to list portable objects', err, { module: 'routes/resources/r2' });
      throw new InternalError('Failed to list objects');
    }
  }

  if (!resource.provider_resource_name) {
    throw new BadRequestError( 'R2 bucket not provisioned');
  }

  try {
    const wfp = r2RouteDeps.createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const result = await wfp.r2.listR2Objects(resource.provider_resource_name, {
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
  const db = r2RouteDeps.getDb(c.env.DB);

  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('R2 resource');
  }

  const resource = toResource(resourceData);

  const hasAccess = resource.owner_id === user.id || await r2RouteDeps.checkResourceAccess(c.env.DB, resourceId, user.id);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  if (r2RouteDeps.isPortableResourceProvider(resource.provider_name)) {
    try {
      const bucket = r2RouteDeps.getPortableObjectStore(resource);
      const objects = await listAllObjects(bucket);
      const size_bytes = objects.reduce((sum, object) => sum + Number((object.size as number | undefined) ?? 0), 0);
      return c.json({
        stats: {
          object_count: objects.length,
          size_bytes,
        },
      });
    } catch (err) {
      logError('Failed to get portable object stats', err, { module: 'routes/resources/r2' });
      throw new InternalError('Failed to get stats');
    }
  }

  if (!resource.provider_resource_name) {
    throw new BadRequestError( 'R2 bucket not provisioned');
  }

  try {
    const wfp = r2RouteDeps.createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const stats = await wfp.r2.getR2BucketStats(resource.provider_resource_name);

    return c.json({ stats });
  } catch (err) {
    logError('Failed to get R2 stats', err, { module: 'routes/resources/r2' });
    throw new InternalError('Failed to get stats');
  }
})

.get('/:id/objects-stats', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const db = r2RouteDeps.getDb(c.env.DB);

  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('R2 resource');
  }

  const resource = toResource(resourceData);

  const hasAccess = resource.owner_id === user.id || await r2RouteDeps.checkResourceAccess(c.env.DB, resourceId, user.id);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  if (r2RouteDeps.isPortableResourceProvider(resource.provider_name)) {
    try {
      const bucket = r2RouteDeps.getPortableObjectStore(resource);
      const objects = await listAllObjects(bucket);
      const size_bytes = objects.reduce((sum, object) => sum + Number((object.size as number | undefined) ?? 0), 0);
      return c.json({
        stats: {
          object_count: objects.length,
          size_bytes,
        },
      });
    } catch (err) {
      logError('Failed to get portable object stats', err, { module: 'routes/resources/r2' });
      throw new InternalError('Failed to get stats');
    }
  }

  if (!resource.provider_resource_name) {
    throw new BadRequestError( 'R2 bucket not provisioned');
  }

  try {
    const wfp = r2RouteDeps.createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const stats = await wfp.r2.getR2BucketStats(resource.provider_resource_name);

    return c.json({ stats });
  } catch (err) {
    logError('Failed to get R2 stats', err, { module: 'routes/resources/r2' });
    throw new InternalError('Failed to get stats');
  }
})

.get('/:id/objects/:key', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const key = decodeURIComponent(c.req.param('key'));
  const db = r2RouteDeps.getDb(c.env.DB);

  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('R2 resource');
  }

  const resource = toResource(resourceData);
  const hasAccess = resource.owner_id === user.id || await r2RouteDeps.checkResourceAccess(c.env.DB, resourceId, user.id);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  if (r2RouteDeps.isPortableResourceProvider(resource.provider_name)) {
    try {
      const bucket = r2RouteDeps.getPortableObjectStore(resource);
      const object = await bucket.get(key);
      if (!object) {
        throw new NotFoundError('Object');
      }
      return c.json({
        key,
        value: await object.text(),
        content_type: getPortableObjectContentType(object),
        size: object.size,
      });
    } catch (err) {
      if (err instanceof NotFoundError) throw err;
      logError('Failed to read portable object', err, { module: 'routes/resources/r2' });
      throw new InternalError('Failed to read object');
    }
  }

  if (!resource.provider_resource_name) {
    throw new BadRequestError('R2 bucket not provisioned');
  }

  try {
    const wfp = r2RouteDeps.createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const object = await wfp.r2.getR2Object(resource.provider_resource_name, key);
    if (!object) {
      throw new NotFoundError('Object');
    }
    return c.json({
      key,
      value: new TextDecoder().decode(object.body),
      content_type: object.contentType,
      size: object.size,
    });
  } catch (err) {
    if (err instanceof NotFoundError) throw err;
    logError('Failed to read R2 object', err, { module: 'routes/resources/r2' });
    throw new InternalError('Failed to read object');
  }
})

.put('/:id/objects/:key',
  zValidator('json', z.object({
    value: z.string(),
    content_type: z.string().optional(),
  })),
  async (c) => {
    const user = c.get('user');
    const resourceId = c.req.param('id');
    const key = decodeURIComponent(c.req.param('key'));
    const db = r2RouteDeps.getDb(c.env.DB);
    const body = c.req.valid('json');

    const resourceData = await db.select().from(resources).where(
      and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
    ).get();

    if (!resourceData) {
      throw new NotFoundError('R2 resource');
    }

    const resource = toResource(resourceData);
    const hasAccess = resource.owner_id === user.id || await r2RouteDeps.checkResourceAccess(c.env.DB, resourceId, user.id, ['write', 'admin']);
    if (!hasAccess) {
      throw new AuthorizationError();
    }

    if (r2RouteDeps.isPortableResourceProvider(resource.provider_name)) {
      try {
        const bucket = r2RouteDeps.getPortableObjectStore(resource);
        await bucket.put(key, body.value, {
          ...(body.content_type ? { httpMetadata: { contentType: body.content_type } } : {}),
        });
        return c.json({ success: true });
      } catch (err) {
        logError('Failed to write portable object', err, { module: 'routes/resources/r2' });
        throw new InternalError('Failed to store object');
      }
    }

    if (!resource.provider_resource_name) {
      throw new BadRequestError('R2 bucket not provisioned');
    }

    try {
      const wfp = r2RouteDeps.createOptionalCloudflareWfpProvider(c.env);
      if (!wfp) {
        throw new InternalError('Cloudflare WFP not configured');
      }
      await wfp.r2.uploadToR2(resource.provider_resource_name, key, body.value, {
        contentType: body.content_type,
      });
      return c.json({ success: true });
    } catch (err) {
      logError('Failed to write R2 object', err, { module: 'routes/resources/r2' });
      throw new InternalError('Failed to store object');
    }
  })

.delete('/:id/r2/objects/:key', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const key = decodeURIComponent(c.req.param('key'));
  const db = r2RouteDeps.getDb(c.env.DB);

  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('R2 resource');
  }

  const resource = toResource(resourceData);

  const hasAccess = resource.owner_id === user.id || await r2RouteDeps.checkResourceAccess(c.env.DB, resourceId, user.id, ['write', 'admin']);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  if (!resource.provider_resource_name) {
    throw new BadRequestError( 'R2 bucket not provisioned');
  }

  if (r2RouteDeps.isPortableResourceProvider(resource.provider_name)) {
    try {
      const bucket = r2RouteDeps.getPortableObjectStore(resource);
      await bucket.delete(key);
      return c.json({ success: true });
    } catch (err) {
      logError('Failed to delete portable object', err, { module: 'routes/resources/r2' });
      throw new InternalError('Failed to delete object');
    }
  }

  try {
    const wfp = r2RouteDeps.createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    await wfp.r2.deleteR2Object(resource.provider_resource_name, key);
    return c.json({ success: true });
  } catch (err) {
    logError('Failed to delete R2 object', err, { module: 'routes/resources/r2' });
    throw new InternalError('Failed to delete object');
  }
})

.delete('/:id/objects/:key', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const key = decodeURIComponent(c.req.param('key'));
  const db = r2RouteDeps.getDb(c.env.DB);

  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), eq(resources.type, 'r2'))
  ).get();

  if (!resourceData) {
    throw new NotFoundError('R2 resource');
  }

  const resource = toResource(resourceData);

  const hasAccess = resource.owner_id === user.id || await r2RouteDeps.checkResourceAccess(c.env.DB, resourceId, user.id, ['write', 'admin']);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  if (r2RouteDeps.isPortableResourceProvider(resource.provider_name)) {
    try {
      const bucket = r2RouteDeps.getPortableObjectStore(resource);
      await bucket.delete(key);
      return c.json({ success: true });
    } catch (err) {
      logError('Failed to delete portable object', err, { module: 'routes/resources/r2' });
      throw new InternalError('Failed to delete object');
    }
  }

  if (!resource.provider_resource_name) {
    throw new BadRequestError('R2 bucket not provisioned');
  }

  try {
    const wfp = r2RouteDeps.createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    await wfp.r2.deleteR2Object(resource.provider_resource_name, key);
    return c.json({ success: true });
  } catch (err) {
    logError('Failed to delete R2 object', err, { module: 'routes/resources/r2' });
    throw new InternalError('Failed to delete object');
  }
});

export default resourcesR2;
