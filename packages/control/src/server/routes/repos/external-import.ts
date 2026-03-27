/**
 * External Git Repository Import Routes.
 *
 * POST /repos/import-external         — Import a repo from an external Git URL
 * POST /repos/:repoId/fetch-remote    — Re-fetch updates from the remote origin
 */

import { Hono } from 'hono';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import {
  importExternalRepository,
  fetchRemoteUpdates,
} from '../../../application/services/source/external-import';
import { buildAuthHeader } from '../../../application/services/source/external-import-utils';
import { getDb, repositories } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import { logError } from '../../../shared/utils/logger';

export default new Hono<AuthenticatedRouteEnv>()

  // ── Import external repository ──────────────────────────────────

  .post('/repos/import-external', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    let body: {
      url?: string;
      space_id?: string;
      name?: string;
      auth?: { token?: string; username?: string; password?: string };
      description?: string;
      visibility?: string;
    };

    try {
      body = await c.req.json();
    } catch {
      // Request body is not valid JSON
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { url, space_id, name, auth, description, visibility } = body;

    if (!url || typeof url !== 'string') {
      return c.json({ error: 'url is required' }, 400);
    }

    if (!space_id || typeof space_id !== 'string') {
      return c.json({ error: 'space_id is required' }, 400);
    }

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return c.json({ error: 'Only https:// URLs are supported' }, 400);
      }
    } catch {
      // URL constructor throws on malformed input
      return c.json({ error: 'Invalid URL format' }, 400);
    }

    const bucket = c.env.GIT_OBJECTS;
    if (!bucket) {
      return c.json({ error: 'Git storage not configured' }, 500);
    }

    const authHeader = buildAuthHeader(auth);

    try {
      const result = await importExternalRepository(c.env.DB, bucket, {
        accountId: space_id,
        url,
        name: typeof name === 'string' ? name : undefined,
        authHeader,
        description: typeof description === 'string' ? description : undefined,
        visibility: visibility === 'public' ? 'public' : 'private',
      });

      return c.json({
        repository: {
          id: result.repositoryId,
          name: result.name,
          default_branch: result.defaultBranch,
          remote_clone_url: result.remoteUrl,
        },
        import_summary: {
          branches: result.branchCount,
          tags: result.tagCount,
          commits: result.commitCount,
        },
      }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      logError('External import failed', err, { module: 'routes/external-import' });

      if (message.includes('already exists')) {
        return c.json({ error: message }, 409);
      }
      if (message.includes('HTTP 401') || message.includes('HTTP 403')) {
        return c.json({ error: 'Authentication failed — check your credentials' }, 401);
      }
      if (message.includes('HTTP 404')) {
        return c.json({ error: 'Repository not found at the given URL' }, 404);
      }

      return c.json({ error: message }, 500);
    }
  })

  // ── Fetch remote updates ────────────────────────────────────────

  .post('/repos/:repoId/fetch-remote', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Authentication required' }, 401);

    const repoId = c.req.param('repoId');
    if (!repoId) return c.json({ error: 'repoId is required' }, 400);

    const bucket = c.env.GIT_OBJECTS;
    if (!bucket) {
      return c.json({ error: 'Git storage not configured' }, 500);
    }

    // Verify repo exists and has a remote URL
    const db = getDb(c.env.DB);
    const repo = await db.select({
      id: repositories.id,
      remoteCloneUrl: repositories.remoteCloneUrl,
      accountId: repositories.accountId,
    }).from(repositories)
      .where(eq(repositories.id, repoId))
      .get();

    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    if (!repo.remoteCloneUrl) {
      return c.json({ error: 'Repository does not have a remote origin' }, 400);
    }

    try {
      const result = await fetchRemoteUpdates(c.env.DB, bucket, repoId);

      return c.json({
        new_commits: result.newCommits,
        updated_branches: result.updatedBranches,
        new_tags: result.newTags,
        up_to_date: result.newCommits === 0 && result.updatedBranches.length === 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fetch failed';
      logError('Remote fetch failed', err, { module: 'routes/external-import' });
      return c.json({ error: message }, 500);
    }
  });
