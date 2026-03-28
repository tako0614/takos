import { Hono } from 'hono';
import { runGitCommand } from '../../runtime/git.js';
import { getErrorMessage } from 'takos-common/errors';
import {
  getVerifiedRepoPath,
  validateRef,
  validatePathParam,
  requireRepoParams,
} from './repo-validation.js';
import { badRequest, internalError, notFound } from 'takos-common/middleware/hono';

const app = new Hono();

// ---------------------------------------------------------------------------
// tree: ls-tree + blob
// ---------------------------------------------------------------------------

app.get('/repos/:spaceId/:repoName/tree', async (c) => {
  try {
    const spaceId = c.req.param('spaceId');
    const repoName = c.req.param('repoName');
    const ref = c.req.query('ref') || 'HEAD';
    const treePath = c.req.query('path') || '';

    const paramsErr = requireRepoParams(c, spaceId, repoName);
    if (paramsErr) return paramsErr;
    const refErr = validateRef(c, ref);
    if (refErr) return refErr;
    if (treePath) {
      const pathErr = validatePathParam(c, treePath);
      if (pathErr) return pathErr;
    }

    const repoResult = await getVerifiedRepoPath(c, spaceId, repoName);
    if ('error' in repoResult) return repoResult.error;
    const gitPath = repoResult.gitPath;

    const lsTreeArgs = ['ls-tree', '-l', ref];
    if (treePath) {
      lsTreeArgs.push('--', treePath);
    }

    const { exitCode, output } = await runGitCommand(lsTreeArgs, gitPath);

    if (exitCode !== 0) {
      if (output.includes('Not a valid object name') || output.includes('does not exist')) {
        return notFound(c, `Reference not found: ${ref}`, { output });
      }
      return internalError(c, 'Failed to list tree', { output });
    }

    const entries = output
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const tabIndex = line.indexOf('\t');
        if (tabIndex === -1) return null;

        const metaParts = line.slice(0, tabIndex).split(/\s+/);
        if (metaParts.length < 4) return null;

        const [mode, type, hash, sizeStr] = metaParts;
        const name = line.slice(tabIndex + 1);
        const parsedSize = type === 'blob' ? parseInt(sizeStr, 10) : undefined;
        const size = parsedSize !== undefined && Number.isFinite(parsedSize) ? parsedSize : undefined;

        return {
          mode,
          type: type as 'blob' | 'tree',
          hash,
          size,
          name,
          path: treePath ? `${treePath}/${name}` : name,
        };
      })
      .filter((entry) => entry !== null);

    return c.json({
      success: true,
      ref,
      path: treePath || '/',
      entries,
    });
  } catch (err) {
    return internalError(c, getErrorMessage(err));
  }
});

app.get('/repos/:spaceId/:repoName/blob', async (c) => {
  try {
    const spaceId = c.req.param('spaceId');
    const repoName = c.req.param('repoName');
    const ref = c.req.query('ref') || 'HEAD';
    const filePath = c.req.query('path');

    const paramsErr = requireRepoParams(c, spaceId, repoName);
    if (paramsErr) return paramsErr;

    if (!filePath) {
      return badRequest(c, 'path query parameter is required');
    }

    const refErr = validateRef(c, ref);
    if (refErr) return refErr;
    const pathErr = validatePathParam(c, filePath);
    if (pathErr) return pathErr;

    const repoResult = await getVerifiedRepoPath(c, spaceId, repoName);
    if ('error' in repoResult) return repoResult.error;
    const gitPath = repoResult.gitPath;

    const { exitCode, output } = await runGitCommand(['show', `${ref}:${filePath}`], gitPath);

    if (exitCode !== 0) {
      if (output.includes('does not exist') || output.includes('Not a valid object')) {
        return notFound(c, `File not found: ${filePath} at ${ref}`, { output });
      }
      return internalError(c, 'Failed to get file content', { output });
    }

    const lsResult = await runGitCommand(['ls-tree', '-l', ref, '--', filePath], gitPath);

    let size: number | undefined;
    let mode: string | undefined;
    if (lsResult.exitCode === 0 && lsResult.output.trim()) {
      const parts = lsResult.output.trim().split(/\s+/);
      if (parts.length >= 4) {
        mode = parts[0];
        const rawSize = parseInt(parts[3], 10);
        size = Number.isFinite(rawSize) ? rawSize : undefined;
      }
    }

    return c.json({
      success: true,
      ref,
      path: filePath,
      content: output,
      size,
      mode,
    });
  } catch (err) {
    return internalError(c, getErrorMessage(err));
  }
});

// ---------------------------------------------------------------------------
// history: commit log
// ---------------------------------------------------------------------------

app.get('/repos/:spaceId/:repoName/commits', async (c) => {
  try {
    const spaceId = c.req.param('spaceId');
    const repoName = c.req.param('repoName');
    const limit = c.req.query('limit') || '20';
    const branch = c.req.query('branch') || 'HEAD';

    const paramsErr = requireRepoParams(c, spaceId, repoName);
    if (paramsErr) return paramsErr;

    const repoResult = await getVerifiedRepoPath(c, spaceId, repoName);
    if ('error' in repoResult) return repoResult.error;
    const gitPath = repoResult.gitPath;

    const refErr = validateRef(c, branch);
    if (refErr) return refErr;

    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const { exitCode, output } = await runGitCommand(
      ['log', branch, `-n${limitNum}`, '--format=%H|%s|%an|%ae|%aI'],
      gitPath
    );

    if (exitCode !== 0) {
      if (output.includes('unknown revision') || output.includes('does not have any commits')) {
        return c.json({
          success: true,
          commits: [],
        });
      }
      return internalError(c, 'Failed to get commit history', { output });
    }

    const commits = output
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [hash, message, authorName, authorEmail, date] = line.split('|');
        return {
          hash,
          message,
          author: {
            name: authorName,
            email: authorEmail,
          },
          date,
        };
      });

    return c.json({
      success: true,
      commits,
    });
  } catch (err) {
    return internalError(c, getErrorMessage(err));
  }
});

export default app;
