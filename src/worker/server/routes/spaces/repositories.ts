import { Hono } from "hono";
import {
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
} from "../route-auth.ts";
import { initDefaultRepository } from "../../../application/services/identity/spaces.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { InternalError } from "@takos/worker-platform-utils/errors";

export default new Hono<AuthenticatedRouteEnv>()
  .post("/:spaceId/init-repo", async (c) => {
    const user = c.get("user");
    const spaceIdentifier = c.req.param("spaceId");

    const access = await requireSpaceAccess(
      c,
      spaceIdentifier,
      user.id,
      ["owner", "admin"],
      "Workspace not found or insufficient permissions",
    );

    const spaceId = access.space.id;

    let result;
    try {
      result = await initDefaultRepository(c.env.DB, spaceId);
    } catch (err) {
      logError(`Failed to init repo for workspace ${spaceId}`, err, {
        module: "routes/spaces/repositories",
      });
      throw new InternalError(
        err instanceof Error ? err.message : "Failed to initialize repository",
      );
    }

    if (!result.created) {
      return c.json({
        message: "Repository already exists",
        skipped: true,
        repository: result.repository,
      });
    }

    return c.json({
      message: "Repository initialized successfully",
      repository: result.repository,
    }, 201);
  });
