import { Hono, type Context } from 'hono';
import { eq, and, inArray, ne } from 'drizzle-orm';
import type { Env } from '../../shared/types';
import { spaceAccess, type SpaceAccessRouteEnv } from './route-auth';
import { getDb, groups, resources, services, deployments } from '../../infra/db';
import { BadRequestError, NotFoundError } from 'takos-common/errors';
import { getGroupState, planManifest, applyManifest } from '../../application/services/deployment/apply-engine';
import { parseAppManifestYaml } from '../../application/services/source/app-manifest-parser';
import { getUpdateType } from '../../application/services/deployment/store-install';
import { safeJsonParseOrDefault } from '../../shared/utils/logger';

type GroupsContext = Context<SpaceAccessRouteEnv>;

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
  manifestJson: string | null;
  desiredSpecJson: string | null;
  observedStateJson: string | null;
  providerStateJson: string | null;
  reconcileStatus: string;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    ...group,
    manifestJson: parseJsonField(group.manifestJson),
    desiredSpecJson: parseJsonField(group.desiredSpecJson),
    observedStateJson: parseJsonField(group.observedStateJson),
    providerStateJson: parseJsonField(group.providerStateJson),
  };
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
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(groups).values({
    id,
    spaceId: space.id,
    name: body.name,
    appVersion: body.appVersion ?? null,
    provider: body.provider ?? null,
    env: body.env ?? null,
    manifestJson: body.manifestJson ? JSON.stringify(body.manifestJson) : null,
    desiredSpecJson: null,
    observedStateJson: null,
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
  return c.json({
    ...toApiGroup(group),
    inventory: observed
      ? {
          resources: Object.values(observed.resources),
          workloads: Object.values(observed.workloads),
          routes: Object.values(observed.routes),
        }
      : { resources: [], workloads: [], routes: [] },
  });
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
  const group = await requireGroupInSpace(c);
  const body = await c.req.json();

  let manifest = body.manifest;
  if (typeof manifest === 'string') {
    manifest = parseAppManifestYaml(manifest);
  }

  const diff = await planManifest(c.env, group.id, manifest);
  return c.json(diff);
}

async function applyGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const body = await c.req.json();

  let manifest = body.manifest;
  if (typeof manifest === 'string') {
    manifest = parseAppManifestYaml(manifest);
  }

  const result = await applyManifest(c.env, group.id, manifest, {
    target: body.target,
  });
  return c.json(result);
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
  .get('/spaces/:spaceId/groups/:groupId', spaceAccess(), getGroupHandler)
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
