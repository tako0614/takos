import { Hono } from 'hono';
import { runGitCommand } from '../../runtime/git.js';
import { validateGitAuthorName, validateGitAuthorEmail } from '../../runtime/validation.js';
import { mergeTempDirManager } from '../../utils/temp-dir.js';
import { getErrorMessage } from '@takos/common/errors';
import {
  getVerifiedRepoPath,
  validateRef,
  resolveAndValidateWorkDir,
  requireRepoParams,
} from './repo-validation.js';
import { isBoundaryViolationError } from '../../shared/errors.js';
import { badRequest, forbidden, internalError, notFound } from '@takos/common/middleware/hono';
import { ErrorCodes } from '@takos/common/errors';

const app = new Hono();

// ---------------------------------------------------------------------------
// commit + push
// ---------------------------------------------------------------------------

app.post('/repos/commit', async (c) => {
  try {
    const { workDir, message, author } = await c.req.json() as {
      workDir: string;
      message: string;
      author?: { name: string; email: string };
    };

    if (!workDir || !message) {
      return badRequest(c, 'workDir and message are required');
    }

    const workDirResult = await resolveAndValidateWorkDir(c, workDir);
    if ('error' in workDirResult) return workDirResult.error;
    const resolvedWorkDir = workDirResult.resolved;

    const gitEnv: Record<string, string> = {};
    if (author) {
      try {
        validateGitAuthorName(author.name);
        validateGitAuthorEmail(author.email);
      } catch (err) {
        return badRequest(c, getErrorMessage(err));
      }

      gitEnv.GIT_AUTHOR_NAME = author.name;
      gitEnv.GIT_AUTHOR_EMAIL = author.email;
      gitEnv.GIT_COMMITTER_NAME = author.name;
      gitEnv.GIT_COMMITTER_EMAIL = author.email;
    }

    const addResult = await runGitCommand(['add', '-A'], resolvedWorkDir, gitEnv);
    if (addResult.exitCode !== 0) {
      return internalError(c, 'Failed to stage changes', { output: addResult.output });
    }

    const statusResult = await runGitCommand(['status', '--porcelain'], resolvedWorkDir, gitEnv);
    if (statusResult.output.trim() === '') {
      return c.json({ success: true, message: 'No changes to commit', committed: false });
    }

    const commitResult = await runGitCommand(['commit', '-m', message], resolvedWorkDir, gitEnv);
    if (commitResult.exitCode !== 0) {
      return internalError(c, 'Failed to commit changes', { output: commitResult.output });
    }

    const hashResult = await runGitCommand(['rev-parse', 'HEAD'], resolvedWorkDir, gitEnv);

    return c.json({
      success: true,
      committed: true,
      commitHash: hashResult.output.trim(),
      message: 'Changes committed successfully',
    });
  } catch (err) {
    if (isBoundaryViolationError(err)) {
      return forbidden(c, 'Path escapes workdir boundary');
    }
    return internalError(c, getErrorMessage(err));
  }
});

app.post('/repos/push', async (c) => {
  try {
    const { workDir, branch } = await c.req.json() as {
      workDir: string;
      branch?: string;
    };

    if (!workDir) {
      return badRequest(c, 'workDir is required');
    }

    const workDirResult = await resolveAndValidateWorkDir(c, workDir);
    if ('error' in workDirResult) return workDirResult.error;
    const resolvedWorkDir = workDirResult.resolved;

    let branchToPush = branch;
    if (!branchToPush) {
      const branchResult = await runGitCommand(
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        resolvedWorkDir
      );
      branchToPush = branchResult.output.trim() || 'main';
    }

    const refErr = validateRef(c, branchToPush);
    if (refErr) return refErr;

    const { exitCode, output } = await runGitCommand(
      ['push', 'origin', branchToPush],
      resolvedWorkDir
    );

    if (exitCode !== 0) {
      return internalError(c, 'Failed to push to origin', { output });
    }

    return c.json({
      success: true,
      branch: branchToPush,
      message: 'Pushed to origin successfully',
    });
  } catch (err) {
    if (isBoundaryViolationError(err)) {
      return forbidden(c, 'Path escapes workdir boundary');
    }
    return internalError(c, getErrorMessage(err));
  }
});

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

