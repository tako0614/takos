import { Hono } from 'hono';
import { z } from 'zod';
import { badRequest, type AuthenticatedRouteEnv } from '../shared/helpers';
import { zValidator } from '../zod-validator';
import { getResourceById, getResourceByName } from '../../../application/services/resources';
import { getDb } from '../../../infra/db';
import { resourceAccessTokens } from '../../../infra/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { generateId, now, base64UrlEncode } from '../../../shared/utils';
import { computeSHA256 } from '../../../shared/utils/hash';
import { forbidden, notFound } from '../../../shared/utils/error-response';

function generateRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

const resourcesTokens = new Hono<AuthenticatedRouteEnv>()

.get('/:id/tokens', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');

  const resource = await getResourceById(c.env.DB, resourceId);

  if (!resource) {
    return notFound(c, 'Resource');
  }

  // Only owner can see tokens
  if (resource.owner_id !== user.id) {
    return forbidden(c, 'Only the owner can view access tokens');
  }

  const db = getDb(c.env.DB);
  const tokens = await db.select({
    id: resourceAccessTokens.id,
    name: resourceAccessTokens.name,
    tokenPrefix: resourceAccessTokens.tokenPrefix,
    permission: resourceAccessTokens.permission,
    expiresAt: resourceAccessTokens.expiresAt,
    lastUsedAt: resourceAccessTokens.lastUsedAt,
    createdAt: resourceAccessTokens.createdAt,
  }).from(resourceAccessTokens)
    .where(eq(resourceAccessTokens.resourceId, resourceId))
    .orderBy(desc(resourceAccessTokens.createdAt))
    .all();

  return c.json({ tokens });
})

.get('/by-name/:name/tokens', async (c) => {
  const user = c.get('user');
  const resourceName = c.req.param('name');

  const resource = await getResourceByName(c.env.DB, user.id, resourceName);
  const resourceId = (resource as { _internal_id?: string } | null)?._internal_id;

  if (!resource || !resourceId) {
    return notFound(c, 'Resource');
  }

  const db = getDb(c.env.DB);
  const tokens = await db.select({
    id: resourceAccessTokens.id,
    name: resourceAccessTokens.name,
    tokenPrefix: resourceAccessTokens.tokenPrefix,
    permission: resourceAccessTokens.permission,
    expiresAt: resourceAccessTokens.expiresAt,
    lastUsedAt: resourceAccessTokens.lastUsedAt,
    createdAt: resourceAccessTokens.createdAt,
  }).from(resourceAccessTokens)
    .where(eq(resourceAccessTokens.resourceId, resourceId))
    .orderBy(desc(resourceAccessTokens.createdAt))
    .all();

  return c.json({ tokens });
})

