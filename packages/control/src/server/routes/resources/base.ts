import { Hono } from 'hono';
import { z } from 'zod';
import type { ResourceType } from '../../../shared/types';
import { generateId, now } from '../../../shared/utils';
import { badRequest, requireWorkspaceAccess, type AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import {
  checkResourceAccess,
  countResourceBindings,
  deleteResource,
  getResourceById,
  getResourceByName,
  listResourceAccess,
  listResourceBindings,
  listResourcesByType,
  listResourcesForUser,
  listResourcesForWorkspace,
  markResourceDeleting,
  provisionCloudflareResource,
  updateResourceMetadata,
} from '../../../application/services/resources';
import { getDb } from '../../../infra/db';
import { accountMemberships, resourceAccess, resources, accounts } from '../../../infra/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { resolveActorPrincipalId } from '../../../application/services/identity/principals';
import { logError } from '../../../shared/utils/logger';
import { NotFoundError, AuthorizationError, InternalError } from '@takos/common/errors';
import { getPlatformSqlBinding } from '../../../platform/accessors.ts';
import { CloudflareResourceService } from '../../../platform/providers/cloudflare/resources.ts';

async function deleteCfResource(
  provider: CloudflareResourceService,
  resource: { type: string; cf_id: string | null; cf_name: string | null },
): Promise<void> {
  await provider.deleteResource({
    type: resource.type,
    cfId: resource.cf_id,
    cfName: resource.cf_name,
  });
}

const resourcesBase = new Hono<AuthenticatedRouteEnv>()

.get('/', async (c) => {
  const dbBinding = getPlatformSqlBinding(c);
  const user = c.get('user');
  const spaceId = c.req.query('space_id');
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  if (spaceId) {
    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor', 'viewer'],
      'Workspace not found or access denied',
      404
    );
    if (access instanceof Response) return access;

    const resourceList = await listResourcesForWorkspace(dbBinding, user.id, access.space.id);

    return c.json({ resources: resourceList });
  }

  const { owned, shared } = await listResourcesForUser(dbBinding, user.id);

  return c.json({ owned, shared });
})

.get('/shared/:spaceId', async (c) => {
  const dbBinding = getPlatformSqlBinding(c);
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }
  const db = getDb(dbBinding);
  const principalId = await resolveActorPrincipalId(dbBinding, user.id);
  if (!principalId) {
    throw new InternalError('User principal not found');
  }

  const isMember = await db.select({ id: accountMemberships.id }).from(accountMemberships).where(
    and(eq(accountMemberships.accountId, spaceId), eq(accountMemberships.memberId, principalId))
  ).get();

  if (!isMember) {
    throw new NotFoundError('Workspace');
  }

  // Get resource access entries for this space
  const accessList = await db.select().from(resourceAccess).where(
    eq(resourceAccess.accountId, spaceId)
  ).all();

  // Load resources and owner info for each access entry
  const sharedResources: Array<{
    name: string;
    type: string;
    status: string;
    cf_id: string | null;
    cf_name: string | null;
    access_level: string;
    owner_name: string;
    owner_email: string | null;
  }> = [];

  for (const a of accessList) {
    const resource = await db.select().from(resources).where(eq(resources.id, a.resourceId)).get();
    if (!resource || resource.status === 'deleted' || resource.accountId === spaceId) continue;

    const owner = await db.select({ name: accounts.name, email: accounts.email }).from(accounts).where(
      eq(accounts.id, resource.ownerAccountId)
    ).get();

    sharedResources.push({
      name: resource.name,
      type: resource.type,
      status: resource.status,
      cf_id: resource.cfId,
      cf_name: resource.cfName,
      access_level: a.permission,
      owner_name: owner?.name ?? '',
      owner_email: owner?.email ?? null,
    });
  }

  return c.json({ shared_resources: sharedResources });
})

.get('/type/:type', async (c) => {
  const dbBinding = getPlatformSqlBinding(c);
  const user = c.get('user');
  const resourceType = c.req.param('type') as ResourceType;
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  if (!['d1', 'r2', 'worker', 'kv', 'vectorize', 'assets'].includes(resourceType)) {
    return badRequest(c, 'Invalid resource type');
  }

  const resourceList = await listResourcesByType(dbBinding, user.id, resourceType);

  return c.json({ resources: resourceList });
})

.get('/:id', async (c) => {
  const dbBinding = getPlatformSqlBinding(c);
  const user = c.get('user');
  const resourceId = c.req.param('id');
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  const resource = await getResourceById(dbBinding, resourceId);

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  const hasAccess = resource.owner_id === user.id || await checkResourceAccess(dbBinding, resourceId, user.id);
  if (!hasAccess) {
    throw new NotFoundError('Resource');
  }

  const access = await listResourceAccess(dbBinding, resourceId);
  const resourceBindings = await listResourceBindings(dbBinding, resourceId);

  return c.json({
    resource,
    access,
    bindings: resourceBindings,
    is_owner: resource.owner_id === user.id,
  });
})

