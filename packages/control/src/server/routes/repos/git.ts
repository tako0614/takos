import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { parseJsonBody, parseLimit } from '../shared/route-auth';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import * as gitStore from '../../../application/services/git-smart';
import { getContentTypeFromPath } from '../../../shared/utils/content-type';
import { checkRepoAccess } from '../../../application/services/source/repos';
import { readableCommitErrorResponse, encodeBase64, getTreeFlattenLimitError, toGitBucket, type RepoBucketBinding } from './base';
import {
  commitFilesToDefaultBranch,
  importFilesToDefaultBranch,
  type FileEntry,
} from './git-write-operations';
import { BadRequestError, NotFoundError, AuthorizationError, ConflictError, InternalError, PayloadTooLargeError, isAppError } from '@takos/common/errors';
import { logError, logWarn } from '../../../shared/utils/logger';

type RepoContext = Context<AuthenticatedRouteEnv>;

const WRITE_ROLES = ['owner', 'admin', 'editor'] as const;

function requireBucket(c: RepoContext): RepoBucketBinding {
  const bucket = c.env.GIT_OBJECTS;
  if (!bucket) {
    throw new InternalError('Git storage not configured');
  }
  return bucket;
}

function sigTimestampToIso(timestamp: number | string | undefined): string {
  if (typeof timestamp === 'number') {
    const millis = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof timestamp === 'string') {
    return new Date(timestamp).toISOString();
  }
  return new Date(0).toISOString();
}

function getCommitSha(commit: { sha?: string; oid?: string }): string {
  return commit.sha ?? commit.oid ?? '';
}

function getCommitParents(commit: { parents?: string[] }): string[] {
  return Array.isArray(commit.parents) ? commit.parents : [];
}

function warnDegradedCommit(
  resolvedCommit: Extract<gitStore.ResolveReadableCommitResult, { ok: true }>,
  repoId: string,
  ref: string
): void {
  if (resolvedCommit.degraded) {
    logWarn(`Falling back to readable commit ${resolvedCommit.resolvedCommitSha} for repo ${repoId} ref ${ref} (requested ${resolvedCommit.refCommitSha})`, { module: 'git-readable-commit' });
  }
}

function throwIfTreeFlattenLimit(err: unknown, operation: string): void {
  const limitError = getTreeFlattenLimitError(err);
  if (limitError) {
    throw new PayloadTooLargeError(`Repository tree is too large to ${operation}`, {
      code: limitError.code,
      detail: limitError.detail,
    });
  }
}

