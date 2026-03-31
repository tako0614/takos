import { Hono } from 'hono';
import { runGitCommand } from '../../runtime/git.ts';
import { getErrorMessage } from 'takos-common/errors';
import {
  getVerifiedRepoPath,
  validateRef,
  requireRepoParams,
} from './repo-validation.ts';
import { badRequest, internalError, notFound } from 'takos-common/middleware/hono';
import { ErrorCodes } from 'takos-common/errors';

const app = new Hono();

// ---------------------------------------------------------------------------
// branches: list, create, delete
// ---------------------------------------------------------------------------

app.get('/repos/:spaceId/:repoName/branches', async (c) => {
  try {
    const spaceId = c.req.param('spaceId');
    const repoName = c.req.param('repoName');

    const paramsErr = requireRepoParams(c, spaceId, repoName);
    if (paramsErr) return paramsErr;

    const repoResult = await getVerifiedRepoPath(c, spaceId, repoName);
    if ('error' in repoResult) return repoResult.error;
    const gitPath = repoResult.gitPath;

    const { exitCode, output } = await runGitCommand(
      ['branch', '--list', '--format=%(refname:short)'],
      gitPath
    );

    if (exitCode !== 0) {
      return internalError(c, 'Failed to list branches', { output });
    }

    const branches = output
      .split('\n')
      .map((branch) => branch.trim())
      .filter((branch) => branch.length > 0);

    return c.json({ success: true, branches });
  } catch (err) {
    return internalError(c, getErrorMessage(err));
  }
});

app.post('/repos/branch', async (c) => {
  try {
    const { spaceId, repoName, branchName, fromRef } = await c.req.json() as {
      spaceId: string;
      repoName: string;
      branchName: string;
      fromRef?: string;
    };

    if (!spaceId || !repoName || !branchName) {
      return badRequest(c, 'spaceId, repoName, and branchName are required');
    }

    const refErr = validateRef(c, branchName);
    if (refErr) return refErr;
    if (fromRef) {
      const fromRefErr = validateRef(c, fromRef);
      if (fromRefErr) return fromRefErr;
    }

    const repoResult = await getVerifiedRepoPath(c, spaceId, repoName);
    if ('error' in repoResult) return repoResult.error;
    const gitPath = repoResult.gitPath;

    const branchCheckResult = await runGitCommand(
      ['show-ref', '--verify', `refs/heads/${branchName}`],
      gitPath
    );
    if (branchCheckResult.exitCode === 0) {
      return c.json({ error: { code: ErrorCodes.CONFLICT, message: `Branch '${branchName}' already exists` } }, 409);
    }

    const sourceRef = fromRef || 'HEAD';
    const resolveResult = await runGitCommand(['rev-parse', sourceRef], gitPath);
    if (resolveResult.exitCode !== 0) {
      return badRequest(c, `Invalid reference: ${sourceRef}`, { output: resolveResult.output });
    }

    const commitHash = resolveResult.output.trim();
    const createResult = await runGitCommand(
      ['update-ref', `refs/heads/${branchName}`, commitHash],
      gitPath
    );

    if (createResult.exitCode !== 0) {
      return internalError(c, 'Failed to create branch', { output: createResult.output });
    }

    return c.json({
      success: true,
      branchName,
      commitHash,
      fromRef: sourceRef,
      message: `Branch '${branchName}' created successfully`,
    });
  } catch (err) {
    return internalError(c, getErrorMessage(err));
  }
});

app.delete('/repos/branch', async (c) => {
  try {
    const { spaceId, repoName, branchName } = await c.req.json() as {
      spaceId: string;
      repoName: string;
      branchName: string;
    };

    if (!spaceId || !repoName || !branchName) {
      return badRequest(c, 'spaceId, repoName, and branchName are required');
    }

    const refErr = validateRef(c, branchName);
    if (refErr) return refErr;

    if (branchName === 'main' || branchName === 'master') {
      return badRequest(c, `Cannot delete protected branch: ${branchName}`);
    }

    const repoResult = await getVerifiedRepoPath(c, spaceId, repoName);
    if ('error' in repoResult) return repoResult.error;
    const gitPath = repoResult.gitPath;

    const branchCheckResult = await runGitCommand(
      ['show-ref', '--verify', `refs/heads/${branchName}`],
      gitPath
    );
    if (branchCheckResult.exitCode !== 0) {
      return notFound(c, `Branch '${branchName}' not found`);
    }

    const deleteResult = await runGitCommand(
      ['update-ref', '-d', `refs/heads/${branchName}`],
      gitPath
    );

    if (deleteResult.exitCode !== 0) {
      return internalError(c, 'Failed to delete branch', { output: deleteResult.output });
    }

    return c.json({
      success: true,
      branchName,
      message: `Branch '${branchName}' deleted successfully`,
    });
  } catch (err) {
    return internalError(c, getErrorMessage(err));
  }
});

export default app;
