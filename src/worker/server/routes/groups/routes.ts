import { type Context, Hono } from "hono";
import { and, eq, ne } from "drizzle-orm";
import type { Env } from "../../../shared/types/index.ts";
import { spaceAccess, type SpaceAccessRouteEnv } from "../route-auth.ts";
import { getDb, groups, resources, services } from "../../../infra/db/index.ts";
import { NotFoundError } from "@takos/worker-platform-utils/errors";
import { getGroupState } from "../../../application/services/deployment/apply-engine.ts";
import { getUpdateType } from "../../../application/services/deployment/store-install.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/logger.ts";
import { stripPublicInternalFields } from "../response-utils.ts";

type GroupsContext = Context<SpaceAccessRouteEnv>;

export const groupsRouteDeps = {
  getDb,
  getGroupState,
};

function getGroupIdParam(c: GroupsContext): string {
  const groupId = c.req.param("groupId");
  if (!groupId) throw new NotFoundError("Group");
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
  env: string | null;
  sourceKind: string | null;
  sourceRepositoryUrl: string | null;
  sourceRef: string | null;
  sourceRefType: string | null;
  sourceCommitSha: string | null;
  desiredSpecJson: string | null;
  reconcileStatus: string;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: group.id,
    spaceId: group.spaceId,
    name: group.name,
    appVersion: group.appVersion,
    env: group.env,
    sourceKind: group.sourceKind,
    sourceRepositoryUrl: group.sourceRepositoryUrl,
    sourceRef: group.sourceRef,
    sourceRefType: group.sourceRefType,
    sourceCommitSha: group.sourceCommitSha,
    desiredSpecJson: stripPublicInternalFields(
      parseJsonField(group.desiredSpecJson),
    ),
    reconcileStatus: group.reconcileStatus,
    lastAppliedAt: group.lastAppliedAt,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

function toApiGroupState(
  observed: Awaited<ReturnType<typeof groupsRouteDeps.getGroupState>>,
) {
  if (!observed) return null;
  const { backend: _backend, ...apiObserved } = observed;
  return stripPublicInternalFields(apiObserved);
}

async function requireGroupInSpace(c: GroupsContext) {
  const { space } = c.get("access");
  const db = groupsRouteDeps.getDb(c.env.DB);
  const groupId = getGroupIdParam(c);
  const group = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.spaceId, space.id)))
    .get();
  if (!group) throw new NotFoundError("Group");
  return group;
}

async function listGroupsHandler(c: GroupsContext) {
  const { space } = c.get("access");
  const db = groupsRouteDeps.getDb(c.env.DB);
  const result = await db.select().from(groups).where(
    eq(groups.spaceId, space.id),
  );
  return c.json({ groups: result.map((group) => toApiGroup(group)) });
}

async function getGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const observed = await groupsRouteDeps.getGroupState(c.env, group.id);
  const apiObserved = toApiGroupState(observed);
  const apiGroup = toApiGroup(group);
  return c.json({
    ...apiGroup,
    observed: apiObserved,
    inventory: observed
      ? {
        resources: stripPublicInternalFields(Object.values(observed.resources)),
        workloads: stripPublicInternalFields(Object.values(observed.workloads)),
        routes: stripPublicInternalFields(Object.values(observed.routes)),
      }
      : { resources: [], workloads: [], routes: [] },
  });
}

async function listGroupResourcesHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const db = groupsRouteDeps.getDb(c.env.DB);
  const result = await db.select()
    .from(resources)
    .where(
      and(eq(resources.groupId, group.id), ne(resources.status, "deleted")),
    )
    .all();
  return c.json({
    resources: result.map((resource) => ({
      ...stripPublicInternalFields(resource),
      config: stripPublicInternalFields(parseJsonField(resource.config) ?? {}),
      metadata: stripPublicInternalFields(
        parseJsonField(resource.metadata) ?? {},
      ),
    })),
  });
}

async function listGroupServicesHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const db = groupsRouteDeps.getDb(c.env.DB);
  const result = await db.select()
    .from(services)
    .where(eq(services.groupId, group.id))
    .all();
  return c.json({
    services: result.map((service) => ({
      ...stripPublicInternalFields(service),
      config: stripPublicInternalFields(parseJsonField(service.config) ?? {}),
    })),
  });
}

async function updatesGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const latest = c.req.query("latestVersion");
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

const groupsRouter = new Hono<{ Bindings: Env }>();

groupsRouter
  .get("/spaces/:spaceId/groups", spaceAccess(), listGroupsHandler)
  .get("/spaces/:spaceId/groups/:groupId", spaceAccess(), getGroupHandler)
  .get(
    "/spaces/:spaceId/groups/:groupId/resources",
    spaceAccess(),
    listGroupResourcesHandler,
  )
  .get(
    "/spaces/:spaceId/groups/:groupId/services",
    spaceAccess(),
    listGroupServicesHandler,
  )
  .get(
    "/spaces/:spaceId/groups/:groupId/updates",
    spaceAccess(),
    updatesGroupHandler,
  );

export default groupsRouter;
