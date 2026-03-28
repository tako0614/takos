import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { R2Bucket } from '../../../shared/types/bindings.ts';
import { parseLimit } from '../shared/route-auth';
import type { AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import * as gitStore from '../../../application/services/git-smart';
import { checkRepoAccess } from '../../../application/services/source/repos';
import { readableCommitErrorResponse, getTreeFlattenLimitError } from './routes';
import { validatePath } from '../../../shared/utils/path-validation';
import { diffLinesLcs } from '../../../shared/utils/lcs-diff';
import { decodeBlobContent } from '../../../shared/utils/unified-diff';
import { createEmbeddingsService } from '../../../application/services/execution/embeddings';
import { generateId } from '../../../shared/utils';
import type { IndexJobQueueMessage } from '../../../shared/types';
import { INDEX_QUEUE_MESSAGE_VERSION } from '../../../shared/types';
import { logError } from '../../../shared/utils/logger';
import { BadRequestError, NotFoundError, InternalError, NotImplementedError, PayloadTooLargeError, isAppError } from 'takos-common/errors';

function getPathFromRouteOrQuery(c: Context<AuthenticatedRouteEnv>): string {
  const routePath = c.req.param('path') || '';
  const queryPath = c.req.query('path') || '';
  return (routePath || queryPath).replace(/^\/+/, '');
}

async function getBlobOidAtPath(bucket: R2Bucket, treeOid: string, path: string): Promise<string | null> {
  const entry = await gitStore.getEntryAtPath(bucket, treeOid, path);
  if (!entry || entry.type !== 'blob') {
    return null;
  }
  return entry.sha;
}

async function loadTextBlob(bucket: R2Bucket, oid: string, maxBytes: number): Promise<{ text: string; lines: string[] } | null> {
  const blob = await gitStore.getBlob(bucket, oid);
  if (!blob) {
    return null;
  }

  if (blob.length > maxBytes) {
    throw new Error('File too large');
  }

  const decoded = decodeBlobContent(blob);
  if (decoded.isBinary) {
    throw new Error('Binary file not supported');
  }

  const text = decoded.text;
  return { text, lines: text.split('\n') };
}

const repoGitAdvanced = new Hono<AuthenticatedRouteEnv>()
  .get('/repos/:repoId/search', zValidator('query', z.object({
    q: z.string().optional(),
    ref: z.string().optional(),
    limit: z.string().optional(),
    case_sensitive: z.string().optional(),
    path_prefix: z.string().optional(),
  })), async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const { q: qRaw, ref: refRaw, limit: limitRaw, case_sensitive, path_prefix } = c.req.valid('query');
  const q = (qRaw || '').trim();
  const limit = parseLimit(limitRaw, 50, 200);
  const caseSensitive = case_sensitive === '1' || case_sensitive === 'true';
  const pathPrefixRaw = (path_prefix || '').trim();

  if (!q) {
    throw new BadRequestError('q is required');
  }
  if (q.length < 2) {
    throw new BadRequestError('q must be at least 2 characters');
  }

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const bucket = c.env.GIT_OBJECTS;
  if (!bucket) {
    throw new InternalError('Git storage not configured');
  }

  const ref = (refRaw || repoAccess.repo.default_branch || 'main').trim();
  const resolvedCommit = await gitStore.resolveReadableCommitFromRef(c.env.DB, bucket, repoId, ref);
  if (!resolvedCommit.ok) {
    return readableCommitErrorResponse(c, ref, resolvedCommit);
  }

  let pathPrefix = '';
  if (pathPrefixRaw) {
    try {
      pathPrefix = validatePath(pathPrefixRaw);
    } catch (err) {
      throw new BadRequestError(err instanceof Error ? err.message : 'Invalid path_prefix');
    }
  }

  try {
    const needle = caseSensitive ? q : q.toLowerCase();
    const matches: Array<{ path: string; line_number: number; column: number; snippet: string }> = [];
    let filesScanned = 0;
    let bytesScanned = 0;
    let truncated = false;

    const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5MiB per request
    const MAX_FILE_BYTES = 512 * 1024; // 512KiB per file

    const files = await gitStore.flattenTree(bucket, resolvedCommit.commit.tree, '', {
      skipSymlinks: true,
    });
    for (const file of files) {
      if (matches.length >= limit) {
        truncated = true;
        break;
      }
      if (bytesScanned >= MAX_TOTAL_BYTES) {
        truncated = true;
        break;
      }
      if (pathPrefix && !file.path.startsWith(pathPrefix)) {
        continue;
      }

      const blobData = await gitStore.getBlob(bucket, file.sha);
      if (!blobData) {
        continue;
      }

      const isBinary = blobData.some((b) => b === 0);

      if (isBinary) {
        continue;
      }
      if (blobData.length > MAX_FILE_BYTES) {
        continue;
      }

      filesScanned++;
      bytesScanned += blobData.length;

      let text = '';
      try {
        text = new TextDecoder().decode(blobData);
      } catch {
        // Binary blob that cannot be decoded as text -- skip
        continue;
      }

      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const haystack = caseSensitive ? rawLine : rawLine.toLowerCase();
        const idx = haystack.indexOf(needle);
        if (idx === -1) continue;

        matches.push({
          path: file.path,
          line_number: i + 1,
          column: idx + 1,
          snippet: rawLine.slice(0, 500),
        });

        if (matches.length >= limit) {
          truncated = true;
          break;
        }
      }
    }

    return c.json({
      query: q,
      ref,
      resolved_commit_sha: resolvedCommit.resolvedCommitSha,
      ref_commit_sha: resolvedCommit.refCommitSha,
      matches,
      files_scanned: filesScanned,
      bytes_scanned: bytesScanned,
      truncated,
    });
  } catch (err) {
    const limitError = getTreeFlattenLimitError(err);
    if (limitError) {
      throw new PayloadTooLargeError('Repository tree is too large to search', {
        code: limitError.code,
        detail: limitError.detail,
      });
    }
    if (isAppError(err)) throw err;
    logError('Failed repository search', err, { module: 'routes/repos/git-advanced' });
    throw new InternalError('Failed to search repository');
  }
  })
  .get('/repos/:repoId/semantic-search', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  const q = (c.req.query('q') || '').trim();
  const limit = parseLimit(c.req.query('limit'), 10, 50);
  const pathPrefix = (c.req.query('path_prefix') || '').trim();

  if (!q) {
    throw new BadRequestError('q is required');
  }

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const embeddingsService = createEmbeddingsService(c.env);
  if (!embeddingsService) {
    throw new NotImplementedError('Semantic search not available (AI/Vectorize not configured)');
  }

  const results = await embeddingsService.searchRepo(repoId, q, {
    limit,
    pathPrefix: pathPrefix || undefined,
  });

  return c.json({ query: q, matches: results });
  })
  .post('/repos/:repoId/semantic-index', async (c) => {
  const user = c.get('user');
  const repoId = c.req.param('repoId');

  const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const embeddingsService = createEmbeddingsService(c.env);
  if (!embeddingsService) {
    throw new NotImplementedError('Semantic search not available (AI/Vectorize not configured)');
  }

  const bucket = c.env.GIT_OBJECTS;
  if (!bucket) {
    throw new InternalError('Git storage not configured');
  }

  const ref = (c.req.query('ref') || repoAccess.repo.default_branch || 'main').trim();
  const resolvedCommit = await gitStore.resolveReadableCommitFromRef(c.env.DB, bucket, repoId, ref);
  if (!resolvedCommit.ok) {
    return readableCommitErrorResponse(c, ref, resolvedCommit);
  }

  if (c.env.INDEX_QUEUE) {
    const jobId = generateId();
    const message: IndexJobQueueMessage = {
      version: INDEX_QUEUE_MESSAGE_VERSION,
      jobId,
      spaceId: repoAccess.repo.space_id || '',
      type: 'repo_code_index',
      repoId,
      targetId: resolvedCommit.commit.tree,
      timestamp: Date.now(),
    };
    await c.env.INDEX_QUEUE.send(message);
    return c.json({ status: 'queued', job_id: jobId, ref, tree_oid: resolvedCommit.commit.tree });
  }

  const result = await embeddingsService.indexRepoFiles(repoId, bucket, resolvedCommit.commit.tree);
  return c.json({
    status: 'completed',
    ref,
    tree_oid: resolvedCommit.commit.tree,
    indexed_files: result.indexed,
    chunks: result.chunks,
    errors: result.errors,
  });
  });

