import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { ResourceCapability, ResourceType } from '../../../shared/types';
import { generateId } from '../../../shared/utils';
import { VECTORIZE_DEFAULT_DIMENSIONS } from '../../../shared/config/limits.ts';
import { requireSpaceAccess, type AuthenticatedRouteEnv } from '../route-auth';
import { AppError, BadRequestError } from 'takos-common/errors';
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
  provisionManagedResource,
  deleteManagedResource,
  updateResourceMetadata,
} from '../../../application/services/resources';
import { getDb } from '../../../infra/db';
import { accountMemberships, resourceAccess, resources, accounts, groups } from '../../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { resolveActorPrincipalId } from '../../../application/services/identity/principals';
import { logError } from '../../../shared/utils/logger';
import { NotFoundError, AuthorizationError, InternalError } from 'takos-common/errors';
import { getPlatformServices } from '../../../platform/accessors.ts';
import { getStoredResourceImplementation, toPublicResourceType, toResourceCapability } from '../../../application/services/resources/capabilities';
import { removeGroupDesiredResource, upsertGroupDesiredResource } from '../../../application/services/deployment/group-desired-projector.ts';
import { safeJsonParseOrDefault } from '../../../shared/utils';

const resourcesBase = new Hono<AuthenticatedRouteEnv>();

resourcesBase.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.statusCode as ContentfulStatusCode);
  }
  logError('Unhandled resources route error', err, { module: 'routes/resources/base' });
  return c.json({ error: err instanceof Error ? err.message : 'Internal server error' }, 500);
});

function inferResourceProvider(env: AuthenticatedRouteEnv['Bindings']): 'cloudflare' | 'local' {
  return env.CF_ACCOUNT_ID && env.CF_API_TOKEN ? 'cloudflare' : 'local';
}

const RESOURCE_PROVIDER_VALUES = ['cloudflare', 'local', 'aws', 'gcp', 'k8s'] as const;
type ResourceProviderName = (typeof RESOURCE_PROVIDER_VALUES)[number];

function normalizeResourceProvider(provider: unknown): ResourceProviderName | undefined {
  if (provider === undefined || provider === null) {
    return undefined;
  }

  const providerName = typeof provider === 'string'
    ? provider.trim().toLowerCase()
    : '';

  return RESOURCE_PROVIDER_VALUES.includes(providerName as ResourceProviderName)
    ? (providerName as ResourceProviderName)
    : undefined;
}