app.get('/repos/:spaceId/:repoName/diff', async (c) => {
  try {
    const spaceId = c.req.param('spaceId');
    const repoName = c.req.param('repoName');
    const base = c.req.query('base');
    const head = c.req.query('head');

    const paramsErr = requireRepoParams(c, spaceId, repoName);
    if (paramsErr) return paramsErr;

    if (!base || !head) {
      return badRequest(c, 'base and head query parameters are required');
    }

    const baseRefErr = validateRef(c, base);
    if (baseRefErr) return baseRefErr;
    const headRefErr = validateRef(c, head);
    if (headRefErr) return headRefErr;

    if (base.startsWith('--') || head.startsWith('--')) {
      return badRequest(c, 'Invalid ref format');
    }

    const repoResult = await getVerifiedRepoPath(c, spaceId, repoName);
    if ('error' in repoResult) return repoResult.error;
    const gitPath = repoResult.gitPath;

    const { exitCode, output } = await runGitCommand(['diff', `${base}...${head}`], gitPath);

    if (exitCode !== 0) {
      return internalError(c, 'Failed to generate diff', { output });
    }

    return c.json({ success: true, diff: output, base, head });
  } catch (err) {
    return internalError(c, getErrorMessage(err));
  }
});

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

function isConflictLine(line: string): boolean {
  return ['UU', 'AA', 'DD'].some((prefix) => line.startsWith(prefix));
}

app.post('/repos/merge', async (c) => {
  try {
    const { spaceId, repoName, sourceBranch, targetBranch, message } = await c.req.json() as {
      spaceId: string;
      repoName: string;
      sourceBranch: string;
      targetBranch: string;
      message?: string;
    };

    if (!spaceId || !repoName || !sourceBranch || !targetBranch) {
      return badRequest(c, 'spaceId, repoName, sourceBranch, and targetBranch are required');
    }

    const sourceRefErr = validateRef(c, sourceBranch);
    if (sourceRefErr) return sourceRefErr;
    const targetRefErr = validateRef(c, targetBranch);
    if (targetRefErr) return targetRefErr;

    const repoResult = await getVerifiedRepoPath(c, spaceId, repoName);
    if ('error' in repoResult) return repoResult.error;
    const gitPath = repoResult.gitPath;

    const tempDir = await mergeTempDirManager.createTempDirWithCleanup(
      `takos-merge-${spaceId.slice(0, 8)}-`
    );

    try {
      const cloneResult = await runGitCommand(['clone', gitPath, tempDir], '/');
      if (cloneResult.exitCode !== 0) {
        return internalError(c, 'Failed to clone repository for merge', { output: cloneResult.output });
      }

      const checkoutResult = await runGitCommand(['checkout', targetBranch], tempDir);
      if (checkoutResult.exitCode !== 0) {
        return badRequest(c, `Failed to checkout target branch: ${targetBranch}`, { output: checkoutResult.output });
      }

      const mergeArgs = ['merge', sourceBranch, '--no-edit'];
      if (message) {
        if (typeof message !== 'string' || message.length > 4096) {
          return badRequest(c, 'Merge message must be a string of at most 4096 characters');
        }
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(message)) {
          return badRequest(c, 'Merge message contains invalid control characters');
        }
        mergeArgs.push('-m', message);
      }

      const mergeResult = await runGitCommand(mergeArgs, tempDir);

      if (mergeResult.exitCode !== 0) {
        const statusResult = await runGitCommand(['status', '--porcelain'], tempDir);
        const statusLines = statusResult.output.split('\n');
        const conflictFiles = statusLines.filter(isConflictLine).map((line) => line.slice(3).trim());

        if (conflictFiles.length > 0) {
          await runGitCommand(['merge', '--abort'], tempDir);
          return c.json({ error: { code: ErrorCodes.CONFLICT, message: 'Merge conflict', details: { conflicts: conflictFiles, output: mergeResult.output } } }, 409);
        }

        return internalError(c, 'Failed to merge branches', { output: mergeResult.output });
      }

      const hashResult = await runGitCommand(['rev-parse', 'HEAD'], tempDir);
      const commitHash = hashResult.output.trim();

      const pushResult = await runGitCommand(['push', 'origin', targetBranch], tempDir);
      if (pushResult.exitCode !== 0) {
        return internalError(c, 'Merge succeeded but failed to push to origin', {
          commitHash,
          output: pushResult.output,
        });
      }

      return c.json({
        success: true,
        commitHash,
        sourceBranch,
        targetBranch,
        message: `Successfully merged ${sourceBranch} into ${targetBranch}`,
      });
    } finally {
      await mergeTempDirManager.cleanupTempDir(tempDir);
    }
  } catch (err) {
    return internalError(c, getErrorMessage(err));
  }
});

export default app;
