import { Hono } from 'hono';
import { z } from 'zod';
import {
  requireSpaceAccess,
  type AuthenticatedRouteEnv,
} from '../route-auth';
import { parsePagination } from '../../../shared/utils';
import { BadRequestError, NotFoundError } from 'takos-common/errors';
import { zValidator } from '../zod-validator';
import {
  addRemoteStore,
  listRegisteredStores,
  getRegistryEntry,
  removeRemoteStore,
  setActiveStore,
  refreshRemoteStore,
  setSubscription,
} from '../../../application/services/activitypub/store-registry';
import {
  fetchRemoteRepositories,
  searchRemoteRepositories,
  RemoteStoreError,
} from '../../../application/services/activitypub/remote-store-client';
import { installFromRemoteStore } from '../../../application/services/activitypub/remote-install';
import {
  getStoreUpdates,
  markUpdatesSeen,
  markAllUpdatesSeen,
  pollSingleStore,
} from '../../../application/services/activitypub/store-subscription';
import { InternalError } from 'takos-common/errors';
import { logError } from '../../../shared/utils/logger';

const addStoreSchema = z.object({
  identifier: z.string().min(1),
  set_active: z.boolean().optional(),
  subscribe: z.boolean().optional(),
});

const updateStoreSchema = z.object({
  is_active: z.boolean().optional(),
  subscription_enabled: z.boolean().optional(),
});

const installSchema = z.object({
  remote_owner: z.string().min(1),
  remote_repo_name: z.string().min(1),
  local_name: z.string().optional(),
});

const markSeenSchema = z.object({
  update_ids: z.array(z.string()).optional(),
  all: z.boolean().optional(),
});

/** Return error message safe for clients. Only RemoteStoreError messages are safe. */
function safeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof RemoteStoreError) return error.message;
  return fallback;
}