function buildProjectedResourceSpec(
  name: string,
  body: {
    type: ResourceType;
    config?: Record<string, unknown>;
  },
) {
  const config = body.config ?? {};
  const canonicalType = toPublicResourceType(body.type, config) ?? body.type;
  const workflowConfig = config.workflow && typeof config.workflow === 'object'
    ? config.workflow as Record<string, unknown>
    : {};
  const durableConfig = config.durableObject && typeof config.durableObject === 'object'
    ? config.durableObject as Record<string, unknown>
    : {};
  const binding = typeof config.binding === 'string' && config.binding.trim().length > 0
    ? config.binding.trim()
    : name.toUpperCase().replace(/-/g, '_');
  switch (canonicalType) {
    case 'd1':
      return {
        type: 'd1' as const,
        binding,
      };
    case 'r2':
      return {
        type: 'r2' as const,
        binding,
      };
    case 'kv':
      return {
        type: 'kv' as const,
        binding,
      };
    case 'queue':
      return {
        type: 'queue' as const,
        binding,
        ...(config.queue && typeof config.queue === 'object' ? { queue: config.queue as Record<string, unknown> } : {}),
      };
    case 'vectorize':
      return {
        type: 'vectorize' as const,
        binding,
        ...(config.vectorize && typeof config.vectorize === 'object' ? { vectorize: config.vectorize as { dimensions: number; metric: 'cosine' | 'euclidean' | 'dot-product' } } : {}),
      };
    case 'analyticsEngine':
      return {
        type: 'analyticsEngine' as const,
        binding,
        ...(config.analyticsEngine && typeof config.analyticsEngine === 'object' ? { analyticsEngine: config.analyticsEngine as { dataset?: string } } : {}),
      };
    case 'workflow':
      return {
        type: 'workflow' as const,
        binding,
        workflow: {
          service: String(config.service ?? workflowConfig.service ?? ''),
          export: String(config.export ?? workflowConfig.export ?? ''),
        },
      };
    case 'durableObject':
      return {
        type: 'durableObject' as const,
        binding,
        durableObject: {
          className: String(config.className ?? durableConfig.className ?? ''),
          ...(typeof config.scriptName === 'string'
            ? { scriptName: config.scriptName }
            : (typeof durableConfig.scriptName === 'string' ? { scriptName: durableConfig.scriptName } : {})),
        },
      };
    case 'secretRef':
      return {
        type: 'secretRef' as const,
        binding,
      };
    default:
      return {
        type: canonicalType as ResourceType,
        binding,
      };
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function resolveRequestedProviderResourceName(
  type: string,
  fallbackName: string,
  config?: Record<string, unknown>,
): string {
  const capability = toResourceCapability(type);
  if (capability === 'analytics_store') {
    const analyticsConfig = asObject(config?.analyticsEngine) ?? asObject(config?.analyticsStore);
    const dataset = typeof analyticsConfig?.dataset === 'string'
      ? analyticsConfig.dataset.trim()
      : '';
    if (dataset) return dataset;
  }
  return fallbackName;
}

function buildProvisioningRequest(
  capability: ResourceCapability,
  config?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const queueConfig = asObject(config?.queue);
  const vectorConfig = asObject(config?.vectorize) ?? asObject(config?.vectorIndex);
  const analyticsConfig = asObject(config?.analyticsEngine) ?? asObject(config?.analyticsStore);
  const workflowConfig = asObject(config?.workflow) ?? asObject(config?.workflowRuntime);
  const durableConfig = asObject(config?.durableObject) ?? asObject(config?.durableNamespace);

  if (capability === 'vector_index') {
    out.vectorIndex = {
      dimensions: typeof vectorConfig?.dimensions === 'number'
        ? vectorConfig.dimensions
        : VECTORIZE_DEFAULT_DIMENSIONS,
      metric: typeof vectorConfig?.metric === 'string'
        ? vectorConfig.metric
        : 'cosine',
    };
  }

  if (capability === 'queue' && typeof queueConfig?.deliveryDelaySeconds === 'number') {
    out.queue = { deliveryDelaySeconds: queueConfig.deliveryDelaySeconds };
  }

  if (capability === 'analytics_store' && typeof analyticsConfig?.dataset === 'string' && analyticsConfig.dataset.trim()) {
    out.analyticsStore = { dataset: analyticsConfig.dataset.trim() };
  }

  if (
    capability === 'workflow_runtime'
    && typeof workflowConfig?.service === 'string'
    && typeof workflowConfig?.export === 'string'
  ) {
    out.workflowRuntime = {
      service: workflowConfig.service,
      export: workflowConfig.export,
      ...(typeof workflowConfig.timeoutMs === 'number' ? { timeoutMs: workflowConfig.timeoutMs } : {}),
      ...(typeof workflowConfig.maxRetries === 'number' ? { maxRetries: workflowConfig.maxRetries } : {}),
    };
  }

  if (capability === 'durable_namespace' && typeof durableConfig?.className === 'string') {
    out.durableNamespace = {
      className: durableConfig.className,
      ...(typeof durableConfig.scriptName === 'string' ? { scriptName: durableConfig.scriptName } : {}),
    };
  }

  return out;
}

resourcesBase

.get('/', async (c) => {
  const dbBinding = getPlatformServices(c).sql?.binding;
  const user = c.get('user');
  const spaceId = c.req.query('space_id');
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  if (spaceId) {
    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor', 'viewer'],
      'Workspace not found or access denied',
      404
    );

    const resourceList = await listResourcesForWorkspace(dbBinding, user.id, access.space.id);

    return c.json({ resources: resourceList });
  }

  const { owned, shared } = await listResourcesForUser(dbBinding, user.id);

  return c.json({ owned, shared });
})

.get('/shared/:spaceId', async (c) => {
  const dbBinding = getPlatformServices(c).sql?.binding;
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
    capability?: string;
    implementation?: string | null;
    status: string;
    provider_resource_id: string | null;
    provider_resource_name: string | null;
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
      type: toPublicResourceType(resource.type, resource.config) ?? resource.type,
      ...(resource.semanticType ? { capability: resource.semanticType } : {}),
      ...(getStoredResourceImplementation(resource.type, resource.config) ? { implementation: getStoredResourceImplementation(resource.type, resource.config) } : {}),
      status: resource.status,
      provider_resource_id: resource.providerResourceId,
      provider_resource_name: resource.providerResourceName,
      access_level: a.permission,
      owner_name: owner?.name ?? '',
      owner_email: owner?.email ?? null,
    });
  }

  return c.json({ shared_resources: sharedResources });
})

