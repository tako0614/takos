import { Hono, type Context } from 'hono';
import { eq, and, inArray, ne } from 'drizzle-orm';
import type { Env } from '../../../shared/types/index.ts';
import { spaceAccess, type SpaceAccessRouteEnv } from '../route-auth.ts';
import { getDb, groups, resources, services, deployments } from '../../../infra/db/index.ts';
import { BadRequestError, NotFoundError } from 'takos-common/errors';
import { getGroupState, planManifest, applyManifest } from '../../../application/services/deployment/apply-engine.ts';
import { parseAppManifestText, parseAppManifestYaml } from '../../../application/services/source/app-manifest-parser/index.ts';
import { getUpdateType } from '../../../application/services/deployment/store-install.ts';
import { safeJsonParseOrDefault } from '../../../shared/utils/logger.ts';
import type { AppManifest } from '../../../application/services/source/app-manifest-types.ts';

type GroupsContext = Context<SpaceAccessRouteEnv>;
type GroupRow = typeof groups.$inferSelect;
type GroupProviderName = 'cloudflare' | 'local' | 'aws' | 'gcp' | 'k8s';
const GROUP_PROVIDER_VALUES = ['cloudflare', 'local', 'aws', 'gcp', 'k8s'] as const;

function parseGroupProvider(raw: unknown): GroupProviderName | null {
  if (raw === undefined) return null;
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new BadRequestError(`Invalid provider: ${String(raw)}`);
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    throw new BadRequestError('provider must be a non-empty string');
  }
  if (!GROUP_PROVIDER_VALUES.includes(normalized as GroupProviderName)) {
    throw new BadRequestError(`Invalid provider: ${raw}`);
  }
  return normalized as GroupProviderName;
}

function parseGroupEnv(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    throw new BadRequestError(`Invalid env: ${String(raw)}`);
  }
  const normalized = raw.trim();
  if (!normalized) {
    throw new BadRequestError('env must be a non-empty string');
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------

function getGroupIdParam(c: GroupsContext): string {
  const groupId = c.req.param('groupId');
  if (!groupId) throw new BadRequestError('groupId param is required');
  return groupId;
}

function parseJsonField<T>(value: string | null): T | null {
  if (!value) return null;
  return safeJsonParseOrDefault<T | null>(value, null);
}

function toApiGroup(group: {
  id: string;
  spaceId: string;
  name: string;
  appVersion: string | null;
  provider: string | null;
  env: string | null;
  desiredSpecJson: string | null;
  providerStateJson: string | null;
  reconcileStatus: string;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    ...group,
    desiredSpecJson: parseJsonField(group.desiredSpecJson),
    providerStateJson: parseJsonField(group.providerStateJson),
  };
}

function parseDesiredManifestInput(raw: unknown): AppManifest {
  if (!raw) {
    throw new BadRequestError('desired manifest body is required');
  }
  try {
    return parseAppManifestText(JSON.stringify(raw));
  } catch (error) {
    throw new BadRequestError(
      error instanceof Error ? error.message : 'desired state must be a valid app manifest document',
    );
  }
}

async function assertGroupNameAvailable(
  env: Env,
  spaceId: string,
  groupName: string,
  excludeGroupId?: string,
): Promise<void> {
  const existing = await findGroupByName(env, spaceId, groupName);
  if (existing && existing.id !== excludeGroupId) {
    throw new BadRequestError(`Group "${groupName}" already exists in this workspace`);
  }
}

async function requireGroupInSpace(c: GroupsContext) {
  const { space } = c.get('access');
  const db = getDb(c.env.DB);
  const groupId = getGroupIdParam(c);
  const group = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.spaceId, space.id)))
    .get();
  if (!group) throw new NotFoundError('Group');
  return group;
}

async function findGroupByName(
  env: Env,
  spaceId: string,
  groupName: string,
): Promise<GroupRow | null> {
  const db = getDb(env.DB);
  return db.select()
    .from(groups)
    .where(and(eq(groups.spaceId, spaceId), eq(groups.name, groupName)))
    .get() as Promise<GroupRow | null>;
}

async function findGroupById(
  env: Env,
  groupId: string,
): Promise<GroupRow | null> {
  const db = getDb(env.DB);
  return db.select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .get() as Promise<GroupRow | null>;
}

async function updateGroupMetadata(
  env: Env,
  groupId: string,
  updates: {
    provider?: GroupProviderName | null;
    envName?: string | null;
  },
): Promise<GroupRow> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const row: {
    updatedAt: string;
    provider?: string | null;
    env?: string | null;
  } = {
    updatedAt: now,
  };
  if (Object.prototype.hasOwnProperty.call(updates, 'provider')) {
    row.provider = updates.provider ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'envName')) {
    row.env = updates.envName ?? null;
  }

  await db.update(groups).set(row).where(eq(groups.id, groupId)).run();
  const updated = await findGroupById(env, groupId);
  if (!updated) {
    throw new BadRequestError(`Group "${groupId}" not found`);
  }
  return updated;
}