const repoGit = new Hono<AuthenticatedRouteEnv>()
  .get('/repos/:repoId/branches', zValidator('query', z.object({
    include_commits: z.string().optional(),
  })), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const { include_commits } = c.req.valid('query');
  const includeCommits = include_commits === 'true';

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  try {
    const branches = await gitStore.listBranches(c.env.DB, repoId);
    const defaultBranch = await gitStore.getDefaultBranch(c.env.DB, repoId);
    const bucket = c.env.GIT_OBJECTS ? toGitBucket(c.env.GIT_OBJECTS) : undefined;

    const branchesWithCommits = await Promise.all(
      branches.map(async (b) => {
        const result: {
          name: string;
          is_default: boolean;
          is_protected: boolean;
          commit_sha: string;
          latest_commit?: {
            sha: string;
            message: string;
            author_name: string;
            date: string;
          };
        } = {
          name: b.name,
          is_default: b.is_default,
          is_protected: b.is_protected,
          commit_sha: b.commit_sha,
        };

        if (includeCommits && bucket && b.commit_sha) {
          try {
            const commit = await gitStore.getCommit(c.env.DB, bucket, repoId, b.commit_sha);
            if (commit) {
              result.latest_commit = {
                sha: getCommitSha(commit),
                message: commit.message,
                author_name: commit.author.name,
                date: sigTimestampToIso(commit.author.timestamp),
              };
            }
          } catch {
            // Ignore commit fetch errors
          }
        }

        return result;
      })
    );

    return c.json({
      branches: branchesWithCommits,
      default_branch: defaultBranch?.name || repoAccess.repo.default_branch,
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to list branches', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to list branches');
  }
  })
  .post('/repos/:repoId/branches', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const body = await parseJsonBody<{
    name: string;
    source: string;
  }>(c);

  if (!body) {
    throw new BadRequestError('Invalid JSON body');
  }

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id, [...WRITE_ROLES]);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  if (typeof body.name !== 'string' || typeof body.source !== 'string') {
    throw new BadRequestError('name and source are required');
  }

  const branchName = body.name.startsWith('refs/heads/')
    ? body.name.slice('refs/heads/'.length).trim()
    : body.name.trim();
  const sourceRef = body.source.trim();

  if (!branchName || !sourceRef) {
    throw new BadRequestError('name and source are required');
  }
  if (!gitStore.isValidRefName(branchName)) {
    throw new BadRequestError('Invalid branch name');
  }
  if (!gitStore.isValidRefName(sourceRef)) {
    throw new BadRequestError('Invalid source ref');
  }

  try {
    const sourceSha = await gitStore.resolveRef(c.env.DB, repoId, sourceRef);
    if (!sourceSha) {
      throw new NotFoundError('Source ref');
    }

    const result = await gitStore.createBranch(c.env.DB, repoId, branchName, sourceSha, false);
    if (!result.success) {
      throw new ConflictError(result.error || 'Failed to create branch', {
        current: result.current,
      });
    }

    return c.json({
      success: true,
      branch: {
        name: branchName,
        commit_sha: sourceSha,
      },
    }, 201);
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to create branch', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to create branch');
  }
  })
  .delete('/repos/:repoId/branches/:branchName', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const branchName = c.req.param('branchName');

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  if (repoAccess.role !== 'owner' && repoAccess.role !== 'admin') {
    throw new AuthorizationError('Admin access required');
  }
  if (!gitStore.isValidRefName(branchName)) {
    throw new BadRequestError('Invalid branch name');
  }

  try {
    const result = await gitStore.deleteBranch(c.env.DB, repoId, branchName);
    if (!result.success) {
      throw new BadRequestError(result.error || 'Failed to delete branch');
    }
    return c.json({ success: true });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to delete branch', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to delete branch');
  }
  })
  .post('/repos/:repoId/branches/:branchName/default', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const branchName = c.req.param('branchName');

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  if (repoAccess.role !== 'owner' && repoAccess.role !== 'admin') {
    throw new AuthorizationError('Admin access required');
  }
  if (!gitStore.isValidRefName(branchName)) {
    throw new BadRequestError('Invalid branch name');
  }

  try {
    const result = await gitStore.setDefaultBranch(c.env.DB, repoId, branchName);
    if (!result.success) {
      throw new BadRequestError(result.error || 'Failed to set default branch');
    }
    return c.json({ success: true });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to set default branch', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to set default branch');
  }
  })
  .get('/repos/:repoId/commits', zValidator('query', z.object({
    branch: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  })), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const { branch, page: pageRaw, limit: limitRaw } = c.req.valid('query');
  const limit = parseLimit(limitRaw, 20, 100);
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
  });

