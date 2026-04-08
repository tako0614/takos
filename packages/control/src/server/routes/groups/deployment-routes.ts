import type { Hono } from "hono";
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
import { findGroupById } from "../../../application/services/groups/records.ts";
import type {
  ApplyManifestOpts,
  SafeApplyResult,
} from "../../../application/services/deployment/apply-engine.ts";
import { emitGroupLifecycleEvent } from "../events/routes.ts";

/**
 * Resolve the current `app_deployments.id` associated with a group, if any.
 *
 * Reads the `groups.current_app_deployment_id` projection column, which is
 * maintained by `AppDeploymentService.updateGroupProjectionIfApplied` after a
 * successful deploy. Apply paths that do not go through `AppDeploymentService`
 * (e.g. raw manifest applies via these routes) will leave the column at its
 * previous value, so this function returns the most recently linked
 * deployment id rather than necessarily the deployment that just ran.
 *
 * Returns `null` when the group has never been linked to an app deployment,
 * when the group row has been deleted, or when the lookup fails. Errors are
 * swallowed because the caller uses this purely to enrich a fire-and-forget
 * lifecycle event — never to gate the apply itself.
 */
async function resolveCurrentDeploymentId(
  env: Env,
  groupId: string,
): Promise<string | null> {
  try {
    const row = await findGroupById(env, groupId);
    return row?.currentAppDeploymentId ?? null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget emit of a `group.deployed` / `group.unhealthy` lifecycle
 * event after an apply finishes. Inspects the apply result for failed entries
 * and chooses the appropriate event type.
 *
 * Errors are swallowed by `emitGroupLifecycleEvent` itself — apply success is
 * never blocked on event delivery.
 */
async function emitDeployLifecycleEvent(
  env: Env,
  group: { id: string; spaceId: string; name: string },
  result: SafeApplyResult,
): Promise<void> {
  const failed = result.applied.some((entry) => entry.status === "failed");
  const deploymentId = await resolveCurrentDeploymentId(env, group.id);
  emitGroupLifecycleEvent(env, {
    type: failed ? "group.unhealthy" : "group.deployed",
    spaceId: group.spaceId,
    groupName: group.name,
    deploymentId,
  });
}

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
  await emitDeployLifecycleEvent(c.env, group, safeResult);
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

  await emitDeployLifecycleEvent(c.env, finalGroup, safeResult);

  return c.json({
    group: { id: finalGroup.id, name: finalGroup.name },
    ...safeResult,
  });
}

async function uninstallGroupByNameHandler(c: GroupsContext) {
  const body = await c.req.json<GroupRouteBody>();
  const group = await resolveGroupForUninstall(c, body);

  // Capture the deployment id BEFORE the uninstall apply, since the group row
  // (and its `current_app_deployment_id` projection) is deleted by
  // `revokeGroupTokensAndDelete` further down. Reading after the delete would
  // always return `null`.
  const deploymentId = await resolveCurrentDeploymentId(c.env, group.id);

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

  emitGroupLifecycleEvent(c.env, {
    type: "group.deleted",
    spaceId: group.spaceId,
    groupName: group.name,
    deploymentId,
  });

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

// TODO(events): when a dedicated rollback handler is added (currently
// rollback flows through `applyGroupHandler` with a previous-version manifest),
// emit `group.rollback` instead of `group.deployed`. The events router exposes
// `emitGroupLifecycleEvent({ type: "group.rollback", ... })` for this purpose.

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
