import { Hono } from 'hono';
import { z } from 'zod';
import {
  badRequest,
  notFound,
  requireWorkspaceAccess,
  type AuthenticatedRouteEnv,
} from '../shared/helpers';
import { zValidator } from '../zod-validator';
import {
  createActivityPubStore,
  deleteActivityPubStore,
  listActivityPubStoresForWorkspace,
  updateActivityPubStore,
} from '../../../application/services/activitypub/stores';
import { internalError } from '../../../shared/utils/error-response';
import { logError } from '../../../shared/utils/logger';

const storeBodySchema = z.object({
  slug: z.string().optional(),
  name: z.string().optional(),
  summary: z.string().optional(),
  icon_url: z.string().optional(),
});

export default new Hono<AuthenticatedRouteEnv>()
  .get('/:spaceId/stores', async (c) => {
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, c.req.param('spaceId'), user.id);
    if (access instanceof Response) return access;

    try {
      const stores = await listActivityPubStoresForWorkspace(c.env.DB, access.workspace.id);
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
      logError('Failed to list workspace stores', error, { module: 'routes/workspaces/stores' });
      return internalError(c, 'Failed to list stores');
    }
  })
  .post('/:spaceId/stores',
    zValidator('json', storeBodySchema),
    async (c) => {
      const user = c.get('user');
      const access = await requireWorkspaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);
      if (access instanceof Response) return access;

      const body = c.req.valid('json');
      if (!body.slug?.trim()) {
        return badRequest(c, 'slug is required');
      }

      try {
        const store = await createActivityPubStore(c.env.DB, access.workspace.id, {
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
          return badRequest(c, error.message);
        }
        logError('Failed to create workspace store', error, { module: 'routes/workspaces/stores' });
        return internalError(c, 'Failed to create store');
      }
    })
  .patch('/:spaceId/stores/:storeSlug',
    zValidator('json', storeBodySchema),
    async (c) => {
      const user = c.get('user');
      const access = await requireWorkspaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);
      if (access instanceof Response) return access;

      const body = c.req.valid('json');

      try {
        const store = await updateActivityPubStore(c.env.DB, access.workspace.id, c.req.param('storeSlug'), {
          name: body.name,
          summary: body.summary,
          iconUrl: body.icon_url,
        });
        if (!store) {
          return notFound(c, 'Store');
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
          return badRequest(c, error.message);
        }
        logError('Failed to update workspace store', error, { module: 'routes/workspaces/stores' });
        return internalError(c, 'Failed to update store');
      }
    })
  .delete('/:spaceId/stores/:storeSlug', async (c) => {
    const user = c.get('user');
    const access = await requireWorkspaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);
    if (access instanceof Response) return access;

    try {
      const deleted = await deleteActivityPubStore(c.env.DB, access.workspace.id, c.req.param('storeSlug'));
      if (!deleted) {
        return notFound(c, 'Store');
      }
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof Error) {
        return badRequest(c, error.message);
      }
      logError('Failed to delete workspace store', error, { module: 'routes/workspaces/stores' });
      return internalError(c, 'Failed to delete store');
    }
  });