async function handleRepoTreeRequest(c: RepoContext) {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  if (!repoId) throw new BadRequestError('Missing repoId');
  const ref = c.req.param('ref');
  if (!ref) throw new BadRequestError('Missing ref');
  const wildcardPath = c.req.param('*') || '';
  const queryPath = c.req.query('path') || '';
  const path = (wildcardPath || queryPath).replace(/^\/+/, '');

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  try {
    const bucket = toGitBucket(requireBucket(c));

    const resolvedCommit = await gitStore.resolveReadableCommitFromRef(c.env.DB, bucket, repoId, ref);
    if (!resolvedCommit.ok) {
      return readableCommitErrorResponse(c, ref, resolvedCommit);
    }
    const commit = resolvedCommit.commit;

    warnDegradedCommit(resolvedCommit, repoId, ref);

    const entries = await gitStore.listDirectory(bucket, commit.tree, path);
    if (!entries) {
      throw new NotFoundError('Path');
    }

    return c.json({
      path,
      ref,
      resolved_commit_sha: resolvedCommit.resolvedCommitSha,
      ref_commit_sha: resolvedCommit.refCommitSha,
      entries: entries.map(e => ({
        name: e.name,
        type: e.mode === gitStore.FILE_MODES.DIRECTORY ? 'directory' : 'file',
        mode: e.mode,
        oid: e.sha,
      })),
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to get tree', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to get file tree');
  }
}

repoGit
  .get('/repos/:repoId/tree/:ref/*', handleRepoTreeRequest)
  .get('/repos/:repoId/tree/:ref', handleRepoTreeRequest);

async function handleRepoBlobRequest(c: RepoContext) {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  if (!repoId) throw new BadRequestError('Missing repoId');
  const ref = c.req.param('ref');
  if (!ref) throw new BadRequestError('Missing ref');
  const wildcardPath = c.req.param('*') || '';
  const queryPath = c.req.query('path') || '';
  const path = (wildcardPath || queryPath).replace(/^\/+/, '');

  if (!path) {
    throw new BadRequestError('File path is required');
  }

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  try {
    const bucket = toGitBucket(requireBucket(c));

    const resolvedCommit = await gitStore.resolveReadableCommitFromRef(c.env.DB, bucket, repoId, ref);
    if (!resolvedCommit.ok) {
      return readableCommitErrorResponse(c, ref, resolvedCommit);
    }
    const commit = resolvedCommit.commit;

    warnDegradedCommit(resolvedCommit, repoId, ref);

    const entry = await gitStore.getEntryAtPath(bucket, commit.tree, path);
    if (!entry || entry.type !== 'blob') {
      throw new NotFoundError('File');
    }
    const blob = await gitStore.getBlob(bucket, entry.sha);
    if (!blob) {
      throw new NotFoundError('File');
    }

    const isBinary = blob.some(byte => byte === 0);
    const mimeType = getContentTypeFromPath(path);

    return c.json({
      path,
      ref,
      resolved_commit_sha: resolvedCommit.resolvedCommitSha,
      ref_commit_sha: resolvedCommit.refCommitSha,
      content: isBinary
        ? encodeBase64(blob)
        : new TextDecoder().decode(blob),
      size: blob.length,
      is_binary: isBinary,
      encoding: isBinary ? 'base64' : 'utf-8',
      mime_type: mimeType,
    });
  } catch (err) {
    if (isAppError(err)) throw err;
    logError('Failed to get blob', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to get file content');
  }
}

repoGit
  .get('/repos/:repoId/blob/:ref/*', handleRepoBlobRequest)
  .get('/repos/:repoId/blob/:ref', handleRepoBlobRequest)
  .get('/repos/:repoId/diff/:baseHead', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const baseHead = c.req.param('baseHead');

  const match = baseHead.match(/^(.+?)(\.{2,3})(.+)$/);
  if (!match) {
    throw new BadRequestError('Invalid diff format. Use base...head or base..head');
  }

  const [, base, , head] = match;

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  try {
    const bucket = toGitBucket(requireBucket(c));

    const baseResolved = await gitStore.resolveReadableCommitFromRef(c.env.DB, bucket, repoId, base);
    if (!baseResolved.ok) {
      return readableCommitErrorResponse(c, base, baseResolved);
    }

    const headResolved = await gitStore.resolveReadableCommitFromRef(c.env.DB, bucket, repoId, head);
    if (!headResolved.ok) {
      return readableCommitErrorResponse(c, head, headResolved);
    }

    const baseCommit = baseResolved.commit;
    const headCommit = headResolved.commit;

    const baseFiles = await gitStore.flattenTree(bucket, baseCommit.tree);
    const headFiles = await gitStore.flattenTree(bucket, headCommit.tree);

    const baseMap = new Map(baseFiles.map(f => [f.path, f.sha]));
    const headMap = new Map(headFiles.map(f => [f.path, f.sha]));

    const files: Array<{
      path: string;
      status: 'added' | 'modified' | 'deleted';
      additions: number;
      deletions: number;
    }> = [];

    for (const [path, sha] of headMap) {
      const baseSha = baseMap.get(path);
      if (!baseSha) {
        files.push({ path, status: 'added', additions: 1, deletions: 0 });
      } else if (baseSha !== sha) {
        files.push({ path, status: 'modified', additions: 1, deletions: 1 });
      }
    }

    for (const [path] of baseMap) {
      if (!headMap.has(path)) {
        files.push({ path, status: 'deleted', additions: 0, deletions: 1 });
      }
    }

    files.sort((a, b) => a.path.localeCompare(b.path));

    const stats = {
      total_additions: files.reduce((sum, f) => sum + f.additions, 0),
      total_deletions: files.reduce((sum, f) => sum + f.deletions, 0),
      files_changed: files.length,
    };

    return c.json({
      base,
      head,
      base_resolved_commit_sha: baseResolved.resolvedCommitSha,
      head_resolved_commit_sha: headResolved.resolvedCommitSha,
      files,
      stats,
    });
  } catch (err) {
    throwIfTreeFlattenLimit(err, 'compute diff');
    if (isAppError(err)) throw err;
    logError('Failed to get diff', err, { module: 'routes/repos/git' });
    throw new InternalError('Failed to get diff');
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

export default repoGit;
