import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
} from "../route-auth.ts";
import { BadRequestError, NotFoundError } from "takos-common/errors";
import { zValidator } from "../zod-validator.ts";
import {
  createStore,
  deleteStore,
  listStoresForWorkspace,
  updateStore,
} from "../../../application/services/store-network/stores.ts";
import {
  addToInventory,
  findInventoryItemById,
  listInventoryItems,
  removeFromInventory,
} from "../../../application/services/store-network/store-inventory.ts";
import { InternalError } from "takos-common/errors";
import { logError } from "../../../shared/utils/logger.ts";
import { parsePagination } from "../../../shared/utils/index.ts";

const storeBodySchema = z.object({
  slug: z.string().optional(),
  name: z.string().optional(),
  summary: z.string().optional(),
  icon_url: z.string().optional(),
});

export const spacesStoresRouteDeps = {
  requireSpaceAccess,
  listStoresForWorkspace,
  createStore,
  updateStore,
  deleteStore,
  addToInventory,
  removeFromInventory,
  listInventoryItems,
  findInventoryItemById,
};

export default new Hono<AuthenticatedRouteEnv>()
  .get("/:spaceId/stores", async (c) => {
    const user = c.get("user");
    const access = await spacesStoresRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
    );

    try {
      const stores = await spacesStoresRouteDeps
        .listStoresForWorkspace(c.env.DB, access.space.id);
      return c.json({
        stores: stores.map((store) => ({
          slug: store.slug,
          name: store.name,
          summary: store.summary,
          icon_url: store.iconUrl,
          is_default: store.isDefault,
          created_at: store.createdAt,
          updated_at: store.updatedAt,
        })),
      });
    } catch (error) {
      logError("Failed to list workspace stores", error, {
        module: "routes/spaces/stores",
      });
      throw new InternalError("Failed to list stores");
    }
  })
  .post("/:spaceId/stores", zValidator("json", storeBodySchema), async (c) => {
    const user = c.get("user");
    const access = await spacesStoresRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
      ["owner", "admin"],
    );

    const body = c.req.valid("json");
    if (!body.slug?.trim()) {
      throw new BadRequestError("slug is required");
    }

    try {
      const store = await spacesStoresRouteDeps.createStore(
        c.env.DB,
        access.space.id,
        {
          slug: body.slug,
          name: body.name,
          summary: body.summary,
          iconUrl: body.icon_url,
        },
      );
      return c.json({
        store: {
          slug: store.slug,
          name: store.name,
          summary: store.summary,
          icon_url: store.iconUrl,
          is_default: store.isDefault,
          created_at: store.createdAt,
          updated_at: store.updatedAt,
        },
      }, 201);
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestError(error.message);
      }
      logError("Failed to create workspace store", error, {
        module: "routes/spaces/stores",
      });
      throw new InternalError("Failed to create store");
    }
  })
  .patch(
    "/:spaceId/stores/:storeSlug",
    zValidator("json", storeBodySchema),
    async (c) => {
      const user = c.get("user");
      const access = await spacesStoresRouteDeps.requireSpaceAccess(
        c,
        c.req.param("spaceId"),
        user.id,
        ["owner", "admin"],
      );

      const body = c.req.valid("json");

      try {
        const store = await spacesStoresRouteDeps.updateStore(
          c.env.DB,
          access.space.id,
          c.req.param("storeSlug"),
          {
            name: body.name,
            summary: body.summary,
            iconUrl: body.icon_url,
          },
        );
        if (!store) {
          throw new NotFoundError("Store");
        }

        return c.json({
          store: {
            slug: store.slug,
            name: store.name,
            summary: store.summary,
            icon_url: store.iconUrl,
            is_default: store.isDefault,
            created_at: store.createdAt,
            updated_at: store.updatedAt,
          },
        });
      } catch (error) {
        if (error instanceof Error) {
          throw new BadRequestError(error.message);
        }
        logError("Failed to update workspace store", error, {
          module: "routes/spaces/stores",
        });
        throw new InternalError("Failed to update store");
      }
    },
  )
  .delete("/:spaceId/stores/:storeSlug", async (c) => {
    const user = c.get("user");
    const access = await spacesStoresRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
      ["owner", "admin"],
    );

    try {
      const deleted = await spacesStoresRouteDeps.deleteStore(
        c.env.DB,
        access.space.id,
        c.req.param("storeSlug"),
      );
      if (!deleted) {
        throw new NotFoundError("Store");
      }
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestError(error.message);
      }
      logError("Failed to delete workspace store", error, {
        module: "routes/spaces/stores",
      });
      throw new InternalError("Failed to delete store");
    }
  })
  // --- Store Inventory ---

  .get("/:spaceId/stores/:storeSlug/inventory", async (c) => {
    const user = c.get("user");
    const access = await spacesStoresRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
    );
    const { limit, offset } = parsePagination(c.req.query());

    const result = await spacesStoresRouteDeps.listInventoryItems(
      c.env.DB,
      access.space.id,
      c.req.param("storeSlug"),
      { limit, offset },
    );
    return c.json({
      total: result.total,
      items: result.items.map((item) => ({
        id: item.id,
        repository_url: item.repositoryUrl,
        label: item.repoName,
        clone_url: item.repoCloneUrl,
        browse_url: item.repoBrowseUrl,
        default_branch: item.repoDefaultBranch,
        default_branch_hash: item.repoDefaultBranchHash,
        package_icon: item.packageIcon,
        repo_name: item.repoName,
        repo_summary: item.repoSummary,
        repo_owner_slug: item.repoOwnerSlug,
        local_repo_id: item.localRepoId,
        created_at: item.createdAt,
      })),
    });
  })
  .post(
    "/:spaceId/stores/:storeSlug/inventory",
    zValidator(
      "json",
      z.object({
        repository_url: z.string().min(1).optional(),
        clone_url: z.string().optional(),
        browse_url: z.string().optional(),
        default_branch: z.string().optional(),
        default_branch_hash: z.string().optional(),
        label: z.string().optional(),
        repo_name: z.string().optional(),
        repo_summary: z.string().optional(),
        repo_owner_slug: z.string().optional(),
        local_repo_id: z.string().optional(),
      }).refine(
        (v) => !!v.repository_url,
        {
          message: "repository_url is required",
          path: ["repository_url"],
        },
      ),
    ),
    async (c) => {
      const user = c.get("user");
      const access = await spacesStoresRouteDeps.requireSpaceAccess(
        c,
        c.req.param("spaceId"),
        user.id,
        ["owner", "admin"],
      );
      const body = c.req.valid("json");

      try {
        const storeSlug = c.req.param("storeSlug");
        const repositoryUrl = body.repository_url as string;
        const labelOrName = body.label ?? body.repo_name;
        const item = await spacesStoresRouteDeps.addToInventory(c.env.DB, {
          accountId: access.space.id,
          storeSlug,
          repositoryUrl,
          repoName: labelOrName,
          repoSummary: body.repo_summary,
          repoOwnerSlug: body.repo_owner_slug,
          repoCloneUrl: body.clone_url,
          repoBrowseUrl: body.browse_url,
          repoDefaultBranch: body.default_branch,
          repoDefaultBranchHash: body.default_branch_hash,
          localRepoId: body.local_repo_id,
        });

        return c.json({
          item: {
            id: item.id,
            repository_url: item.repositoryUrl,
            label: item.repoName,
            clone_url: item.repoCloneUrl,
            browse_url: item.repoBrowseUrl,
            default_branch: item.repoDefaultBranch,
            default_branch_hash: item.repoDefaultBranchHash,
            package_icon: item.packageIcon,
            created_at: item.createdAt,
            repo_name: item.repoName,
          },
        }, 201);
      } catch (error) {
        if (error instanceof Error) {
          throw new BadRequestError(error.message);
        }
        throw new InternalError("Failed to add to inventory");
      }
    },
  )
  .delete("/:spaceId/stores/:storeSlug/inventory/:itemId", async (c) => {
    const user = c.get("user");
    const access = await spacesStoresRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
      ["owner", "admin"],
    );

    const storeSlug = c.req.param("storeSlug");
    const itemId = c.req.param("itemId");

    // Resolve the entry by id (scoped to this space + store) so deletion can
    // target the stored repository URL without scanning the full inventory.
    const item = await spacesStoresRouteDeps.findInventoryItemById(
      c.env.DB,
      access.space.id,
      storeSlug,
      itemId,
    );
    if (!item) {
      throw new NotFoundError("Inventory item");
    }

    await spacesStoresRouteDeps.removeFromInventory(
      c.env.DB,
      access.space.id,
      storeSlug,
      item.repositoryUrl,
    );

    return c.json({ deleted: true, success: true });
  });