.post('/:id/tokens',
  zValidator('json', z.object({
    name: z.string(),
    permission: z.enum(['read', 'write']).optional(),
    expires_in_days: z.number().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const body = c.req.valid('json');

  if (!body.name?.trim()) {
    return badRequest(c, 'Token name is required');
  }

  const resource = await getResourceById(c.env.DB, resourceId);

  if (!resource) {
    return notFound(c, 'Resource');
  }

  if (resource.owner_id !== user.id) {
    return forbidden(c, 'Only the owner can create access tokens');
  }

  const tokenBytes = generateRandomBytes(32);
  const tokenPlain = `tak_${base64UrlEncode(tokenBytes)}`;
  const tokenHash = await computeSHA256(tokenPlain);
  const tokenPrefix = tokenPlain.substring(0, 12);

  let expiresAt: string | null = null;
  if (body.expires_in_days && body.expires_in_days > 0) {
    const expires = new Date();
    expires.setDate(expires.getDate() + body.expires_in_days);
    expiresAt = expires.toISOString();
  }

  const id = generateId();
  const timestamp = now();

  const db = getDb(c.env.DB);
  await db.insert(resourceAccessTokens).values({
    id,
    resourceId,
    name: body.name.trim(),
    tokenHash,
    tokenPrefix,
    permission: body.permission || 'read',
    expiresAt,
    createdBy: user.id,
    createdAt: timestamp,
  });

  return c.json({
    token: {
      id,
      name: body.name.trim(),
      token: tokenPlain, // Only returned on creation
      tokenPrefix,
      permission: body.permission || 'read',
      expiresAt,
      createdAt: timestamp,
    },
  }, 201);
})

.post('/by-name/:name/tokens',
  zValidator('json', z.object({
    name: z.string(),
    permission: z.enum(['read', 'write']).optional(),
    expires_in_days: z.number().optional(),
  })),
  async (c) => {
  const user = c.get('user');
  const resourceName = c.req.param('name');
  const body = c.req.valid('json');

  if (!body.name?.trim()) {
    return badRequest(c, 'Token name is required');
  }

  const resource = await getResourceByName(c.env.DB, user.id, resourceName);
  const resourceId = (resource as { _internal_id?: string } | null)?._internal_id;

  if (!resource || !resourceId) {
    return notFound(c, 'Resource');
  }

  const tokenBytes = generateRandomBytes(32);
  const tokenPlain = `tak_${base64UrlEncode(tokenBytes)}`;
  const tokenHash = await computeSHA256(tokenPlain);
  const tokenPrefix = tokenPlain.substring(0, 12);

  let expiresAt: string | null = null;
  if (body.expires_in_days && body.expires_in_days > 0) {
    const expires = new Date();
    expires.setDate(expires.getDate() + body.expires_in_days);
    expiresAt = expires.toISOString();
  }

  const id = generateId();
  const timestamp = now();

  const db = getDb(c.env.DB);
  await db.insert(resourceAccessTokens).values({
    id,
    resourceId,
    name: body.name.trim(),
    tokenHash,
    tokenPrefix,
    permission: body.permission || 'read',
    expiresAt,
    createdBy: user.id,
    createdAt: timestamp,
  });

  return c.json({
    token: {
      id,
      name: body.name.trim(),
      token: tokenPlain,
      tokenPrefix,
      permission: body.permission || 'read',
      expiresAt,
      createdAt: timestamp,
    },
  }, 201);
})

.delete('/:id/tokens/:tokenId', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const tokenId = c.req.param('tokenId');

  const resource = await getResourceById(c.env.DB, resourceId);

  if (!resource) {
    return notFound(c, 'Resource');
  }

  if (resource.owner_id !== user.id) {
    return forbidden(c, 'Only the owner can delete access tokens');
  }

  const db = getDb(c.env.DB);

  const token = await db.select().from(resourceAccessTokens).where(
    and(eq(resourceAccessTokens.id, tokenId), eq(resourceAccessTokens.resourceId, resourceId))
  ).get();

  if (!token) {
    return notFound(c, 'Token');
  }

  await db.delete(resourceAccessTokens).where(eq(resourceAccessTokens.id, tokenId));

  return c.json({ success: true });
})

.delete('/by-name/:name/tokens/:tokenId', async (c) => {
  const user = c.get('user');
  const resourceName = c.req.param('name');
  const tokenId = c.req.param('tokenId');

  const resource = await getResourceByName(c.env.DB, user.id, resourceName);
  const resourceId = (resource as { _internal_id?: string } | null)?._internal_id;

  if (!resource || !resourceId) {
    return notFound(c, 'Resource');
  }

  const db = getDb(c.env.DB);

  const token = await db.select().from(resourceAccessTokens).where(
    and(eq(resourceAccessTokens.id, tokenId), eq(resourceAccessTokens.resourceId, resourceId))
  ).get();

  if (!token) {
    return notFound(c, 'Token');
  }

  await db.delete(resourceAccessTokens).where(eq(resourceAccessTokens.id, tokenId));

  return c.json({ success: true });
})

.get('/:id/connection', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');

  const resource = await getResourceById(c.env.DB, resourceId);

  if (!resource) {
    return notFound(c, 'Resource');
  }

  if (resource.owner_id !== user.id) {
    return forbidden(c, 'Only the owner can view connection info');
  }

  const connectionInfo: Record<string, string> = {};

  switch (resource.type) {
    case 'd1':
      connectionInfo.database_id = resource.cf_id || '';
      connectionInfo.database_name = resource.cf_name || '';
      connectionInfo.connection_url = `d1://${resource.cf_id}`;
      break;

    case 'r2':
      connectionInfo.bucket_name = resource.cf_name || '';
      connectionInfo.access_url = `https://${resource.cf_name}.r2.cloudflarestorage.com`;
      break;

    case 'kv':
      connectionInfo.namespace_id = resource.cf_id || '';
      connectionInfo.namespace_name = resource.cf_name || '';
      break;

    case 'vectorize':
      connectionInfo.index_name = resource.cf_name || '';
      connectionInfo.index_id = resource.cf_id || '';
      break;

    default:
      connectionInfo.resource_id = resource.cf_id || resource.id;
  }

  return c.json({
    type: resource.type,
    name: resource.name,
    status: resource.status,
    connection: connectionInfo,
  });
})

.get('/by-name/:name/connection', async (c) => {
  const user = c.get('user');
  const resourceName = c.req.param('name');

  const resource = await getResourceByName(c.env.DB, user.id, resourceName);

  if (!resource) {
    return notFound(c, 'Resource');
  }

  const connectionInfo: Record<string, string> = {};

  switch (resource.type) {
    case 'd1':
      connectionInfo.database_id = resource.cf_id || '';
      connectionInfo.database_name = resource.cf_name || '';
      connectionInfo.connection_url = `d1://${resource.cf_id}`;
      break;

    case 'r2':
      connectionInfo.bucket_name = resource.cf_name || '';
      connectionInfo.access_url = `https://${resource.cf_name}.r2.cloudflarestorage.com`;
      break;

    case 'kv':
      connectionInfo.namespace_id = resource.cf_id || '';
      connectionInfo.namespace_name = resource.cf_name || '';
      break;

    case 'vectorize':
      connectionInfo.index_name = resource.cf_name || '';
      connectionInfo.index_id = resource.cf_id || '';
      break;

    default:
      connectionInfo.resource_id =
        resource.cf_id || (resource as { _internal_id?: string })._internal_id || '';
  }

  return c.json({
    type: resource.type,
    name: resource.name,
    status: resource.status,
    connection: connectionInfo,
  });
});

export default resourcesTokens;