.post('/',
  zValidator('json', z.object({
    name: z.string(),
    type: z.string(),
    config: z.record(z.unknown()).optional(),
    space_id: z.string().optional(),
  })),
  async (c) => {
  const dbBinding = getPlatformSqlBinding(c);
  const user = c.get('user');
  const body = c.req.valid('json') as { name: string; type: ResourceType; config?: Record<string, unknown>; space_id?: string };
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  if (!body.name?.trim()) {
    return badRequest(c, 'name is required');
  }

  if (!['d1', 'r2', 'kv', 'vectorize'].includes(body.type)) {
    return badRequest(c, 'Invalid resource type');
  }

  let spaceId = body.space_id?.trim() || '';

  if (spaceId) {
    const access = await requireWorkspaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions',
      403
    );
    if (access instanceof Response) return access;
    spaceId = access.space.id;
  } else {
    // Default to user's own account
    spaceId = user.id;
  }

  const id = generateId();
  const timestamp = now();
  const name = body.name.trim();
  const cfName = `takos-${body.type}-${id}`;

  try {
    switch (body.type) {
      case 'd1':
      case 'r2':
      case 'kv':
      case 'vectorize':
        await provisionCloudflareResource(c.env, {
          id,
          timestamp,
          ownerId: user.id,
          spaceId,
          name,
          type: body.type,
          cfName,
          config: body.config || {},
          recordFailure: true,
          ...(body.type === 'vectorize'
            ? { vectorize: { dimensions: 1536, metric: 'cosine' as const } }
            : {}),
        });
        return c.json({ resource: await getResourceById(dbBinding, id) }, 201);

    }
  } catch (err) {
    logError('Resource creation failed', err, { module: 'routes/resources/base' });

    return c.json({
      error: 'Failed to provision resource',
      resource_id: id,
    }, 500);
  }
})

.patch('/:id',
  zValidator('json', z.object({
    name: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })),
  async (c) => {
  const dbBinding = getPlatformSqlBinding(c);
  const user = c.get('user');
  const resourceId = c.req.param('id');
  const body = c.req.valid('json');
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  const resource = await getResourceById(dbBinding, resourceId);

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  if (resource.owner_id !== user.id) {
    throw new AuthorizationError('Only the owner can update this resource');
  }

  if (body.name?.trim()) {
    body.name = body.name.trim();
  }

  const updated = await updateResourceMetadata(dbBinding, resourceId, {
    name: body.name,
    config: body.config,
    metadata: body.metadata,
  });

  if (!updated) {
    return badRequest(c, 'No valid updates provided');
  }

  return c.json({ resource: updated });
})

.delete('/:id', async (c) => {
  const dbBinding = getPlatformSqlBinding(c);
  const user = c.get('user');
  const resourceId = c.req.param('id');
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  const resource = await getResourceById(dbBinding, resourceId);

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  if (resource.owner_id !== user.id) {
    throw new AuthorizationError('Only the owner can delete this resource');
  }

  const bindingsCount = await countResourceBindings(dbBinding, resourceId);

  if (bindingsCount && bindingsCount.count > 0) {
    return c.json({
      error: 'Resource is in use by workers',
      binding_count: bindingsCount.count,
    }, 409);
  }

  await markResourceDeleting(dbBinding, resourceId);

  try {
    await deleteCfResource(new CloudflareResourceService(c.env), resource);
  } catch (err) {
    logError('Failed to delete Cloudflare resource', err, { module: 'routes/resources/base' });
  }

  await deleteResource(dbBinding, resourceId);

  return c.json({ success: true });
})

.get('/by-name/:name', async (c) => {
  const dbBinding = getPlatformSqlBinding(c);
  const user = c.get('user');
  const resourceName = decodeURIComponent(c.req.param('name'));
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  const resource = await getResourceByName(dbBinding, user.id, resourceName);

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  const { _internal_id, ...apiResource } = resource;
  const access = await listResourceAccess(dbBinding, _internal_id);
  const resourceBindings = await listResourceBindings(dbBinding, _internal_id);

  return c.json({
    resource: apiResource,
    access,
    bindings: resourceBindings,
    is_owner: true,
  });
})

// Delete resource by name
.delete('/by-name/:name', async (c) => {
  const dbBinding = getPlatformSqlBinding(c);
  const user = c.get('user');
  const resourceName = decodeURIComponent(c.req.param('name'));
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  const resource = await getResourceByName(dbBinding, user.id, resourceName);

  if (!resource) {
    throw new NotFoundError('Resource');
  }

  const { _internal_id: resourceId } = resource;

  const bindingsCount = await countResourceBindings(dbBinding, resourceId);

  if (bindingsCount && bindingsCount.count > 0) {
    return c.json({
      error: 'Resource is in use by workers',
      binding_count: bindingsCount.count,
    }, 409);
  }

  await markResourceDeleting(dbBinding, resourceId);

  try {
    await deleteCfResource(new CloudflareResourceService(c.env), resource);
  } catch (err) {
    logError('Failed to delete Cloudflare resource', err, { module: 'routes/resources/base' });
  }

  await deleteResource(dbBinding, resourceId);

  return c.json({ success: true });
});

export default resourcesBase;