async function createGroupByName(
  env: Env,
  input: {
    spaceId: string;
    groupName: string;
    provider?: GroupProviderName | null;
    envName?: string | null;
    appVersion?: string | null;
    manifest?: unknown;
  },
): Promise<GroupRow> {
  const db = getDb(env.DB);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    spaceId: input.spaceId,
    name: input.groupName,
    appVersion: input.appVersion ?? null,
    provider: input.provider ?? null,
    env: input.envName ?? null,
    desiredSpecJson: input.manifest ? JSON.stringify(input.manifest) : null,
    providerStateJson: '{}',
    reconcileStatus: 'idle',
    lastAppliedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(groups).values(row);
  return row;
}

async function ensureGroupByName(
  env: Env,
  input: {
    spaceId: string;
    groupName: string;
    provider?: GroupProviderName | null;
    envName?: string | null;
    appVersion?: string | null;
    manifest?: unknown;
  },
): Promise<GroupRow> {
  const existing = await findGroupByName(env, input.spaceId, input.groupName);
  if (existing) {
    return existing;
  }
  return createGroupByName(env, input);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listGroupsHandler(c: GroupsContext) {
  const { space } = c.get('access');
  const db = getDb(c.env.DB);
  const result = await db.select().from(groups).where(eq(groups.spaceId, space.id));
  return c.json({ groups: result.map((group) => toApiGroup(group)) });
}

async function createGroupHandler(c: GroupsContext) {
  const { space } = c.get('access');
  const db = getDb(c.env.DB);
  const body = await c.req.json();
  const provider = body.provider === undefined ? null : parseGroupProvider(body.provider);
  const envName = body.env === undefined ? null : parseGroupEnv(body.env);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(groups).values({
    id,
    spaceId: space.id,
    name: body.name,
    appVersion: body.appVersion ?? null,
    provider,
    env: envName,
    desiredSpecJson: body.desiredSpecJson ? JSON.stringify(body.desiredSpecJson) : null,
    providerStateJson: '{}',
    reconcileStatus: 'idle',
    lastAppliedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return c.json({ id, name: body.name }, 201);
}

async function getGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const observed = await getGroupState(c.env, group.id);
  const apiGroup = toApiGroup(group);
  return c.json({
    ...apiGroup,
    observed,
    inventory: observed
      ? {
          resources: Object.values(observed.resources),
          workloads: Object.values(observed.workloads),
          routes: Object.values(observed.routes),
        }
      : { resources: [], workloads: [], routes: [] },
  });
}

async function patchGroupMetadataHandler(c: GroupsContext) {
  const { space } = c.get('access');
  const group = await requireGroupInSpace(c);
  const body = await c.req.json();

  const nextName = typeof body.name === 'string' && body.name.trim().length > 0
    ? body.name.trim()
    : group.name;
  await assertGroupNameAvailable(c.env, space.id, nextName, group.id);

  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  const provider = body.provider === undefined ? undefined : parseGroupProvider(body.provider);
  const envName = body.env === undefined ? undefined : parseGroupEnv(body.env);
  await db.update(groups)
    .set({
      name: nextName,
      provider: body.provider === undefined ? group.provider : provider,
      env: body.env === undefined ? group.env : envName,
      appVersion: typeof body.appVersion === 'string' ? body.appVersion : group.appVersion,
      updatedAt: now,
    })
    .where(eq(groups.id, group.id))
    .run();

  const updated = await requireGroupInSpace(c);
  return c.json({ group: toApiGroup(updated) });
}

async function getGroupDesiredHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  return c.json({ desired: parseJsonField<AppManifest>(group.desiredSpecJson) });
}

async function putGroupDesiredHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const desired = parseDesiredManifestInput(await c.req.json());

  const db = getDb(c.env.DB);
  const now = new Date().toISOString();
  await db.update(groups)
    .set({
      appVersion: desired.spec.version ?? null,
      desiredSpecJson: JSON.stringify(desired),
      updatedAt: now,
    })
    .where(eq(groups.id, group.id))
    .run();

  const updated = await requireGroupInSpace(c);
  return c.json({ group: toApiGroup(updated), desired });
}