.get('/type/:type', async (c) => {
  const dbBinding = getPlatformServices(c).sql?.binding;
  const user = c.get('user');
  const requestedType = c.req.param('type');
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  const resourceType = toResourceCapability(requestedType);
  if (!resourceType) {
    throw new BadRequestError( 'Invalid resource type');
  }

  const resourceList = await listResourcesByType(dbBinding, user.id, resourceType as ResourceCapability);

  return c.json({ resources: resourceList });
})

.get('/:id', async (c) => {
  const dbBinding = getPlatformServices(c).sql?.binding;
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
    provider: z.string().optional(),
    space_id: z.string().optional(),
    group_id: z.string().optional(),
  })),
  async (c) => {
  const dbBinding = getPlatformServices(c).sql?.binding;
  const user = c.get('user');
  const body = c.req.valid('json') as {
    name: string;
    type: ResourceType;
    config?: Record<string, unknown>;
    provider?: string;
    space_id?: string;
    group_id?: string;
  };
  if (!dbBinding) {
    throw new InternalError('Database binding unavailable');
  }

  if (!body.name?.trim()) {
    throw new BadRequestError( 'name is required');
  }

  const providerName = normalizeResourceProvider(body.provider) ?? inferResourceProvider(c.env);
  if (body.provider && !normalizeResourceProvider(body.provider)) {
    throw new BadRequestError(`Invalid provider: ${body.provider}`);
  }

  const resourceCapability = toResourceCapability(body.type);
  if (!resourceCapability) {
    throw new BadRequestError( 'Invalid resource type');
  }

  let spaceId = body.space_id?.trim() || '';

  if (spaceId) {
    const access = await requireSpaceAccess(
      c,
      spaceId,
      user.id,
      ['owner', 'admin', 'editor'],
      'Workspace not found or insufficient permissions',
      403
    );

    spaceId = access.space.id;
  } else {
    // Default to user's own account
    spaceId = user.id;
  }

  let groupId: string | null = null;
  if (body.group_id?.trim()) {
    const db = getDb(dbBinding);
    const group = await db.select({ id: groups.id, spaceId: groups.spaceId })
      .from(groups)
      .where(eq(groups.id, body.group_id.trim()))
      .get();
    if (!group || group.spaceId !== spaceId) {
      throw new BadRequestError('group_id must belong to the selected workspace');
    }
    groupId = group.id;
  }

  const id = generateId();
  const timestamp = new Date().toISOString();
  const name = body.name.trim();
  const providerResourceName = resolveRequestedProviderResourceName(
    body.type,
    `takos-${body.type}-${id}`,
    body.config,
  );

  try {
    await provisionManagedResource(c.env, {
      id,
      timestamp,
      ownerId: user.id,
      spaceId,
      groupId,
      name,
      type: resourceCapability,
      publicType: body.type,
      semanticType: resourceCapability,
      providerName,
      providerResourceName,
      config: body.config || {},
      recordFailure: true,
      ...buildProvisioningRequest(resourceCapability, body.config),
    });
    if (groupId) {
      await upsertGroupDesiredResource(c.env, {
        groupId,
        name,
        resource: buildProjectedResourceSpec(name, body) as never,
      });
    }
    return c.json({ resource: await getResourceById(dbBinding, id) }, 201);
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
  const dbBinding = getPlatformServices(c).sql?.binding;
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
    throw new BadRequestError( 'No valid updates provided');
  }

  if (resource.group_id) {
    const nextName = typeof updated.name === 'string' && updated.name.trim().length > 0
      ? updated.name.trim()
      : resource.name;
    const nextConfig = body.config
      ?? (typeof updated.config === 'string'
        ? safeJsonParseOrDefault<Record<string, unknown>>(updated.config, {})
        : (typeof resource.config === 'string'
          ? safeJsonParseOrDefault<Record<string, unknown>>(resource.config, {})
          : {}));

    if (nextName !== resource.name) {
      await removeGroupDesiredResource(c.env, {
        groupId: resource.group_id,
        name: resource.name,
      });
    }

    await upsertGroupDesiredResource(c.env, {
      groupId: resource.group_id,
      name: nextName,
      resource: buildProjectedResourceSpec(nextName, {
        type: resource.type as ResourceType,
        config: nextConfig,
      }) as never,
    });
  }

  return c.json({ resource: updated });
})