async function handleFileHistoryRequest(c: Context<AuthenticatedRouteEnv>) {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  if (!repoId) throw new BadRequestError('Missing repoId');
  const ref = c.req.param('ref');
  if (!ref) throw new BadRequestError('Missing ref');
  const rawPath = getPathFromRouteOrQuery(c);
  const limit = parseLimit(c.req.query('limit'), 50, 200);

  if (!rawPath) {
    throw new BadRequestError('path is required');
  }

  let path = '';
  try {
    path = validatePath(rawPath);
  } catch (err) {
    throw new BadRequestError(err instanceof Error ? err.message : 'Invalid path');
  }

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const bucket = c.env.GIT_OBJECTS;
  if (!bucket) {
    throw new InternalError('Git storage not configured');
  }

  const resolvedCommit = await gitStore.resolveReadableCommitFromRef(c.env.DB, bucket, repoId, ref);
  if (!resolvedCommit.ok) {
    return readableCommitErrorResponse(c, ref, resolvedCommit);
  }

  let cursor: gitStore.GitCommit | null = resolvedCommit.commit;
  let cursorOid = await getBlobOidAtPath(bucket, cursor.tree, path);
  if (!cursorOid) {
    throw new NotFoundError('File');
  }

  const commits: Array<{
    sha: string;
    message: string;
    author: { name: string; email: string };
    date: string;
    status: 'added' | 'modified' | 'deleted';
  }> = [];

  while (cursor && commits.length < limit) {
    const parentSha: string | null = cursor.parents[0] || null;
    const parentCommit: gitStore.GitCommit | null = parentSha
      ? await gitStore.getCommit(c.env.DB, bucket, repoId, parentSha)
      : null;
    const parentOid = parentCommit
      ? await getBlobOidAtPath(bucket, parentCommit.tree, path)
      : null;

    if (cursorOid !== parentOid) {
      commits.push({
        sha: cursor.sha,
        message: cursor.message,
        author: { name: cursor.author.name, email: cursor.author.email },
        date: new Date(cursor.committer.timestamp * 1000).toISOString(),
        status: parentOid === null ? 'added' : cursorOid === null ? 'deleted' : 'modified',
      });
    }

    if (!parentCommit || parentOid === null) {
      break;
    }

    cursor = parentCommit;
    cursorOid = parentOid;
  }

  return c.json({
    path,
    ref,
    resolved_commit_sha: resolvedCommit.resolvedCommitSha,
    ref_commit_sha: resolvedCommit.refCommitSha,
    commits,
  });
}