async function deleteGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const db = getDb(c.env.DB);
  const ownedResources = await db.select({ id: resources.id })
    .from(resources)
    .where(and(eq(resources.groupId, group.id), ne(resources.status, 'deleted')))
    .all();
  const ownedServices = await db.select({ id: services.id })
    .from(services)
    .where(eq(services.groupId, group.id))
    .all();

  if (ownedResources.length > 0 || ownedServices.length > 0) {
    throw new BadRequestError('Group still owns resources or services. Apply an empty manifest before deleting the group.');
  }

  await db.delete(groups).where(eq(groups.id, group.id));
  return c.json({ deleted: true });
}

async function listGroupResourcesHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const db = getDb(c.env.DB);
  const result = await db.select()
    .from(resources)
    .where(and(eq(resources.groupId, group.id), ne(resources.status, 'deleted')))
    .all();
  return c.json({
    resources: result.map((resource) => ({
      ...resource,
      config: parseJsonField(resource.config) ?? {},
      metadata: parseJsonField(resource.metadata) ?? {},
    })),
  });
}

async function listGroupServicesHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const db = getDb(c.env.DB);
  const result = await db.select()
    .from(services)
    .where(eq(services.groupId, group.id))
    .all();
  return c.json({
    services: result.map((service) => ({
      ...service,
      config: parseJsonField(service.config) ?? {},
    })),
  });
}

async function listGroupDeploymentsHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const db = getDb(c.env.DB);
  const ownedServices = await db.select({ id: services.id })
    .from(services)
    .where(eq(services.groupId, group.id))
    .all();
  const serviceIds = ownedServices.map((service) => service.id);

  if (serviceIds.length === 0) {
    return c.json({ deployments: [] });
  }

  const result = await db.select()
    .from(deployments)
    .where(inArray(deployments.serviceId, serviceIds))
    .all();
  return c.json({ deployments: result });
}

// ---------------------------------------------------------------------------
// Deployment: plan / apply / updates
// ---------------------------------------------------------------------------

async function planGroupHandler(c: GroupsContext) {
  let group = await requireGroupInSpace(c);
  const body = await c.req.json();
  const providerName = body.provider === undefined ? undefined : parseGroupProvider(body.provider);
  const groupEnv = body.env === undefined ? undefined : parseGroupEnv(body.env);

  if (body.provider !== undefined || body.env !== undefined) {
    group = await updateGroupMetadata(c.env, group.id, {
      provider: body.provider === undefined ? undefined : providerName,
      envName: body.env === undefined ? undefined : groupEnv,
    });
  }

  let manifest = body.manifest;
  if (typeof manifest === 'string') {
    manifest = parseAppManifestYaml(manifest);
  }

  const result = await planManifest(c.env, group.id, manifest, {
    envName: body.env === undefined ? undefined : groupEnv ?? undefined,
  });
  return c.json(result);
}

async function planGroupByNameHandler(c: GroupsContext) {
  const { space } = c.get('access');
  const body = await c.req.json();
  const providerName = parseGroupProvider(body.provider);
  const groupEnv = parseGroupEnv(body.env);

  let manifest = body.manifest;
  if (typeof manifest === 'string') {
    manifest = parseAppManifestYaml(manifest);
  }

  const groupName = typeof body.group_name === 'string' && body.group_name.trim().length > 0
    ? body.group_name.trim()
    : manifest?.metadata?.name;
  if (!groupName) {
    throw new BadRequestError('group_name is required');
  }

  let group = await findGroupByName(c.env, space.id, groupName);
  if (!group && !manifest) {
    throw new BadRequestError(`Group "${groupName}" does not exist and no manifest was provided`);
  }
  if (group && (body.provider !== undefined || body.env !== undefined)) {
    group = await updateGroupMetadata(c.env, group.id, {
      provider: body.provider === undefined ? undefined : providerName,
      envName: body.env === undefined ? undefined : groupEnv,
    });
  }

  const finalGroup = group ?? await createGroupByName(c.env, {
    spaceId: space.id,
    groupName,
    provider: body.provider === undefined ? undefined : providerName,
    envName: body.env === undefined ? undefined : groupEnv,
    appVersion: typeof manifest?.spec?.version === 'string' ? manifest.spec.version : null,
    manifest,
  });

  const result = await planManifest(c.env, finalGroup.id, manifest, {
    envName: body.env === undefined ? undefined : groupEnv ?? undefined,
  });
  return c.json({
    group: { id: finalGroup.id, name: finalGroup.name },
    ...result,
  });
}

