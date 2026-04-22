import { Hono } from "hono";
import type { ResourcePermission } from "../../../shared/types/index.ts";
import { type AuthenticatedRouteEnv, parseJsonBody } from "../route-auth.ts";
import { BadRequestError } from "takos-common/errors";
import {
  deleteResourceAccess,
  getResourceById,
  listResourceAccess,
  upsertResourceAccess,
} from "../../../application/services/resources/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import { accounts } from "../../../infra/db/schema.ts";
import { eq } from "drizzle-orm";
import { AuthorizationError, NotFoundError } from "takos-common/errors";

const resourcesAccess = new Hono<AuthenticatedRouteEnv>()
  .get("/:id/access", async (c) => {
    const user = c.get("user");
    const resourceId = c.req.param("id");

    const resource = await getResourceById(c.env.DB, resourceId);

    if (!resource) {
      throw new NotFoundError("Resource");
    }

    if (resource.owner_id !== user.id) {
      throw new AuthorizationError("Only the owner can view access grants");
    }

    const accessList = await listResourceAccess(c.env.DB, resourceId);

    return c.json({ access: accessList });
  })
  .post("/:id/access", async (c) => {
    const user = c.get("user");
    const resourceId = c.req.param("id");
    const body = await parseJsonBody<{
      space_id: string;
      permission: ResourcePermission;
    }>(c);

    if (!body) {
      throw new BadRequestError("Invalid JSON body");
    }

    const resource = await getResourceById(c.env.DB, resourceId);

    if (!resource) {
      throw new NotFoundError("Resource");
    }

    if (resource.owner_id !== user.id) {
      throw new AuthorizationError("Only the owner can share this resource");
    }

    if (!["read", "write", "admin"].includes(body.permission)) {
      throw new BadRequestError("Invalid permission level");
    }

    const db = getDb(c.env.DB);
    const workspace = await db.select({ id: accounts.id }).from(accounts).where(
      eq(accounts.id, body.space_id),
    ).get();

    if (!workspace) {
      throw new NotFoundError("Workspace");
    }

    const result = await upsertResourceAccess(c.env.DB, {
      resource_id: resourceId,
      space_id: body.space_id,
      permission: body.permission,
      granted_by: user.id,
    });

    if (!result.created) {
      return c.json({
        message: "Access permission updated",
        permission: result.permission,
      });
    }

    return c.json({ access: result.access }, 201);
  })
  .delete("/:id/access/:spaceId", async (c) => {
    const user = c.get("user");
    const resourceId = c.req.param("id");
    const spaceId = c.req.param("spaceId");

    const resource = await getResourceById(c.env.DB, resourceId);

    if (!resource) {
      throw new NotFoundError("Resource");
    }

    if (resource.owner_id !== user.id) {
      throw new AuthorizationError("Only the owner can revoke access");
    }

    await deleteResourceAccess(c.env.DB, resourceId, spaceId);

    return c.json({ success: true });
  });

export default resourcesAccess;
