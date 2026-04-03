import type { Hono } from "hono";
import { ConflictError } from "takos-common/errors";
import { spaceAccess } from "../route-auth.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { GroupsContext, GroupRouteBody } from "./helpers.ts";
import {
  applyGroupMetadataOverrides,
  applyManifestForGroup,
  assertUninstallCompleted,
  buildUninstallManifest,
  buildUpdatesResponse,
  createOrReuseGroupForApply,
  parseGroupDeployRequest,
  requireGroupInSpace,
  resolveGroupForUninstall,
  revokeGroupTokensAndDelete,
} from "./helpers.ts";
import { groupsRouteDeps } from "./deps.ts";
import type { ApplyManifestOpts } from "../../../application/services/deployment/apply-engine.ts";

async function applyGroupHandler(c: GroupsContext) {
  let group = await requireGroupInSpace(c);
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body);
  group = await applyGroupMetadataOverrides(c.env, group, input);

  const safeResult = await applyManifestForGroup(
    c.env,
    group,
    input.manifest,
    {
      artifacts: body.artifacts as ApplyManifestOpts["artifacts"],
      target: body.target as ApplyManifestOpts["target"],
      envName: input.envProvided ? input.envName ?? undefined : undefined,
      source: input.source,
    },
  );
  return c.json(safeResult);
}

async function applyGroupByNameHandler(c: GroupsContext) {
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body);
  const { finalGroup } = await createOrReuseGroupForApply(c, body, input);

  const safeResult = await applyManifestForGroup(
    c.env,
    finalGroup,
    input.manifest,
    {
      artifacts: body.artifacts as ApplyManifestOpts["artifacts"],
      target: body.target as ApplyManifestOpts["target"],
      groupName: finalGroup.name,
      envName: input.envProvided ? input.envName ?? undefined : undefined,
      source: input.source,
    },
  );

  return c.json({
    group: { id: finalGroup.id, name: finalGroup.name },
    ...safeResult,
  });
}

async function uninstallGroupByNameHandler(c: GroupsContext) {
  const body = await c.req.json<GroupRouteBody>();
  const group = await resolveGroupForUninstall(c, body);

  const safeResult = await applyManifestForGroup(
    c.env,
    group,
    buildUninstallManifest(group),
    {
      groupName: group.name,
      envName: group.env ?? undefined,
    },
  );

  const observed = await groupsRouteDeps.getGroupState(c.env, group.id);
  assertUninstallCompleted(safeResult, observed);

  await revokeGroupTokensAndDelete(c.env, group.id);

  return c.json({
    group: { id: group.id, name: group.name },
    apply_result: safeResult,
    uninstalled: true,
    deleted_group: true,
  });
}

async function updatesGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const latest = c.req.query("latestVersion");
  return c.json(buildUpdatesResponse(group, latest));
}

export function registerDeploymentRoutes(
  groupsRouter: Hono<{ Bindings: Env }>,
) {
  groupsRouter
    .post(
      "/spaces/:spaceId/groups/apply",
      spaceAccess({ roles: ["owner", "admin", "editor"] }),
      applyGroupByNameHandler,
    )
    .post(
      "/spaces/:spaceId/groups/uninstall",
      spaceAccess({ roles: ["owner", "admin", "editor"] }),
      uninstallGroupByNameHandler,
    )
    .post(
      "/spaces/:spaceId/groups/:groupId/apply",
      spaceAccess({ roles: ["owner", "admin", "editor"] }),
      applyGroupHandler,
    )
    .get(
      "/spaces/:spaceId/groups/:groupId/updates",
      spaceAccess(),
      updatesGroupHandler,
    );
}
