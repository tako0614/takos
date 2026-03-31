import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import { parsePagination } from '../../../shared/utils/index.ts';
import { zValidator } from '../zod-validator.ts';
import * as gitStore from '../../../application/services/git-smart/index.ts';
import { checkRepoAccess } from '../../../application/services/source/repos.ts';
import { readableCommitErrorResponse, encodeBase64, toGitBucket } from './routes.ts';
import {
  commitFilesToDefaultBranch,
  importFilesToDefaultBranch,
  type FileEntry,
} from './git-write-operations.ts';
import { BadRequestError, NotFoundError, InternalError, isAppError } from 'takos-common/errors';
import { logError } from '../../../shared/utils/logger.ts';
import {
  WRITE_ROLES,
  requireBucket,
  sigTimestampToIso,
  getCommitSha,
  getCommitParents,
  throwIfTreeFlattenLimit,
} from './git-shared.ts';

const gitCommits = new Hono<AuthenticatedRouteEnv>()
  .get('/repos/:repoId/commits', zValidator('query', z.object({
    branch: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  })), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const { branch, page: pageRaw, limit: limitRaw } = c.req.valid('query');
  const { limit } = parsePagination({ limit: limitRaw });
  const page = Math.max(1, parseInt(pageRaw || '1', 10) || 1);
  const offset = (page - 1) * limit;

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  try {
    const bucket = toGitBucket(requireBucket(c));

    const ref = branch || repoAccess.repo.default_branch || 'main';
    const resolvedCommit = await gitStore.resolveReadableCommitFromRef(c.env.DB, bucket, repoId, ref);
    if (!resolvedCommit.ok) {
      return readableCommitErrorResponse(c, ref, resolvedCommit);
    }

    const commits: Array<{
      sha: string;
      message: string;
      author: { name: string; email: string; avatar_url?: string };
      date: string;
      parents: string[];
    }> = [];

    let cursor: gitStore.GitCommit | null = resolvedCommit.commit;
    let skipped = 0;
    while (cursor) {
      if (skipped < offset) {
        skipped++;
      } else {
        commits.push({
          sha: getCommitSha(cursor),
          message: cursor.message,
          author: {
            name: cursor.author.name,
            email: cursor.author.email,
          },
          date: sigTimestampToIso(cursor.committer.timestamp),
          parents: getCommitParents(cursor),
        });

        if (commits.length >= limit) {
          break;
        }
      }

      const parentSha = getCommitParents(cursor)[0];
      if (!parentSha) {
        break;
      }
      cursor = await gitStore.getCommit(c.env.DB, bucket, repoId, parentSha);
    }

    return c.json({
      ref,
      resolved_commit_sha: resolvedCommit.resolvedCommitSha,
      ref_commit_sha: resolvedCommit.refCommitSha,
      commits,
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to get commits', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to get commit history');
  }
  })
  .post('/repos/:repoId/import', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id, [...WRITE_ROLES]);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const bucketBinding = requireBucket(c);

  let body: { files: FileEntry[]; message?: string; append?: boolean };
  try {
    body = await c.req.json();
  } catch {
    // Request body is not valid JSON
    throw new BadRequestError('Invalid JSON body');
  }

  if (!body.files || !Array.isArray(body.files) || body.files.length === 0) {
    throw new BadRequestError('files array is required');
  }

  const commitMessage = body.message || 'Update from CLI';
  const appendMode = body.append === true;

  try {
    const result = await importFilesToDefaultBranch({
      db: c.env.DB,
      bucket: bucketBinding,
      repoId,
      files: body.files,
      user,
      executionCtx: c.executionCtx,
      workflowQueue: c.env.WORKFLOW_QUEUE,
      encryptionKey: c.env.ENCRYPTION_KEY,
      message: commitMessage,
      appendMode,
    });

    return c.json({
      success: true,
      commit_sha: result.commitSha,
      file_count: result.fileCount,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'Repository not initialized') {
      throw new BadRequestError('Repository not initialized');
    }
    if (err instanceof Error && err.message === 'Current commit not found') {
      throw new InternalError('Current commit not found');
    }
    throwIfTreeFlattenLimit(err, 'import files');
    if (isAppError(err)) throw err;
    logError('failed to import files', err, { module: 'repos/git' });
    throw new InternalError('Failed to import files');
  }
  })
  .get('/repos/:repoId/export', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const bucket = toGitBucket(requireBucket(c));

  try {
    const branch = await gitStore.getDefaultBranch(c.env.DB, repoId);
    if (!branch) {
      return c.json({ success: true, files: [] });
    }

    const commit = await gitStore.getCommit(c.env.DB, bucket, repoId, branch.commit_sha);
    if (!commit) {
      return c.json({ success: true, files: [] });
    }

    const flatFiles = await gitStore.flattenTree(bucket, commit.tree);
    const files: Array<{ path: string; content: string }> = [];

    for (const file of flatFiles) {
      const blob = await gitStore.getBlob(bucket, file.sha);
      if (blob) {
        files.push({
          path: file.path,
          content: encodeBase64(blob),
        });
      }
    }

    return c.json({ success: true, files });
  } catch (err) {
    throwIfTreeFlattenLimit(err, 'export files');
    if (isAppError(err)) throw err;
    logError('Failed to export files', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to export files');
  }
  })
  .get('/repos/:repoId/status', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const bucket = toGitBucket(requireBucket(c));

  try {
    const branch = await gitStore.getDefaultBranch(c.env.DB, repoId);
    let fileCount = 0;
    let lastUpdated = '';

    if (branch) {
      const commit = await gitStore.getCommit(c.env.DB, bucket, repoId, branch.commit_sha);
      if (commit) {
        const files = await gitStore.flattenTree(bucket, commit.tree);
        fileCount = files.length;
        lastUpdated = sigTimestampToIso(commit.committer.timestamp);
      }
    }

    return c.json({
      success: true,
      name: repoAccess.repo.name,
      branch: branch?.name || 'main',
      commit: branch?.commit_sha || null,
      file_count: fileCount,
      last_updated: lastUpdated || null,
    });
  } catch (err) {
    throwIfTreeFlattenLimit(err, 'calculate repository status');
    if (isAppError(err)) throw err;
    logError('Failed to get status', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to get status');
  }
  })
  .get('/repos/:repoId/log', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const bucket = toGitBucket(requireBucket(c));

  try {
    const ref = repoAccess.repo.default_branch || 'main';
    const resolvedCommit = await gitStore.resolveReadableCommitFromRef(c.env.DB, bucket, repoId, ref);
    if (!resolvedCommit.ok) {
      return readableCommitErrorResponse(c, ref, resolvedCommit);
    }

    const commits: Array<{ sha: string; message: string; author: string; date: string }> = [];
    let cursor: gitStore.GitCommit | null = resolvedCommit.commit;
    while (cursor && commits.length < 20) {
      commits.push({
        sha: getCommitSha(cursor),
        message: cursor.message,
        author: `${cursor.author.name} <${cursor.author.email}>`,
        date: sigTimestampToIso(cursor.committer.timestamp),
      });

      const parentSha = getCommitParents(cursor)[0];
      if (!parentSha) {
        break;
      }
      cursor = await gitStore.getCommit(c.env.DB, bucket, repoId, parentSha);
    }

    return c.json({
      success: true,
      ref,
      resolved_commit_sha: resolvedCommit.resolvedCommitSha,
      ref_commit_sha: resolvedCommit.refCommitSha,
      commits,
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to get log', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to get commit log');
  }
  })
  .post('/repos/:repoId/commit', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id, [...WRITE_ROLES]);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const bucketBinding = requireBucket(c);

  let body: { files: FileEntry[]; message: string };
  try {
    body = await c.req.json();
  } catch {
    // Request body is not valid JSON
    throw new BadRequestError('Invalid JSON body');
  }

  if (!body.message) {
    throw new BadRequestError('Commit message is required');
  }

  if (!body.files || !Array.isArray(body.files) || body.files.length === 0) {
    throw new BadRequestError('files array is required');
  }

  try {
    const result = await commitFilesToDefaultBranch({
      db: c.env.DB,
      bucket: bucketBinding,
      repoId,
      files: body.files,
      user,
      executionCtx: c.executionCtx,
      workflowQueue: c.env.WORKFLOW_QUEUE,
      encryptionKey: c.env.ENCRYPTION_KEY,
      message: body.message,
    });

    return c.json({
      success: true,
      commit_sha: result.commitSha,
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'Repository not initialized') {
      throw new BadRequestError('Repository not initialized');
    }
    if (isAppError(err)) throw err;
    logError('failed to create commit', err, { module: 'repos/git' });
    throw new InternalError('Failed to create commit');
  }
  });

export default gitCommits;
