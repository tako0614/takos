import { Hono } from 'hono';
import { z } from 'zod';
import { type AuthenticatedRouteEnv } from '../route-auth';
import { BadRequestError } from 'takos-common/errors';
import { zValidator } from '../zod-validator';
import { getResourceById, getResourceByName } from '../../../application/services/resources';
import { getDb } from '../../../infra/db';
import { resourceAccessTokens } from '../../../infra/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { generateId, base64UrlEncode } from '../../../shared/utils';
import { computeSHA256 } from '../../../shared/utils/hash';
import { AuthorizationError, NotFoundError } from 'takos-common/errors';

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
    throw new NotFoundError('Resource');
  }

  // Only owner can see tokens
  if (resource.owner_id !== user.id) {
    throw new AuthorizationError('Only the owner can view access tokens');
  }

  const db = getDb(c.env.DB);
  const rows = await db.select({
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

  const tokens = rows.map((t) => ({
    id: t.id,
    name: t.name,
    token_prefix: t.tokenPrefix,
    permission: t.permission,
    expires_at: t.expiresAt,
    last_used_at: t.lastUsedAt,
    created_at: t.createdAt,
  }));
  return c.json({ tokens });
})

.get('/by-name/:name/tokens', async (c) => {
  const user = c.get('user');
  const resourceName = c.req.param('name');

  const resource = await getResourceByName(c.env.DB, user.id, resourceName);
  const resourceId = (resource as { _internal_id?: string } | null)?._internal_id;

  if (!resource || !resourceId) {
    throw new NotFoundError('Resource');
  }

  const db = getDb(c.env.DB);
  const rows = await db.select({
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

  const tokens = rows.map((t) => ({
    id: t.id,
    name: t.name,
    token_prefix: t.tokenPrefix,
    permission: t.permission,
    expires_at: t.expiresAt,
    last_used_at: t.lastUsedAt,
    created_at: t.createdAt,
  }));
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
    throw new BadRequestError( 'Token name is required');
  }

  const resource = await getResourceById(c.env.DB, resourceId);

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  if (resource.owner_id !== user.id) {
    throw new AuthorizationError('Only the owner can create access tokens');
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
  const timestamp = new Date().toISOString();

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
      token_prefix: tokenPrefix,
      permission: body.permission || 'read',
      expires_at: expiresAt,
      created_at: timestamp,
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
    throw new BadRequestError( 'Token name is required');
  }

  const resource = await getResourceByName(c.env.DB, user.id, resourceName);
  const resourceId = (resource as { _internal_id?: string } | null)?._internal_id;

  if (!resource || !resourceId) {
    throw new NotFoundError('Resource');
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
  const timestamp = new Date().toISOString();

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
      token_prefix: tokenPrefix,
      permission: body.permission || 'read',
      expires_at: expiresAt,
      created_at: timestamp,
    },
  }, 201);
})

.delete('/:id/tokens/:tokenId', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const tokenId = c.req.param('tokenId');

  const resource = await getResourceById(c.env.DB, resourceId);

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  if (resource.owner_id !== user.id) {
    throw new AuthorizationError('Only the owner can delete access tokens');
  }

  const db = getDb(c.env.DB);

  const token = await db.select().from(resourceAccessTokens).where(
    and(eq(resourceAccessTokens.id, tokenId), eq(resourceAccessTokens.resourceId, resourceId))
  ).get();

  if (!token) {
    throw new NotFoundError('Token');
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
    throw new NotFoundError('Resource');
  }

  const db = getDb(c.env.DB);

  const token = await db.select().from(resourceAccessTokens).where(
    and(eq(resourceAccessTokens.id, tokenId), eq(resourceAccessTokens.resourceId, resourceId))
  ).get();

  if (!token) {
    throw new NotFoundError('Token');
  }

  await db.delete(resourceAccessTokens).where(eq(resourceAccessTokens.id, tokenId));

  return c.json({ success: true });
})

.get('/:id/connection', async (c) => {
  const user = c.get('user');
  const resourceId = c.req.param('id');

  const resource = await getResourceById(c.env.DB, resourceId);

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  if (resource.owner_id !== user.id) {
    throw new AuthorizationError('Only the owner can view connection info');
  }

  const connectionInfo: Record<string, string> = {};

  switch (resource.type) {
    case 'd1':
      connectionInfo.database_id = resource.provider_resource_id || '';
      connectionInfo.database_name = resource.provider_resource_name || '';
      connectionInfo.connection_url = `d1://${resource.provider_resource_id || ''}`;
      break;

    case 'r2':
      connectionInfo.bucket_name = resource.provider_resource_name || '';
      connectionInfo.access_url = `https://${resource.provider_resource_name || ''}.r2.cloudflarestorage.com`;
      break;

    case 'kv':
      connectionInfo.namespace_id = resource.provider_resource_id || '';
      connectionInfo.namespace_name = resource.provider_resource_name || '';
      break;

    case 'vectorize':
      connectionInfo.index_name = resource.provider_resource_name || '';
      connectionInfo.index_id = resource.provider_resource_id || '';
      break;

    default:
      connectionInfo.resource_id = resource.provider_resource_id || resource.id;
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
    throw new NotFoundError('Resource');
  }

  const connectionInfo: Record<string, string> = {};

  switch (resource.type) {
    case 'd1':
      connectionInfo.database_id = resource.provider_resource_id || '';
      connectionInfo.database_name = resource.provider_resource_name || '';
      connectionInfo.connection_url = `d1://${resource.provider_resource_id || ''}`;
      break;

    case 'r2':
      connectionInfo.bucket_name = resource.provider_resource_name || '';
      connectionInfo.access_url = `https://${resource.provider_resource_name || ''}.r2.cloudflarestorage.com`;
      break;

    case 'kv':
      connectionInfo.namespace_id = resource.provider_resource_id || '';
      connectionInfo.namespace_name = resource.provider_resource_name || '';
      break;

    case 'vectorize':
      connectionInfo.index_name = resource.provider_resource_name || '';
      connectionInfo.index_id = resource.provider_resource_id || '';
      break;

    default:
      connectionInfo.resource_id =
        resource.provider_resource_id || (resource as { _internal_id?: string })._internal_id || '';
  }

  return c.json({
    type: resource.type,
    name: resource.name,
    status: resource.status,
    connection: connectionInfo,
  });
});

export default resourcesTokens;
