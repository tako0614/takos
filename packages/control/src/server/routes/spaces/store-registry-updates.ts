import type { Hono } from "hono";
import { z } from "zod";
import { BadRequestError, InternalError } from "takos-common/errors";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { zValidator } from "../zod-validator.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  formatStoreUpdate,
  requireStoreRegistryEntry,
  safeErrorMessage,
  storeRegistryRouteDeps,
} from "./store-registry-helpers.ts";

const markSeenSchema = z.object({
  update_ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

type StoreRegistryRouter = Hono<AuthenticatedRouteEnv>;

export function registerStoreRegistryUpdateRoutes(app: StoreRegistryRouter) {
  app.get("/:spaceId/store-registry/updates", async (c) => {
    const user = c.get("user");
    const access = await storeRegistryRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
    );

    try {
      const unseenOnly = c.req.query("unseen") === "true";
      const { limit, offset } = parsePagination(c.req.query(), {
        limit: 50,
        maxLimit: 100,
      });
      const result = await storeRegistryRouteDeps.getStoreUpdates(
        c.env.DB,
        access.space.id,
        { unseenOnly, limit, offset },
      );

      return c.json({
        total: result.total,
        updates: result.items.map(formatStoreUpdate),
      });
    } catch (error) {
      logError("Failed to get store updates", error, {
        module: "routes/store-registry",
      });
      throw new InternalError("Failed to get store updates");
    }
  });

  app.post(
    "/:spaceId/store-registry/updates/mark-seen",
    zValidator("json", markSeenSchema),
    async (c) => {
      const user = c.get("user");
      const access = await storeRegistryRouteDeps.requireSpaceAccess(
        c,
        c.req.param("spaceId"),
        user.id,
      );
      const body = c.req.valid("json");

      try {
        if (body.all) {
          await storeRegistryRouteDeps.markAllUpdatesSeen(
            c.env.DB,
            access.space.id,
          );
        } else if (body.update_ids?.length) {
          await storeRegistryRouteDeps.markUpdatesSeen(
            c.env.DB,
            access.space.id,
            body.update_ids,
          );
        }
        return c.json({ success: true });
      } catch (error) {
        logError("Failed to mark updates seen", error, {
          module: "routes/store-registry",
        });
        throw new InternalError("Failed to mark updates seen");
      }
    },
  );

  app.post("/:spaceId/store-registry/:entryId/poll", async (c) => {
    const user = c.get("user");
    const access = await storeRegistryRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
      ["owner", "admin"],
    );
    const entry = await requireStoreRegistryEntry(
      c.env.DB,
      access.space.id,
      c.req.param("entryId"),
    );

    try {
      const newUpdates = await storeRegistryRouteDeps.pollSingleStore(
        c.env.DB,
        entry,
      );
      return c.json({ new_updates: newUpdates });
    } catch (error) {
      logError("Failed to poll store", error, {
        module: "routes/store-registry",
      });
      throw new BadRequestError(
        safeErrorMessage(error, "Failed to poll store"),
      );
    }
  });
}
