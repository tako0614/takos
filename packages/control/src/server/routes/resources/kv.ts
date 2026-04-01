import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Resource } from '../../../shared/types/index.ts';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import { parsePagination } from '../../../shared/utils/index.ts';
import { BadRequestError, AuthorizationError, InternalError, NotFoundError } from 'takos-common/errors';
import { zValidator } from '../zod-validator.ts';
import { createOptionalCloudflareWfpProvider } from '../../../platform/providers/cloudflare/wfp.ts';
import { getPortableKvStore, isPortableResourceProvider } from './portable-runtime.ts';
import { checkResourceAccess } from '../../../application/services/resources/index.ts';
import { getDb } from '../../../infra/db/index.ts';
import { resources } from '../../../infra/db/schema.ts';
import { and, eq, inArray } from 'drizzle-orm';
import { logError } from '../../../shared/utils/logger.ts';
import { getResourceTypeQueryValues } from '../../../application/services/resources/capabilities.ts';
import { textDate } from '../../../shared/utils/db-guards.ts';

export const kvRouteDeps = {
  getDb,
  getPortableKvStore,
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
  providerResourceId?: string | null;
  providerResourceName?: string | null;
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

async function loadKvResource(
  c: Context<AuthenticatedRouteEnv>,
  resourceId: string,
  requiredPermissions?: Array<'read' | 'write' | 'admin'>,
) {
  const db = kvRouteDeps.getDb(c.env.DB);
  const resourceData = await db.select().from(resources).where(
    and(eq(resources.id, resourceId), inArray(resources.type, getResourceTypeQueryValues('kv'))),
  ).get();

  if (!resourceData) {
    throw new NotFoundError('KV resource');
  }

  const resource = toResource(resourceData);
  const user = c.get('user');
  const hasAccess = resource.owner_id === user.id
    || await kvRouteDeps.checkResourceAccess(c.env.DB, resourceId, user.id, requiredPermissions);
  if (!hasAccess) {
    throw new AuthorizationError();
  }

  if (!resource.provider_resource_id) {
    throw new BadRequestError('KV namespace not provisioned');
  }

  return resource;
}

const resourcesKv = new Hono<AuthenticatedRouteEnv>()

.get('/:id/kv/entries',
  zValidator('query', z.object({
    prefix: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.string().optional(),
  })),
  async (c) => {
    const resource = await loadKvResource(c, c.req.param('id'));
    const { limit } = parsePagination(c.req.query(), { limit: 100, maxLimit: 1000 });

    if (kvRouteDeps.isPortableResourceProvider(resource.provider_name)) {
      try {
        const kv = kvRouteDeps.getPortableKvStore(resource);
        const result = await kv.list({
          prefix: c.req.query('prefix') || undefined,
          cursor: c.req.query('cursor') || undefined,
          limit,
        });
        return c.json({
          entries: result.keys,
          cursor: 'cursor' in result ? result.cursor || null : null,
        });
      } catch (err) {
        logError('Failed to list portable KV entries', err, { module: 'routes/resources/kv' });
        throw new InternalError('Failed to list KV entries');
      }
    }

    try {
      const wfp = kvRouteDeps.createOptionalCloudflareWfpProvider(c.env);
      if (!wfp) {
        throw new InternalError('Cloudflare WFP not configured');
      }
      const result = await wfp.kv.listKVEntries(resource.provider_resource_id!, {
        prefix: c.req.query('prefix') || undefined,
        cursor: c.req.query('cursor') || undefined,
        limit,
      });
      return c.json({ entries: result.result, cursor: result.cursor ?? null });
    } catch (err) {
      logError('Failed to list KV entries', err, { module: 'routes/resources/kv' });
      throw new InternalError('Failed to list KV entries');
    }
  })

.get('/:id/kv/entries/:key', async (c) => {
  const resource = await loadKvResource(c, c.req.param('id'));
  const key = decodeURIComponent(c.req.param('key'));

  if (kvRouteDeps.isPortableResourceProvider(resource.provider_name)) {
    try {
      const kv = kvRouteDeps.getPortableKvStore(resource);
      const value = await kv.getWithMetadata(key, 'text');
      return c.json({ key, value: value.value, content_type: null, metadata: value.metadata });
    } catch (err) {
      logError('Failed to read portable KV entry', err, { module: 'routes/resources/kv' });
      throw new InternalError('Failed to read KV entry');
    }
  }

  try {
    const wfp = kvRouteDeps.createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    const value = await wfp.kv.getKVValue(resource.provider_resource_id!, key);
    return c.json({ key, value: value.value, content_type: value.contentType });
  } catch (err) {
    logError('Failed to read KV entry', err, { module: 'routes/resources/kv' });
    throw new InternalError('Failed to read KV entry');
  }
})

.put('/:id/kv/entries/:key',
  zValidator('json', z.object({
    value: z.string(),
  })),
  async (c) => {
    const resource = await loadKvResource(c, c.req.param('id'), ['write', 'admin']);
    const key = decodeURIComponent(c.req.param('key'));
    const body = c.req.valid('json') as { value: string };

    if (kvRouteDeps.isPortableResourceProvider(resource.provider_name)) {
      try {
        const kv = kvRouteDeps.getPortableKvStore(resource);
        await kv.put(key, body.value);
        return c.json({ success: true });
      } catch (err) {
        logError('Failed to write portable KV entry', err, { module: 'routes/resources/kv' });
        throw new InternalError('Failed to write KV entry');
      }
    }

    try {
      const wfp = kvRouteDeps.createOptionalCloudflareWfpProvider(c.env);
      if (!wfp) {
        throw new InternalError('Cloudflare WFP not configured');
      }
      await wfp.kv.putKVValue(resource.provider_resource_id!, key, body.value);
      return c.json({ success: true });
    } catch (err) {
      logError('Failed to write KV entry', err, { module: 'routes/resources/kv' });
      throw new InternalError('Failed to write KV entry');
    }
  })

.delete('/:id/kv/entries/:key', async (c) => {
  const resource = await loadKvResource(c, c.req.param('id'), ['write', 'admin']);
  const key = decodeURIComponent(c.req.param('key'));

  if (kvRouteDeps.isPortableResourceProvider(resource.provider_name)) {
    try {
      const kv = kvRouteDeps.getPortableKvStore(resource);
      await kv.delete(key);
      return c.json({ success: true });
    } catch (err) {
      logError('Failed to delete portable KV entry', err, { module: 'routes/resources/kv' });
      throw new InternalError('Failed to delete KV entry');
    }
  }

  try {
    const wfp = kvRouteDeps.createOptionalCloudflareWfpProvider(c.env);
    if (!wfp) {
      throw new InternalError('Cloudflare WFP not configured');
    }
    await wfp.kv.deleteKVValue(resource.provider_resource_id!, key);
    return c.json({ success: true });
  } catch (err) {
    logError('Failed to delete KV entry', err, { module: 'routes/resources/kv' });
    throw new InternalError('Failed to delete KV entry');
  }
});

export default resourcesKv;
