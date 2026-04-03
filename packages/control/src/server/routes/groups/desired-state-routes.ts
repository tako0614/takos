import type { Hono } from "hono";
import { spaceAccess } from "../route-auth.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { GroupsContext, GroupRouteBody } from "./helpers.ts";
import {
  buildPlanOptions,
  parseDesiredManifestInput,
  parseGroupDeployRequest,
  parseJsonField,
  requireGroupInSpace,
  resolveNamedManifestGroup,
  toApiGroup,
} from "./helpers.ts";
import { groupsRouteDeps } from "./deps.ts";
import { groups } from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import type { AppManifest } from "../../../application/services/source/app-manifest-types.ts";

async function getGroupDesiredHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  return c.json({
    desired: parseJsonField<AppManifest>(group.desiredSpecJson),
  });
}

async function putGroupDesiredHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const desired = parseDesiredManifestInput(await c.req.json());

  const db = groupsRouteDeps.getDb(c.env.DB);
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

async function planGroupHandler(c: GroupsContext) {
  const group = await requireGroupInSpace(c);
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body);

  const result = await groupsRouteDeps.planManifest(
    c.env,
    group.id,
    input.manifest,
    buildPlanOptions(group.name, group.provider, input),
  );
  return c.json(result);
}

async function planGroupByNameHandler(c: GroupsContext) {
  const body = await c.req.json<GroupRouteBody>();
  const input = parseGroupDeployRequest(body);
  const { groupName, group } = await resolveNamedManifestGroup(
    c,
    body,
    input.manifest,
  );

  const result = await groupsRouteDeps.planManifest(
    c.env,
    group?.id ?? null,
    input.manifest,
    buildPlanOptions(groupName, group?.provider, input),
  );
  return c.json({
    group: {
      id: group?.id ?? null,
      name: groupName,
      exists: !!group,
    },
    ...result,
  });
}

export function registerDesiredStateRoutes(
  groupsRouter: Hono<{ Bindings: Env }>,
) {
  groupsRouter
    .post(
      "/spaces/:spaceId/groups/plan",
      spaceAccess({ roles: ["owner", "admin", "editor"] }),
      planGroupByNameHandler,
    )
    .get(
      "/spaces/:spaceId/groups/:groupId/desired",
      spaceAccess(),
      getGroupDesiredHandler,
    )
    .put(
      "/spaces/:spaceId/groups/:groupId/desired",
      spaceAccess({ roles: ["owner", "admin", "editor"] }),
      putGroupDesiredHandler,
    )
    .post(
      "/spaces/:spaceId/groups/:groupId/plan",
      spaceAccess({ roles: ["owner", "admin", "editor"] }),
      planGroupHandler,
    );
}