repoGitAdvanced
  .get('/repos/:repoId/log/:ref/:path{.+}', handleFileHistoryRequest)
  .get('/repos/:repoId/log/:ref', handleFileHistoryRequest);

async function handleBlameRequest(c: Context<AuthenticatedRouteEnv>) {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  if (!repoId) throw new BadRequestError('Missing repoId');
  const ref = c.req.param('ref');
  if (!ref) throw new BadRequestError('Missing ref');
  const rawPath = getPathFromRouteOrQuery(c);

  if (!rawPath) {
    throw new BadRequestError('path is required');
  }

  let path = '';
  try {
    path = validatePath(rawPath);
  } catch (err) {
    throw new BadRequestError(err instanceof Error ? err.message : 'Invalid path');
  }

  const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
  if (!repoAccess) {
    throw new NotFoundError('Repository');
  }

  const bucket = c.env.GIT_OBJECTS;
  if (!bucket) {
    throw new InternalError('Git storage not configured');
  }

  const resolvedCommit = await gitStore.resolveReadableCommitFromRef(c.env.DB, bucket, repoId, ref);
  if (!resolvedCommit.ok) {
    return readableCommitErrorResponse(c, ref, resolvedCommit);
  }

  const headCommit = resolvedCommit.commit;
  const headOid = await getBlobOidAtPath(bucket, headCommit.tree, path);
  if (!headOid) {
    throw new NotFoundError('File');
  }

  const MAX_FILE_BYTES = 256 * 1024;
  const MAX_LINES = 2000;
  const MAX_COMMITS = 200;

  const changeCommits: Array<{ commit: gitStore.GitCommit; lines: string[] }> = [];
  let cursorCommit: gitStore.GitCommit | null = headCommit;
  let cursorOid: string | null = headOid;
  let truncated = false;

  while (cursorCommit && cursorOid) {
    const parentSha: string | null = cursorCommit.parents[0] || null;
    const parentCommit: gitStore.GitCommit | null = parentSha
      ? await gitStore.getCommit(c.env.DB, bucket, repoId, parentSha)
      : null;
    const parentOid = parentCommit
      ? await getBlobOidAtPath(bucket, parentCommit.tree, path)
      : null;

    if (cursorOid !== parentOid) {
      let loaded: { text: string; lines: string[] } | null;
      try {
        loaded = await loadTextBlob(bucket, cursorOid, MAX_FILE_BYTES);
      } catch (err) {
        throw new BadRequestError(err instanceof Error ? err.message : 'Failed to load file');
      }

      if (!loaded) {
        throw new NotFoundError('File');
      }

      if (loaded.lines.length > MAX_LINES) {
        throw new PayloadTooLargeError('File too large');
      }

      changeCommits.push({ commit: cursorCommit, lines: loaded.lines });
    }

    if (!parentCommit || parentOid === null) {
      break;
    }

    cursorCommit = parentCommit;
    cursorOid = parentOid;

    if (changeCommits.length > MAX_COMMITS) {
      truncated = true;
      break;
    }
  }

  changeCommits.reverse(); // oldest -> newest

  const commitBySha = new Map(changeCommits.map(({ commit }) => [commit.sha, commit]));

  let currentLines: string[] = [];
  let attributions: string[] = [];
  for (const { commit, lines } of changeCommits) {
    const ops = diffLinesLcs(currentLines, lines);
    const nextAttrib: string[] = [];
    let oldIdx = 0;
    for (const op of ops) {
      if (op.type === 'equal') {
        nextAttrib.push(attributions[oldIdx]);
        oldIdx++;
        continue;
      }
      if (op.type === 'delete') {
        oldIdx++;
        continue;
      }
      nextAttrib.push(commit.sha);
    }
    currentLines = lines;
    attributions = nextAttrib;
  }

  const lines = currentLines.map((content, idx) => {
    const sha = attributions[idx] || resolvedCommit.resolvedCommitSha;
    const commit = commitBySha.get(sha) || headCommit;
    return {
      line: idx + 1,
      content,
      commit_sha: sha,
      author_name: commit.author.name,
      author_email: commit.author.email,
      date: new Date(commit.committer.timestamp * 1000).toISOString(),
      message: commit.message,
    };
  });

  return c.json({
    path,
    ref,
    resolved_commit_sha: resolvedCommit.resolvedCommitSha,
    ref_commit_sha: resolvedCommit.refCommitSha,
    truncated,
    lines,
  });
}

repoGitAdvanced
  .get('/repos/:repoId/blame/:ref/:path{.+}', handleBlameRequest)
  .get('/repos/:repoId/blame/:ref', handleBlameRequest);

export default repoGitAdvanced;