.patch('/:id/group',
  zValidator('json', z.object({
    group_id: z.string().nullable().optional(),
  })),
  async (c) => {
    const dbBinding = getPlatformServices(c).sql?.binding;
    const user = c.get('user');
    const resourceId = c.req.param('id');
    const body = c.req.valid('json') as { group_id?: string | null };
    if (!dbBinding) {
      throw new InternalError('Database binding unavailable');
    }

    const resource = await getResourceById(dbBinding, resourceId);
    if (!resource) {
      throw new NotFoundError('Resource');
    }
    if (resource.owner_id !== user.id) {
      throw new AuthorizationError('Only the owner can move this resource');
    }

    const nextGroupId = body.group_id?.trim() || null;
    if (nextGroupId) {
      const db = getDb(dbBinding);
      const group = await db.select({ id: groups.id, spaceId: groups.spaceId })
        .from(groups)
        .where(eq(groups.id, nextGroupId))
        .get();
      if (!group || group.spaceId !== resource.space_id) {
        throw new BadRequestError('group_id must belong to the same workspace as the resource');
      }
    }

    await getDb(dbBinding).update(resources)
      .set({
        groupId: nextGroupId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(resources.id, resourceId))
      .run();

    if (nextGroupId) {
      await upsertGroupDesiredResource(c.env, {
        groupId: nextGroupId,
        name: resource.name,
        resource: buildProjectedResourceSpec(resource.name, {
          type: resource.type as ResourceType,
          config: typeof resource.config === 'string'
            ? safeJsonParseOrDefault<Record<string, unknown>>(resource.config, {})
            : {},
        }) as never,
      });
    } else if (resource.group_id) {
      await removeGroupDesiredResource(c.env, {
        groupId: resource.group_id,
        name: resource.name,
      });
    }

    return c.json({ resource: await getResourceById(dbBinding, resourceId) });
  })

.delete('/:id', async (c) => {
  const dbBinding = getPlatformServices(c).sql?.binding;
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

  if (resource.group_id) {
    await removeGroupDesiredResource(c.env, {
      groupId: resource.group_id,
      name: resource.name,
    });
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
    await deleteManagedResource(c.env, {
      type: getStoredResourceImplementation(resource.type, resource.config) ?? resource.type,
      providerName: resource.provider_name ?? undefined,
      providerResourceId: resource.provider_resource_id,
      providerResourceName: resource.provider_resource_name,
    });
  } catch (err) {
    logError('Failed to delete managed resource', err, { module: 'routes/resources/base' });
  }

  await deleteResource(dbBinding, resourceId);

  return c.json({ success: true });
})

.get('/by-name/:name', async (c) => {
  const dbBinding = getPlatformServices(c).sql?.binding;
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
  const dbBinding = getPlatformServices(c).sql?.binding;
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

  if (resource.group_id) {
    await removeGroupDesiredResource(c.env, {
      groupId: resource.group_id,
      name: resource.name,
    });
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
    await deleteManagedResource(c.env, {
      type: getStoredResourceImplementation(resource.type, resource.config) ?? resource.type,
      providerName: resource.provider_name ?? undefined,
      providerResourceId: resource.provider_resource_id,
      providerResourceName: resource.provider_resource_name,
    });
  } catch (err) {
    logError('Failed to delete managed resource', err, { module: 'routes/resources/base' });
  }

  await deleteResource(dbBinding, resourceId);

  return c.json({ success: true });
});

export default resourcesBase;
