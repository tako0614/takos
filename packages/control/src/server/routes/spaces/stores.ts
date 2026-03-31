import { Hono } from 'hono';
import { z } from 'zod';
import {
  requireSpaceAccess,
  type AuthenticatedRouteEnv,
} from '../route-auth';
import { BadRequestError, NotFoundError } from 'takos-common/errors';
import { zValidator } from '../zod-validator';
import {
  createActivityPubStore,
  deleteActivityPubStore,
  listActivityPubStoresForWorkspace,
  updateActivityPubStore,
} from '../../../application/services/activitypub/stores';
import {
  addToInventory,
  removeFromInventory,
  listInventoryItems,
} from '../../../application/services/activitypub/store-inventory';
import { InternalError } from 'takos-common/errors';
import { logError } from '../../../shared/utils/logger';
import { parsePagination } from '../../../shared/utils';

const storeBodySchema = z.object({
  slug: z.string().optional(),
  name: z.string().optional(),
  summary: z.string().optional(),
  icon_url: z.string().optional(),
});

export default new Hono<AuthenticatedRouteEnv>()
  .get('/:spaceId/stores', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id);

    try {
      const stores = await listActivityPubStoresForWorkspace(c.env.DB, access.space.id);
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
      logError('Failed to list workspace stores', error, { module: 'routes/spaces/stores' });
      throw new InternalError('Failed to list stores');
    }
  })
  .post('/:spaceId/stores',
    zValidator('json', storeBodySchema),
    async (c) => {
      const user = c.get('user');
      const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);

      const body = c.req.valid('json');
      if (!body.slug?.trim()) {
        throw new BadRequestError( 'slug is required');
      }

      try {
        const store = await createActivityPubStore(c.env.DB, access.space.id, {
          slug: body.slug,
          name: body.name,
          summary: body.summary,
          iconUrl: body.icon_url,
        });
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
          throw new BadRequestError( error.message);
        }
        logError('Failed to create workspace store', error, { module: 'routes/spaces/stores' });
        throw new InternalError('Failed to create store');
      }
    })
  .patch('/:spaceId/stores/:storeSlug',
    zValidator('json', storeBodySchema),
    async (c) => {
      const user = c.get('user');
      const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);

      const body = c.req.valid('json');

      try {
        const store = await updateActivityPubStore(c.env.DB, access.space.id, c.req.param('storeSlug'), {
          name: body.name,
          summary: body.summary,
          iconUrl: body.icon_url,
        });
        if (!store) {
          throw new NotFoundError( 'Store');
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
          throw new BadRequestError( error.message);
        }
        logError('Failed to update workspace store', error, { module: 'routes/spaces/stores' });
        throw new InternalError('Failed to update store');
      }
    })
  .delete('/:spaceId/stores/:storeSlug', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);

    try {
      const deleted = await deleteActivityPubStore(c.env.DB, access.space.id, c.req.param('storeSlug'));
      if (!deleted) {
        throw new NotFoundError( 'Store');
      }
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        throw new BadRequestError( error.message);
      }
      logError('Failed to delete workspace store', error, { module: 'routes/spaces/stores' });
      throw new InternalError('Failed to delete store');
    }
  })

  // --- Store Inventory ---

  .get('/:spaceId/stores/:storeSlug/inventory', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id);
    const { limit, offset } = parsePagination(c.req.query());

    const result = await listInventoryItems(c.env.DB, access.space.id, c.req.param('storeSlug'), { limit, offset });
    return c.json({
      total: result.total,
      items: result.items.map((item) => ({
        id: item.id,
        repo_actor_url: item.repoActorUrl,
        repo_name: item.repoName,
        repo_summary: item.repoSummary,
        repo_owner_slug: item.repoOwnerSlug,
        local_repo_id: item.localRepoId,
        created_at: item.createdAt,
      })),
    });
  })
  .post('/:spaceId/stores/:storeSlug/inventory',
    zValidator('json', z.object({
      repo_actor_url: z.string().min(1),
      repo_name: z.string().optional(),
      repo_summary: z.string().optional(),
      repo_owner_slug: z.string().optional(),
      local_repo_id: z.string().optional(),
    })),
    async (c) => {
      const user = c.get('user');
      const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);
      const body = c.req.valid('json');

      try {
        const item = await addToInventory(c.env.DB, {
          accountId: access.space.id,
          storeSlug: c.req.param('storeSlug'),
          repoActorUrl: body.repo_actor_url,
          repoName: body.repo_name,
          repoSummary: body.repo_summary,
          repoOwnerSlug: body.repo_owner_slug,
          localRepoId: body.local_repo_id,
        });
        return c.json({
          item: {
            id: item.id,
            repo_actor_url: item.repoActorUrl,
            repo_name: item.repoName,
            created_at: item.createdAt,
          },
        }, 201);
      } catch (error) {
        if (error instanceof Error) {
          throw new BadRequestError(error.message);
        }
        throw new InternalError('Failed to add to inventory');
      }
    })
  .delete('/:spaceId/stores/:storeSlug/inventory/:itemId', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);

    // Get the item to find the repoActorUrl
    const result = await listInventoryItems(c.env.DB, access.space.id, c.req.param('storeSlug'), { limit: 1000, offset: 0 });
    const item = result.items.find((i) => i.id === c.req.param('itemId'));
    if (!item) {
      throw new NotFoundError('Inventory item');
    }

    await removeFromInventory(c.env.DB, access.space.id, c.req.param('storeSlug'), item.repoActorUrl);
    return c.json({ success: true });
  });
