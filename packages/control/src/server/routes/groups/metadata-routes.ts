import type { Hono } from "hono";
import { spaceAccess } from "../route-auth.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { GroupsContext, GroupRouteBody } from "./helpers.ts";
import {
  assertGroupDeletable,
  listActiveGroupResources,
  listGroupDeployments,
  listGroupServices,
  listSpaceGroups,
  parseJsonField,
  parseGroupMetadataOverrides,
  requireGroupInSpace,
  requireNonEmptyString,
  revokeGroupTokensAndDelete,
  toApiGroup,
  updatePersistedGroupMetadata,
} from "./helpers.ts";
import { createGroupByName } from "../../../application/services/groups/records.ts";
import { groupRecordDeps, groupsRouteDeps } from "./deps.ts";

async function listGroupsHandler(c: GroupsContext) {
  const { space } = c.get("access");
  const result = await listSpaceGroups(c.env, space.id);
  return c.json({ groups: result.map((group) => toApiGroup(group)) });
}

async function createGroupHandler(c: GroupsContext) {
  const { space } = c.get("access");
  const body = await c.req.json<GroupRouteBody>();
  const overrides = parseGroupMetadataOverrides(body);
  const group = await createGroupByName(c.env, {
    spaceId: space.id,
    groupName: requireNonEmptyString(body.name, "name"),
    provider: overrides.providerProvided ? overrides.provider : null,
    envName: overrides.envProvided ? overrides.envName : null,
    appVersion: typeof body.appVersion === "string" ? body.appVersion : null,
    manifest: body.desiredSpecJson ?? null,
  }, groupRecordDeps());
  return c.json({ id: group.id, name: group.name }, 201);
}

async function getGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const observed = await groupsRouteDeps.getGroupState(c.env, group.id);
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
  const group = await requireGroupInSpace(c);
  const body = await c.req.json<GroupRouteBody>();
  const updated = await updatePersistedGroupMetadata(c, group, body);
  return c.json({ group: toApiGroup(updated) });
}

async function deleteGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  await assertGroupDeletable(c.env, group.id);
  await revokeGroupTokensAndDelete(c.env, group.id);
  return c.json({ deleted: true });
}

async function listGroupResourcesHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const result = await listActiveGroupResources(c.env, group.id);
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
  const result = await listGroupServices(c.env, group.id);
  return c.json({
    services: result.map((service) => ({
      ...service,
      config: parseJsonField(service.config) ?? {},
    })),
  });
}

async function listGroupDeploymentsHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const result = await listGroupDeployments(c.env, group.id);
  return c.json({ deployments: result });
}

export function registerMetadataRoutes(groupsRouter: Hono<{ Bindings: Env }>) {
  groupsRouter
    .get("/spaces/:spaceId/groups", spaceAccess(), listGroupsHandler)
    .post(
      "/spaces/:spaceId/groups",
      spaceAccess({ roles: ["owner", "admin", "editor"] }),
      createGroupHandler,
    )
    .get("/spaces/:spaceId/groups/:groupId", spaceAccess(), getGroupHandler)
    .patch(
      "/spaces/:spaceId/groups/:groupId/metadata",
      spaceAccess({ roles: ["owner", "admin", "editor"] }),
      patchGroupMetadataHandler,
    )
    .delete(
      "/spaces/:spaceId/groups/:groupId",
      spaceAccess({ roles: ["owner", "admin"] }),
      deleteGroupHandler,
    )
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
      "/spaces/:spaceId/groups/:groupId/deployments",
      spaceAccess(),
      listGroupDeploymentsHandler,
    );
}
