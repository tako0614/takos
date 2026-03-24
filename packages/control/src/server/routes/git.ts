import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../shared/types';
import { parseJsonBody, parseLimit, parseOffset, requireTenantSource, requireWorkspaceAccess, type BaseVariables } from './shared/helpers';
import { createGitService } from '../../application/services/source/git';
import { badRequest, internalError, notFound } from '../../shared/utils/error-response';
import { logError } from '../../shared/utils/logger';

const git = new Hono<{ Bindings: Env; Variables: BaseVariables }>();

function resolveGitService(c: Context<{ Bindings: Env; Variables: BaseVariables }>) {
  const tenantSource = requireTenantSource(c);
  if (tenantSource instanceof Response) {
    return tenantSource;
  }

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
    return badRequest(c, 'Invalid JSON body');
  }

  const access = await requireWorkspaceAccess(
    c,
    spaceId,
    user.id,
    ['owner', 'admin', 'editor'],
    'Workspace not found or insufficient permissions'
  );
  if (access instanceof Response) return access;

  if (!body.message || body.message.trim().length === 0) {
    return badRequest(c, 'Commit message is required');
  }

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commit = await gitService.commit(
      access.workspace.id,
      body.message.trim(),
      user.id,
      user.name,
      body.paths
    );

    return c.json({ commit }, 201);
  } catch (err) {
    logError('Git commit error', err, { module: 'routes/git' });
    return internalError(c, 'Commit failed');
  }
});

// Get commit history
git.get('/spaces/:spaceId/git/log', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const path = c.req.query('path');
  const limit = parseLimit(c.req.query('limit'), 50, 100);
  const offset = parseOffset(c.req.query('offset'));

  const access = await requireWorkspaceAccess(c, spaceId, user.id);
  if (access instanceof Response) return access;

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commits = await gitService.log(access.workspace.id, {
      limit,
      offset,
      path,
    });

    return c.json({ commits });
  } catch (err) {
    logError('Git log error', err, { module: 'routes/git' });
    return internalError(c, 'Failed to get commit history');
  }
});

// Get a specific commit
git.get('/spaces/:spaceId/git/commits/:commitId', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const commitId = c.req.param('commitId');

  const access = await requireWorkspaceAccess(c, spaceId, user.id);
  if (access instanceof Response) return access;

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commit = await gitService.getCommit(commitId);
    if (!commit) {
      return notFound(c, 'Commit');
    }

    if (commit.space_id !== access.workspace.id) {
      return notFound(c, 'Commit');
    }

    const changes = await gitService.getCommitChanges(commitId);

    return c.json({ commit, changes });
  } catch (err) {
    logError('Git show error', err, { module: 'routes/git' });
    return internalError(c, 'Failed to get commit');
  }
});

// Get diff for a commit
git.get('/spaces/:spaceId/git/diff/:commitId', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const commitId = c.req.param('commitId');

  const access = await requireWorkspaceAccess(c, spaceId, user.id);
  if (access instanceof Response) return access;

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commit = await gitService.getCommit(commitId);
    if (!commit) {
      return notFound(c, 'Commit');
    }

    if (commit.space_id !== access.workspace.id) {
      return notFound(c, 'Commit');
    }

    const diffs = await gitService.diff(access.workspace.id, commit.parent_id, commitId);

    return c.json({ commit, diffs });
  } catch (err) {
    logError('Git diff error', err, { module: 'routes/git' });
    return internalError(c, 'Failed to get diff');
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
    return badRequest(c, 'Invalid JSON body');
  }

  const access = await requireWorkspaceAccess(
    c,
    spaceId,
    user.id,
    ['owner', 'admin', 'editor'],
    'Workspace not found or insufficient permissions'
  );
  if (access instanceof Response) return access;

  if (!body.commit_id || !body.path) {
    return badRequest(c, 'commit_id and path are required');
  }

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const result = await gitService.restore(access.workspace.id, body.commit_id, body.path);

    if (!result.success) {
      return badRequest(c, result.message);
    }

    return c.json(result);
  } catch (err) {
    logError('Git restore error', err, { module: 'routes/git' });
    return internalError(c, 'Restore failed');
  }
});

// Get file history
git.get('/spaces/:spaceId/git/history/:path', async (c) => {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  const path = c.req.param('path');
  const limit = parseLimit(c.req.query('limit'), 20, 100);

  const access = await requireWorkspaceAccess(c, spaceId, user.id);
  if (access instanceof Response) return access;

  const gitService = resolveGitService(c);
  if (gitService instanceof Response) return gitService;

  try {
    const commits = await gitService.log(access.workspace.id, {
      limit,
      path: decodeURIComponent(path),
    });

    return c.json({ path, commits });
  } catch (err) {
    logError('Git history error', err, { module: 'routes/git' });
    return internalError(c, 'Failed to get file history');
  }
});

export default git;
