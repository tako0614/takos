import type { Hono } from "hono";
import { z } from "zod";
import { BadRequestError } from "takos-common/errors";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { zValidator } from "../zod-validator.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  formatRepository,
  parseRoutePage,
  requireStoreRegistryEntry,
  safeErrorMessage,
  storeRegistryRouteDeps,
} from "./store-registry-helpers.ts";

const installSchema = z.object({
  repository_ref_url: z.string().min(1),
  local_name: z.string().optional(),
});

type StoreRegistryRouter = Hono<AuthenticatedRouteEnv>;

export function registerStoreRegistryRepositoryRoutes(
  app: StoreRegistryRouter,
) {
  app.get("/:spaceId/store-registry/:entryId/repositories", async (c) => {
    const user = c.get("user");
    const access = await storeRegistryRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
    );
    const entry = await requireStoreRegistryEntry(
      c.env.DB,
      access.space.id,
      c.req.param("entryId"),
    );

    if (!entry.repositoriesUrl) {
      throw new BadRequestError(
        "Remote store does not expose an inventory endpoint",
      );
    }

    try {
      const page = parseRoutePage(c.req.query("page"));
      const { limit } = parsePagination(c.req.query());
      const collection = await storeRegistryRouteDeps.fetchRemoteRepositories(
        entry.repositoriesUrl,
        { page, limit, expand: true },
      );

      return c.json({
        total: collection.totalItems,
        page,
        limit,
        repositories: (collection.orderedItems || []).map(formatRepository),
      });
    } catch (error) {
      logError("Failed to browse remote repos", error, {
        module: "routes/store-registry",
      });
      throw new BadRequestError(
        safeErrorMessage(error, "Failed to browse remote repositories"),
      );
    }
  });

  app.get(
    "/:spaceId/store-registry/:entryId/repositories/search",
    async (c) => {
      const user = c.get("user");
      const access = await storeRegistryRouteDeps.requireSpaceAccess(
        c,
        c.req.param("spaceId"),
        user.id,
      );
      const entry = await requireStoreRegistryEntry(
        c.env.DB,
        access.space.id,
        c.req.param("entryId"),
      );

      if (!entry.searchUrl) {
        throw new BadRequestError(
          "Remote store does not expose a search endpoint",
        );
      }

      const query = c.req.query("q");
      if (!query?.trim()) {
        throw new BadRequestError("q parameter required");
      }

      try {
        const page = parseRoutePage(c.req.query("page"));
        const { limit } = parsePagination(c.req.query());
        const collection = await storeRegistryRouteDeps
          .searchRemoteRepositories(
            entry.searchUrl,
            query,
            { page, limit, expand: true },
          );

        return c.json({
          total: collection.totalItems,
          query,
          page,
          limit,
          repositories: (collection.orderedItems || []).map(formatRepository),
        });
      } catch (error) {
        logError("Failed to search remote repos", error, {
          module: "routes/store-registry",
        });
        throw new BadRequestError(
          safeErrorMessage(error, "Failed to search remote repositories"),
        );
      }
    },
  );

  app.post(
    "/:spaceId/store-registry/:entryId/import-repository",
    zValidator("json", installSchema),
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
        const result = await storeRegistryRouteDeps
          .importRepositoryFromRemoteStore(
            c.env.DB,
            access.space.id,
            {
              registryEntryId: c.req.param("entryId"),
              repositoryRefUrl: body.repository_ref_url,
              localName: body.local_name,
            },
          );

        return c.json({
          repository: {
            id: result.repositoryId,
            name: result.name,
            clone_url: result.cloneUrl,
            remote_store_url: result.remoteStoreUrl,
            remote_browse_url: result.remoteBrowseUrl,
          },
        }, 201);
      } catch (error) {
        logError("Failed to import repository from remote store", error, {
          module: "routes/store-registry",
        });
        throw new BadRequestError(
          safeErrorMessage(
            error,
            "Failed to import repository from remote store",
          ),
        );
      }
    },
  );
}