function formatEntry(entry: {
  id: string;
  actorUrl: string;
  domain: string;
  storeSlug: string;
  name: string;
  summary: string | null;
  iconUrl: string | null;
  isActive: boolean;
  subscriptionEnabled: boolean;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: entry.id,
    actor_url: entry.actorUrl,
    domain: entry.domain,
    store_slug: entry.storeSlug,
    name: entry.name,
    summary: entry.summary,
    icon_url: entry.iconUrl,
    is_active: entry.isActive,
    subscription_enabled: entry.subscriptionEnabled,
    last_fetched_at: entry.lastFetchedAt,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

export default new Hono<AuthenticatedRouteEnv>()

  // --- Registry CRUD ---

  .get('/:spaceId/store-registry', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id);

    try {
      const entries = await listRegisteredStores(c.env.DB, access.space.id);
      return c.json({ stores: entries.map(formatEntry) });
    } catch (error) {
      logError('Failed to list store registry', error, { module: 'routes/store-registry' });
      throw new InternalError('Failed to list store registry');
    }
  })

  .post('/:spaceId/store-registry',
    zValidator('json', addStoreSchema),
    async (c) => {
      const user = c.get('user');
      const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);

      const body = c.req.valid('json');

      try {
        const entry = await addRemoteStore(c.env.DB, access.space.id, {
          identifier: body.identifier,
          setActive: body.set_active,
          subscribe: body.subscribe,
        });
        return c.json({ store: formatEntry(entry) }, 201);
      } catch (error) {
        logError('Failed to add remote store', error, { module: 'routes/store-registry' });
        throw new BadRequestError( safeErrorMessage(error, 'Failed to add remote store'));
      }
    })

  .delete('/:spaceId/store-registry/:entryId', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);

    try {
      const deleted = await removeRemoteStore(c.env.DB, access.space.id, c.req.param('entryId'));
      if (!deleted) {
        throw new NotFoundError( 'Store registry entry');
      }
      return c.json({ success: true });
    } catch (error) {
      logError('Failed to remove store', error, { module: 'routes/store-registry' });
      throw new InternalError('Failed to remove store');
    }
  })

  .patch('/:spaceId/store-registry/:entryId',
    zValidator('json', updateStoreSchema),
    async (c) => {
      const user = c.get('user');
      const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);

      const body = c.req.valid('json');
      const entryId = c.req.param('entryId');

      try {
        // Verify entry exists before making any changes
        const existing = await getRegistryEntry(c.env.DB, access.space.id, entryId);
        if (!existing) {
          throw new NotFoundError( 'Store registry entry');
        }

        if (body.is_active !== undefined) {
          await setActiveStore(c.env.DB, access.space.id, body.is_active ? entryId : null);
        }

        if (body.subscription_enabled !== undefined) {
          await setSubscription(c.env.DB, access.space.id, entryId, body.subscription_enabled);
        }

        // Re-fetch to get updated state
        const entry = await getRegistryEntry(c.env.DB, access.space.id, entryId);
        return c.json({ store: formatEntry(entry!) });
      } catch (error) {
        logError('Failed to update store', error, { module: 'routes/store-registry' });
        throw new InternalError('Failed to update store');
      }
    })

  // --- Refresh remote store metadata ---

  .post('/:spaceId/store-registry/:entryId/refresh', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);

    try {
      const entry = await refreshRemoteStore(c.env.DB, access.space.id, c.req.param('entryId'));
      if (!entry) {
        throw new NotFoundError( 'Store registry entry');
      }
      return c.json({ store: formatEntry(entry) });
    } catch (error) {
      logError('Failed to refresh store', error, { module: 'routes/store-registry' });
      throw new BadRequestError( safeErrorMessage(error, 'Failed to refresh store'));
    }
  })

  // --- Browse remote store repositories ---

  .get('/:spaceId/store-registry/:entryId/repositories', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id);

    const entry = await getRegistryEntry(c.env.DB, access.space.id, c.req.param('entryId'));
    if (!entry) {
      throw new NotFoundError( 'Store registry entry');
    }

    if (!entry.repositoriesUrl) {
      throw new BadRequestError('Remote store does not expose an inventory endpoint');
    }

    try {
      const pageRaw = Number.parseInt(c.req.query('page') ?? '', 10);
      const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
      const { limit } = parsePagination(c.req.query());
      const collection = await fetchRemoteRepositories(entry.repositoriesUrl, {
        page,
        limit,
        expand: true,
      });

      return c.json({
        total: collection.totalItems,
        page,
        limit,
        repositories: (collection.orderedItems || []).map((repo) => ({
          id: repo.id,
          name: repo.name,
          summary: repo.summary,
          url: repo.url,
          owner: repo.owner,
          visibility: repo.visibility,
          default_branch: repo.defaultBranch,
          clone_url: repo.cloneUrl,
          browse_url: repo.browseUrl,
          published: repo.published,
          updated: repo.updated,
        })),
      });
    } catch (error) {
      logError('Failed to browse remote repos', error, { module: 'routes/store-registry' });
      throw new BadRequestError( safeErrorMessage(error, 'Failed to browse remote repositories'));
    }
  })

  // --- Search remote store repositories ---

  .get('/:spaceId/store-registry/:entryId/repositories/search', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id);

    const entry = await getRegistryEntry(c.env.DB, access.space.id, c.req.param('entryId'));
    if (!entry) {
      throw new NotFoundError( 'Store registry entry');
    }

    if (!entry.searchUrl) {
      throw new BadRequestError( 'Remote store does not expose a search endpoint');
    }

    const query = c.req.query('q');
    if (!query?.trim()) {
      throw new BadRequestError( 'q parameter required');
    }

    try {
      const pageRaw2 = Number.parseInt(c.req.query('page') ?? '', 10);
      const page = Number.isFinite(pageRaw2) && pageRaw2 > 0 ? pageRaw2 : 1;
      const { limit } = parsePagination(c.req.query());
      const collection = await searchRemoteRepositories(entry.searchUrl, query, {
        page,
        limit,
        expand: true,
      });

      return c.json({
        total: collection.totalItems,
        query,
        page,
        limit,
        repositories: (collection.orderedItems || []).map((repo) => ({
          id: repo.id,
          name: repo.name,
          summary: repo.summary,
          url: repo.url,
          owner: repo.owner,
          visibility: repo.visibility,
          default_branch: repo.defaultBranch,
          clone_url: repo.cloneUrl,
          browse_url: repo.browseUrl,
          published: repo.published,
          updated: repo.updated,
        })),
      });
    } catch (error) {
      logError('Failed to search remote repos', error, { module: 'routes/store-registry' });
      throw new BadRequestError( safeErrorMessage(error, 'Failed to search remote repositories'));
    }
  })

  // --- Install from remote store ---

  .post('/:spaceId/store-registry/:entryId/install',
    zValidator('json', installSchema),
    async (c) => {
      const user = c.get('user');
      const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);

      const body = c.req.valid('json');

      try {
        const result = await installFromRemoteStore(c.env.DB, access.space.id, {
          registryEntryId: c.req.param('entryId'),
          remoteOwner: body.remote_owner,
          remoteRepoName: body.remote_repo_name,
          localName: body.local_name,
        });

        return c.json({
          repository: {
            id: result.repositoryId,
            name: result.name,
            clone_url: result.cloneUrl,
            remote_store_actor_url: result.remoteStoreActorUrl,
            remote_browse_url: result.remoteBrowseUrl,
          },
        }, 201);
      } catch (error) {
        logError('Failed to install from remote store', error, { module: 'routes/store-registry' });
        throw new BadRequestError( safeErrorMessage(error, 'Failed to install from remote store'));
      }
    })

  // --- Subscription updates ---

  .get('/:spaceId/store-registry/updates', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id);

    try {
      const unseenOnly = c.req.query('unseen') === 'true';
      const { limit, offset } = parsePagination(c.req.query(), { limit: 50, maxLimit: 100 });

      const result = await getStoreUpdates(c.env.DB, access.space.id, {
        unseenOnly,
        limit,
        offset,
      });

      return c.json({
        total: result.total,
        updates: result.items.map((u) => ({
          id: u.id,
          registry_entry_id: u.registryEntryId,
          store_name: u.storeName,
          store_domain: u.storeDomain,
          activity_id: u.activityId,
          activity_type: u.activityType,
          object_id: u.objectId,
          object_type: u.objectType,
          object_name: u.objectName,
          object_summary: u.objectSummary,
          published: u.published,
          seen: u.seen,
          created_at: u.createdAt,
        })),
      });
    } catch (error) {
      logError('Failed to get store updates', error, { module: 'routes/store-registry' });
      throw new InternalError('Failed to get store updates');
    }
  })

  .post('/:spaceId/store-registry/updates/mark-seen',
    zValidator('json', markSeenSchema),
    async (c) => {
      const user = c.get('user');
      const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id);

      const body = c.req.valid('json');

      try {
        if (body.all) {
          await markAllUpdatesSeen(c.env.DB, access.space.id);
        } else if (body.update_ids?.length) {
          await markUpdatesSeen(c.env.DB, access.space.id, body.update_ids);
        }
        return c.json({ success: true });
      } catch (error) {
        logError('Failed to mark updates seen', error, { module: 'routes/store-registry' });
        throw new InternalError('Failed to mark updates seen');
      }
    })

  // --- Manual poll trigger ---

  .post('/:spaceId/store-registry/:entryId/poll', async (c) => {
    const user = c.get('user');
    const access = await requireSpaceAccess(c, c.req.param('spaceId'), user.id, ['owner', 'admin']);

    const entry = await getRegistryEntry(c.env.DB, access.space.id, c.req.param('entryId'));
    if (!entry) {
      throw new NotFoundError( 'Store registry entry');
    }

    try {
      const newUpdates = await pollSingleStore(c.env.DB, entry);
      return c.json({ new_updates: newUpdates });
    } catch (error) {
      logError('Failed to poll store', error, { module: 'routes/store-registry' });
      throw new BadRequestError( safeErrorMessage(error, 'Failed to poll store'));
    }
  });