async function applyGroupHandler(c: GroupsContext) {
  let group = await requireGroupInSpace(c);
  const body = await c.req.json();
  const providerName = body.provider === undefined ? undefined : parseGroupProvider(body.provider);
  const groupEnv = body.env === undefined ? undefined : parseGroupEnv(body.env);

  if (body.provider !== undefined || body.env !== undefined) {
    group = await updateGroupMetadata(c.env, group.id, {
      provider: body.provider === undefined ? undefined : providerName,
      envName: body.env === undefined ? undefined : groupEnv,
    });
  }

  let manifest = body.manifest;
  if (typeof manifest === 'string') {
    manifest = parseAppManifestYaml(manifest);
  }

  const result = await applyManifest(c.env, group.id, manifest, {
    artifacts: body.artifacts,
    target: body.target,
    envName: body.env === undefined ? undefined : groupEnv ?? undefined,
  });
  return c.json(result);
}

async function applyGroupByNameHandler(c: GroupsContext) {
  const { space } = c.get('access');
  const body = await c.req.json();
  const providerName = parseGroupProvider(body.provider);
  const groupEnv = parseGroupEnv(body.env);

  let manifest = body.manifest;
  if (typeof manifest === 'string') {
    manifest = parseAppManifestYaml(manifest);
  }

  const groupName = typeof body.group_name === 'string' && body.group_name.trim().length > 0
    ? body.group_name.trim()
    : manifest?.metadata?.name;
  if (!groupName) {
    throw new BadRequestError('group_name is required');
  }

  let group = await findGroupByName(c.env, space.id, groupName);
  if (!group && !manifest) {
    throw new BadRequestError(`Group "${groupName}" does not exist and no manifest was provided`);
  }
  if (group && (body.provider !== undefined || body.env !== undefined)) {
    group = await updateGroupMetadata(c.env, group.id, {
      provider: body.provider === undefined ? undefined : providerName,
      envName: body.env === undefined ? undefined : groupEnv,
    });
  }

  const finalGroup = group ?? await createGroupByName(c.env, {
    spaceId: space.id,
    groupName,
    provider: body.provider === undefined ? undefined : providerName,
    envName: body.env === undefined ? undefined : groupEnv,
    appVersion: typeof manifest?.spec?.version === 'string' ? manifest.spec.version : null,
    manifest,
  });

  const result = await applyManifest(c.env, finalGroup.id, manifest, {
    artifacts: body.artifacts,
    target: body.target,
    groupName: finalGroup.name,
    envName: body.env === undefined ? undefined : groupEnv ?? undefined,
  });

  return c.json({
    group: { id: finalGroup.id, name: finalGroup.name },
    ...result,
  });
}

async function updatesGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);

  const latest = c.req.query('latestVersion');
  if (!latest || !group.appVersion) {
    return c.json({
      available: false,
      currentVersion: group.appVersion,
      latestVersion: latest ?? null,
    });
  }

  const updateType = getUpdateType(group.appVersion, latest);
  return c.json({
    available: group.appVersion !== latest,
    currentVersion: group.appVersion,
    latestVersion: latest,
    updateType,
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const groupsRouter = new Hono<{ Bindings: Env }>();

// Group CRUD
groupsRouter
  .get('/spaces/:spaceId/groups', spaceAccess(), listGroupsHandler)
  .post('/spaces/:spaceId/groups', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), createGroupHandler)
  .post('/spaces/:spaceId/groups/plan', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), planGroupByNameHandler)
  .post('/spaces/:spaceId/groups/apply', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), applyGroupByNameHandler)
  .get('/spaces/:spaceId/groups/:groupId', spaceAccess(), getGroupHandler)
  .patch('/spaces/:spaceId/groups/:groupId/metadata', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), patchGroupMetadataHandler)
  .get('/spaces/:spaceId/groups/:groupId/desired', spaceAccess(), getGroupDesiredHandler)
  .put('/spaces/:spaceId/groups/:groupId/desired', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), putGroupDesiredHandler)
  .delete('/spaces/:spaceId/groups/:groupId', spaceAccess({ roles: ['owner', 'admin'] }), deleteGroupHandler)

  // Canonical group inventory
  .get('/spaces/:spaceId/groups/:groupId/resources', spaceAccess(), listGroupResourcesHandler)
  .get('/spaces/:spaceId/groups/:groupId/services', spaceAccess(), listGroupServicesHandler)
  .get('/spaces/:spaceId/groups/:groupId/deployments', spaceAccess(), listGroupDeploymentsHandler)

  // Deployment: plan / apply / updates
  .post('/spaces/:spaceId/groups/:groupId/plan', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), planGroupHandler)
  .post('/spaces/:spaceId/groups/:groupId/apply', spaceAccess({ roles: ['owner', 'admin', 'editor'] }), applyGroupHandler)
  .get('/spaces/:spaceId/groups/:groupId/updates', spaceAccess(), updatesGroupHandler);

export default groupsRouter;
