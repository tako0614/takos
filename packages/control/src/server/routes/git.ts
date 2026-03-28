import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../shared/types';
import { parseJsonBody, parseLimit, parseOffset, requireTenantSource, requireSpaceAccess, type BaseVariables } from './shared/route-auth';
import { createGitService } from '../../application/services/source/git';
import { BadRequestError, InternalError, NotFoundError } from '@takoserver/common/errors';
import { logError } from '../../shared/utils/logger';

const git = new Hono<{ Bindings: Env; Variables: BaseVariables }>();

function resolveGitService(c: Context<{ Bindings: Env; Variables: BaseVariables }>) {
  const tenantSource = requireTenantSource(c);

  return createGitService(
    c.env.DB,
    tenantSource as unknown as Parameters<typeof createGitService>[1],
  );
}

// Create a commit
git.post('/spaces/:spaceId/git/commit', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const body = await parseJsonBody<{
    message: string;
    paths?: string[];
  }>(c);

  if (!body) {
    throw new BadRequestError('Invalid JSON body');
  }

  const access = await requireSpaceAccess(
    c,
    spaceId,
    user.id,
    ['owner', 'admin', 'editor'],
    'Workspace not found or insufficient permissions'
  );

  if (!body.message || body.message.trim().length === 0) {
    throw new BadRequestError('Commit message is required');
  }

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commit = await gitService.commit(
      access.space.id,
      body.message.trim(),
      user.id,
      user.name,
      body.paths
    );

    return c.json({ commit }, 201);
  } catch (err) {
    logError('Git commit error', err, { module: 'routes/git' });
    throw new InternalError('Commit failed');
  }
});

// Get commit history
git.get('/spaces/:spaceId/git/log', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const path = c.req.query('path');
  const limit = parseLimit(c.req.query('limit'), 50, 100);
  const offset = parseOffset(c.req.query('offset'));

  const access = await requireSpaceAccess(c, spaceId, user.id);

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commits = await gitService.log(access.space.id, {
      limit,
      offset,
      path,
    });

    return c.json({ commits });
  } catch (err) {
    logError('Git log error', err, { module: 'routes/git' });
    throw new InternalError('Failed to get commit history');
  }
});

// Get a specific commit
git.get('/spaces/:spaceId/git/commits/:commitId', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const commitId = c.req.param('commitId');

  const access = await requireSpaceAccess(c, spaceId, user.id);

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commit = await gitService.getCommit(commitId);
    if (!commit) {
      throw new NotFoundError('Commit');
    }

    if (commit.space_id !== access.space.id) {
      throw new NotFoundError('Commit');
    }

    const changes = await gitService.getCommitChanges(commitId);

    return c.json({ commit, changes });
  } catch (err) {
    logError('Git show error', err, { module: 'routes/git' });
    throw new InternalError('Failed to get commit');
  }
});

// Get diff for a commit
git.get('/spaces/:spaceId/git/diff/:commitId', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const commitId = c.req.param('commitId');

  const access = await requireSpaceAccess(c, spaceId, user.id);

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commit = await gitService.getCommit(commitId);
    if (!commit) {
      throw new NotFoundError('Commit');
    }

    if (commit.space_id !== access.space.id) {
      throw new NotFoundError('Commit');
    }

    const diffs = await gitService.diff(access.space.id, commit.parent_id, commitId);

    return c.json({ commit, diffs });
  } catch (err) {
    logError('Git diff error', err, { module: 'routes/git' });
    throw new InternalError('Failed to get diff');
  }
});

// Restore a file to a previous version
git.post('/spaces/:spaceId/git/restore', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const body = await parseJsonBody<{
    commit_id: string;
    path: string;
  }>(c);

  if (!body) {
    throw new BadRequestError('Invalid JSON body');
  }

  const access = await requireSpaceAccess(
    c,
    spaceId,
    user.id,
    ['owner', 'admin', 'editor'],
    'Workspace not found or insufficient permissions'
  );

  if (!body.commit_id || !body.path) {
    throw new BadRequestError('commit_id and path are required');
  }

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const result = await gitService.restore(access.space.id, body.commit_id, body.path);

    if (!result.success) {
      throw new BadRequestError(result.message);
    }

    return c.json(result);
  } catch (err) {
    logError('Git restore error', err, { module: 'routes/git' });
    throw new InternalError('Restore failed');
  }
});

// Get file history
git.get('/spaces/:spaceId/git/history/:path', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const path = c.req.param('path');
  const limit = parseLimit(c.req.query('limit'), 20, 100);

  const access = await requireSpaceAccess(c, spaceId, user.id);

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commits = await gitService.log(access.space.id, {
      limit,
      path: decodeURIComponent(path),
    });

    return c.json({ path, commits });
  } catch (err) {
    logError('Git history error', err, { module: 'routes/git' });
    throw new InternalError('Failed to get file history');
  }
});

export default git;
