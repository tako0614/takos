import type { Hono } from "hono";
import { z } from "zod";
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { zValidator } from "../zod-validator.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  formatEntry,
  requireStoreRegistryEntry,
  safeErrorMessage,
  storeRegistryRouteDeps,
} from "./store-registry-helpers.ts";

const addStoreSchema = z.object({
  identifier: z.string().min(1),
  set_active: z.boolean().optional(),
  subscribe: z.boolean().optional(),
});

const updateStoreSchema = z.object({
  is_active: z.boolean().optional(),
  subscription_enabled: z.boolean().optional(),
});

type StoreRegistryRouter = Hono<AuthenticatedRouteEnv>;

export function registerStoreRegistryCrudRoutes(app: StoreRegistryRouter) {
  app.get("/:spaceId/store-registry", async (c) => {
    const user = c.get("user");
    const access = await storeRegistryRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
    );

    try {
      const entries = await storeRegistryRouteDeps.listRegisteredStores(
        c.env.DB,
        access.space.id,
      );
      return c.json({ stores: entries.map(formatEntry) });
    } catch (error) {
      logError("Failed to list store registry", error, {
        module: "routes/store-registry",
      });
      throw new InternalError("Failed to list store registry");
    }
  });

  app.post(
    "/:spaceId/store-registry",
    zValidator("json", addStoreSchema),
    async (c) => {
      const user = c.get("user");
      const access = await storeRegistryRouteDeps.requireSpaceAccess(
        c,
        c.req.param("spaceId"),
        user.id,
        ["owner", "admin"],
      );
      const body = c.req.valid("json");

      try {
        const entry = await storeRegistryRouteDeps.addRemoteStore(
          c.env.DB,
          access.space.id,
          {
            identifier: body.identifier,
            setActive: body.set_active,
            subscribe: body.subscribe,
          },
        );
        return c.json({ store: formatEntry(entry) }, 201);
      } catch (error) {
        logError("Failed to add remote store", error, {
          module: "routes/store-registry",
        });
        throw new BadRequestError(
          safeErrorMessage(error, "Failed to add remote store"),
        );
      }
    },
  );

  app.delete("/:spaceId/store-registry/:entryId", async (c) => {
    const user = c.get("user");
    const access = await storeRegistryRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
      ["owner", "admin"],
    );

    try {
      const deleted = await storeRegistryRouteDeps.removeRemoteStore(
        c.env.DB,
        access.space.id,
        c.req.param("entryId"),
      );
      if (!deleted) {
        throw new NotFoundError("Store registry entry");
      }
      return c.json({ success: true });
    } catch (error) {
      logError("Failed to remove store", error, {
        module: "routes/store-registry",
      });
      throw new InternalError("Failed to remove store");
    }
  });

  app.patch(
    "/:spaceId/store-registry/:entryId",
    zValidator("json", updateStoreSchema),
    async (c) => {
      const user = c.get("user");
      const access = await storeRegistryRouteDeps.requireSpaceAccess(
        c,
        c.req.param("spaceId"),
        user.id,
        ["owner", "admin"],
      );
      const body = c.req.valid("json");
      const entryId = c.req.param("entryId");

      try {
        await requireStoreRegistryEntry(c.env.DB, access.space.id, entryId);

        if (body.is_active !== undefined) {
          await storeRegistryRouteDeps.setActiveStore(
            c.env.DB,
            access.space.id,
            body.is_active ? entryId : null,
          );
        }

        if (body.subscription_enabled !== undefined) {
          await storeRegistryRouteDeps.setSubscription(
            c.env.DB,
            access.space.id,
            entryId,
            body.subscription_enabled,
          );
        }

        const entry = await requireStoreRegistryEntry(
          c.env.DB,
          access.space.id,
          entryId,
        );
        return c.json({ store: formatEntry(entry) });
      } catch (error) {
        logError("Failed to update store", error, {
          module: "routes/store-registry",
        });
        throw new InternalError("Failed to update store");
      }
    },
  );

  app.post("/:spaceId/store-registry/:entryId/refresh", async (c) => {
    const user = c.get("user");
    const access = await storeRegistryRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
      ["owner", "admin"],
    );

    try {
      const entry = await storeRegistryRouteDeps.refreshRemoteStore(
        c.env.DB,
        access.space.id,
        c.req.param("entryId"),
      );
      if (!entry) {
        throw new NotFoundError("Store registry entry");
      }
      return c.json({ store: formatEntry(entry) });
    } catch (error) {
      logError("Failed to refresh store", error, {
        module: "routes/store-registry",
      });
      throw new BadRequestError(
        safeErrorMessage(error, "Failed to refresh store"),
      );
    }
  });
}
