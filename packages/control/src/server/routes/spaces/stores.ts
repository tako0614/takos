import { Hono } from "hono";
import { z } from "zod";
import {
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
} from "../route-auth.ts";
import { BadRequestError, NotFoundError } from "takos-common/errors";
import { zValidator } from "../zod-validator.ts";
import {
  createActivityPubStore,
  deleteActivityPubStore,
  listActivityPubStoresForWorkspace,
  updateActivityPubStore,
} from "../../../application/services/activitypub/stores.ts";
import {
  addToInventory,
  findInventoryItemById,
  listInventoryItems,
  removeFromInventory,
} from "../../../application/services/activitypub/store-inventory.ts";
import {
  createGrant,
  listGrants,
  revokeGrant,
} from "../../../application/services/activitypub/grants.ts";
import { getRepositoryById } from "../../../application/services/source/repos.ts";
import { InternalError } from "takos-common/errors";
import { logError } from "../../../shared/utils/logger.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import {
  deliverToFollowers,
  resolveActivityDeliverySigning,
} from "../../../application/services/activitypub/activity-delivery.ts";

const storeBodySchema = z.object({
  slug: z.string().optional(),
  name: z.string().optional(),
  summary: z.string().optional(),
  icon_url: z.string().optional(),
});

export const spacesStoresRouteDeps = {
  requireSpaceAccess,
  listActivityPubStoresForWorkspace,
  createActivityPubStore,
  updateActivityPubStore,
  deleteActivityPubStore,
  addToInventory,
  removeFromInventory,
  listInventoryItems,
  findInventoryItemById,
  createGrant,
  listGrants,
  revokeGrant,
  deliverToFollowers,
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
        .listActivityPubStoresForWorkspace(c.env.DB, access.space.id);
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
      const store = await spacesStoresRouteDeps.createActivityPubStore(
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
        const store = await spacesStoresRouteDeps.updateActivityPubStore(
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
      const deleted = await spacesStoresRouteDeps.deleteActivityPubStore(
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
        // Canonical surface field names (per docs/reference/api.md).
        canonical_repo_url: item.repoActorUrl,
        label: item.repoName,
        // Legacy aliases kept for backward compatibility.
        repo_actor_url: item.repoActorUrl,
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
        // Canonical surface field (per docs/reference/api.md): the canonical repo URL.
        canonical_repo_url: z.string().min(1).optional(),
        // Legacy alias kept for backward compatibility with existing clients.
        repo_actor_url: z.string().min(1).optional(),
        // Canonical surface field: short human-readable label for the entry.
        label: z.string().optional(),
        // Legacy aliases kept for backward compatibility.
        repo_name: z.string().optional(),
        repo_summary: z.string().optional(),
        repo_owner_slug: z.string().optional(),
        local_repo_id: z.string().optional(),
      }).refine(
        (v) => !!(v.canonical_repo_url ?? v.repo_actor_url),
        {
          message: "canonical_repo_url is required",
          path: ["canonical_repo_url"],
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
        const canonicalRepoUrl =
          (body.canonical_repo_url ?? body.repo_actor_url) as string;
        const labelOrName = body.label ?? body.repo_name;
        const item = await spacesStoresRouteDeps.addToInventory(c.env.DB, {
          accountId: access.space.id,
          storeSlug,
          repoActorUrl: canonicalRepoUrl,
          repoName: labelOrName,
          repoSummary: body.repo_summary,
          repoOwnerSlug: body.repo_owner_slug,
          localRepoId: body.local_repo_id,
        });

        // Deliver Add activity to store followers (fire-and-forget)
        const origin = new URL(c.req.url).origin;
        const storeActorUrl = `${origin}/ap/stores/${
          encodeURIComponent(storeSlug)
        }`;
        const addActivity: Record<string, unknown> = {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Add",
          actor: storeActorUrl,
          published: item.createdAt,
          to: ["https://www.w3.org/ns/activitystreams#Public"],
          object: item.repoActorUrl,
          target: `${storeActorUrl}/inventory`,
        };
        const signing = resolveActivityDeliverySigning(c.env, storeActorUrl);
        if (signing) {
          c.executionCtx.waitUntil(
            spacesStoresRouteDeps.deliverToFollowers(
              c.env.DB,
              storeActorUrl,
              addActivity,
              signing.signingKeyPem,
              signing.keyId,
            )
              .catch((err: unknown) => {
                logError("Failed to deliver Add activity to followers", err, {
                  action: "deliver_inventory_add",
                  storeSlug,
                });
              }),
          );
        } else {
          logError(
            "Cannot deliver Add activity without PLATFORM_PRIVATE_KEY",
            undefined,
            {
              action: "deliver_inventory_add",
              storeSlug,
            },
          );
        }

        return c.json({
          item: {
            id: item.id,
            // Canonical surface field names (per docs/reference/api.md).
            canonical_repo_url: item.repoActorUrl,
            label: item.repoName,
            created_at: item.createdAt,
            // Legacy aliases kept for backward compatibility.
            repo_actor_url: item.repoActorUrl,
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

    // Resolve the entry by id (scoped to this space + store) so we can build
    // the federated Remove activity with the canonical repo URL.
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
      item.repoActorUrl,
    );

    // Deliver Remove activity to store followers (fire-and-forget)
    const origin = new URL(c.req.url).origin;
    const storeActorUrl = `${origin}/ap/stores/${
      encodeURIComponent(storeSlug)
    }`;
    const removeActivity: Record<string, unknown> = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Remove",
      actor: storeActorUrl,
      published: new Date().toISOString(),
      to: ["https://www.w3.org/ns/activitystreams#Public"],
      object: item.repoActorUrl,
      target: `${storeActorUrl}/inventory`,
    };
    const signing = resolveActivityDeliverySigning(c.env, storeActorUrl);
    if (signing) {
      c.executionCtx.waitUntil(
        spacesStoresRouteDeps.deliverToFollowers(
          c.env.DB,
          storeActorUrl,
          removeActivity,
          signing.signingKeyPem,
          signing.keyId,
        )
          .catch((err: unknown) => {
            logError("Failed to deliver Remove activity to followers", err, {
              action: "deliver_inventory_remove",
              storeSlug,
            });
          }),
      );
    } else {
      logError(
        "Cannot deliver Remove activity without PLATFORM_PRIVATE_KEY",
        undefined,
        {
          action: "deliver_inventory_remove",
          storeSlug,
        },
      );
    }

    // `deleted` is the canonical surface field per task spec; `success` is
    // kept for backward compatibility with existing clients.
    return c.json({ deleted: true, success: true });
  })
  // --- Repo Grants ---

  .get("/:spaceId/repos/:repoId/grants", async (c) => {
    const user = c.get("user");
    const access = await spacesStoresRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
    );

    const repoId = c.req.param("repoId");
    const repo = await getRepositoryById(c.env.DB, repoId);
    if (!repo || repo.space_id !== access.space.id) {
      throw new NotFoundError("Repository");
    }

    try {
      const grants = await spacesStoresRouteDeps.listGrants(c.env.DB, repoId);
      return c.json({
        grants: grants.map((grant) => ({
          id: grant.id,
          repo_id: grant.repoId,
          grantee_actor_url: grant.granteeActorUrl,
          capability: grant.capability,
          granted_by: grant.grantedBy,
          expires_at: grant.expiresAt,
          created_at: grant.createdAt,
        })),
      });
    } catch (error) {
      logError("Failed to list grants", error, {
        module: "routes/spaces/stores",
      });
      throw new InternalError("Failed to list grants");
    }
  })
  .post(
    "/:spaceId/repos/:repoId/grants",
    zValidator(
      "json",
      z.object({
        grantee_actor_url: z.string().min(1),
        capability: z.enum(["visit", "read", "write", "admin"]),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const access = await spacesStoresRouteDeps.requireSpaceAccess(
        c,
        c.req.param("spaceId"),
        user.id,
        ["owner", "admin"],
      );

      const repoId = c.req.param("repoId");
      const repo = await getRepositoryById(c.env.DB, repoId);
      if (!repo || repo.space_id !== access.space.id) {
        throw new NotFoundError("Repository");
      }

      const body = c.req.valid("json");

      try {
        const grant = await spacesStoresRouteDeps.createGrant(c.env.DB, {
          repoId,
          granteeActorUrl: body.grantee_actor_url,
          capability: body.capability,
          grantedBy: user.id,
        });
        return c.json({
          grant: {
            id: grant.id,
            repo_id: grant.repoId,
            grantee_actor_url: grant.granteeActorUrl,
            capability: grant.capability,
            granted_by: grant.grantedBy,
            expires_at: grant.expiresAt,
            created_at: grant.createdAt,
          },
        }, 201);
      } catch (error) {
        if (error instanceof Error) {
          throw new BadRequestError(error.message);
        }
        logError("Failed to create grant", error, {
          module: "routes/spaces/stores",
        });
        throw new InternalError("Failed to create grant");
      }
    },
  )
  .delete("/:spaceId/repos/:repoId/grants/:grantId", async (c) => {
    const user = c.get("user");
    const access = await spacesStoresRouteDeps.requireSpaceAccess(
      c,
      c.req.param("spaceId"),
      user.id,
      ["owner", "admin"],
    );

    const repoId = c.req.param("repoId");
    const repo = await getRepositoryById(c.env.DB, repoId);
    if (!repo || repo.space_id !== access.space.id) {
      throw new NotFoundError("Repository");
    }

    const grantId = c.req.param("grantId");

    // Verify the grant belongs to this repo before revoking
    const grants = await spacesStoresRouteDeps.listGrants(c.env.DB, repoId);
    const grant = grants.find((g) => g.id === grantId);
    if (!grant) {
      throw new NotFoundError("Grant");
    }

    await spacesStoresRouteDeps.revokeGrant(c.env.DB, grantId);
    return c.json({ success: true });
  });
