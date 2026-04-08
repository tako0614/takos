import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { R2Bucket } from '../../../shared/types/bindings.ts';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import { parsePagination } from '../../../shared/utils/index.ts';
import { zValidator } from '../zod-validator.ts';
import * as gitStore from '../../../application/services/git-smart/index.ts';
import { checkRepoAccess } from '../../../application/services/source/repos.ts';
import { readableCommitErrorResponse, getTreeFlattenLimitError } from './routes.ts';
import { validatePath } from '../../../shared/utils/path-validation.ts';
import { diffLinesLcs } from '../../../shared/utils/lcs-diff.ts';
import { decodeBlobContent } from '../../../shared/utils/unified-diff.ts';
import { createEmbeddingsService } from '../../../application/services/execution/embeddings.ts';
import { generateId } from '../../../shared/utils/index.ts';
import type { IndexJobQueueMessage } from '../../../shared/types/index.ts';
import { INDEX_QUEUE_MESSAGE_VERSION } from '../../../shared/types/index.ts';
import { logError, logWarn } from '../../../shared/utils/logger.ts';
import { BadRequestError, NotFoundError, InternalError, NotImplementedError, PayloadTooLargeError, isAppError } from 'takos-common/errors';
import { getDb } from '../../../infra/db/index.ts';
import { accounts, repositories } from '../../../infra/db/schema.ts';
import { recordPushActivity } from '../../../application/services/activitypub/push-activities.ts';
import { deliverToFollowers } from '../../../application/services/activitypub/activity-delivery.ts';
import {
  GIT_SEARCH_MAX_TOTAL_BYTES,
  GIT_SEARCH_MAX_FILE_BYTES,
  GIT_DIFF_MAX_FILE_BYTES,
  GIT_DIFF_MAX_LINES,
  GIT_BLAME_MAX_COMMITS,
} from '../../../shared/config/limits.ts';

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
  const { limit } = parsePagination({ limit: limitRaw }, { limit: 50, maxLimit: 200 });
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

    const MAX_TOTAL_BYTES = GIT_SEARCH_MAX_TOTAL_BYTES;
    const MAX_FILE_BYTES = GIT_SEARCH_MAX_FILE_BYTES;

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
  const { limit } = parsePagination(c.req.query(), { limit: 10, maxLimit: 50 });
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

    // Round 11: record the push activity + fan out to followers as soon as
    // the vectorize job is queued. The push-event semantics do not depend
    // on the index job completing; the outbox entry must exist for the
    // repo actor so ForgeFed/ActivityPub consumers see the ref advance.
    c.executionCtx.waitUntil(
      recordAndDeliverPushActivity(c, {
        repoId,
        spaceId: repoAccess.repo.space_id,
        ref: `refs/heads/${ref.replace(/^refs\/heads\//, '')}`,
        afterSha: resolvedCommit.resolvedCommitSha,
        user,
      }),
    );

    return c.json({ status: 'queued', job_id: jobId, ref, tree_oid: resolvedCommit.commit.tree });
  }

  const result = await embeddingsService.indexRepoFiles(repoId, bucket, resolvedCommit.commit.tree);

  // Round 11: push completion path — emit ForgeFed Push activity + deliver
  // to repo actor followers. Any failure here must not crash the
  // index response, so the side-effects run via waitUntil with internal
  // error logging.
  c.executionCtx.waitUntil(
    recordAndDeliverPushActivity(c, {
      repoId,
      spaceId: repoAccess.repo.space_id,
      ref: `refs/heads/${ref.replace(/^refs\/heads\//, '')}`,
      afterSha: resolvedCommit.resolvedCommitSha,
      user,
    }),
  );

  return c.json({
    status: 'completed',
    ref,
    tree_oid: resolvedCommit.commit.tree,
    indexed_files: result.indexed,
    chunks: result.chunks,
    errors: result.errors,
  });
  });

/**
 * Record a ForgeFed `Push` activity in the repo outbox and fan it out to
 * the repo actor's ActivityPub followers. Used by the semantic-index
 * completion path (Round 11 audit finding #2: `recordPushActivity` had
 * zero callers prior to this wire-up).
 *
 * Returns void; caller should `waitUntil` or otherwise guard against
 * rejection so the primary response is not blocked.
 */
async function recordAndDeliverPushActivity(
  c: Context<AuthenticatedRouteEnv>,
  input: {
    repoId: string;
    spaceId: string;
    ref: string;
    afterSha: string;
    user: { id: string; name?: string | null };
  },
): Promise<void> {
  try {
    const record = await recordPushActivity(c.env.DB, {
      repoId: input.repoId,
      accountId: input.spaceId,
      ref: input.ref,
      beforeSha: null,
      afterSha: input.afterSha,
      pusherName: input.user.name ?? null,
      pusherActorUrl: null,
      commitCount: 0,
      commits: [],
    });

    // Build the repo actor URL for this origin. Both owner slug and repo
    // name must be encoded the same way as the AP routes in
    // activitypub-store/repo-routes.ts and helpers.ts.
    const db = getDb(c.env.DB);
    const joined = await db.select({
      repoName: repositories.name,
      ownerSlug: accounts.slug,
    })
      .from(repositories)
      .leftJoin(accounts, eq(accounts.id, repositories.accountId))
      .where(eq(repositories.id, input.repoId))
      .get();

    if (!joined || !joined.ownerSlug) {
      logWarn('recordAndDeliverPushActivity: unable to resolve repo owner', {
        action: 'push_activity_deliver',
        repoId: input.repoId,
      });
      return;
    }

    const origin = new URL(c.req.url).origin;
    const repoActorUrl = `${origin}/ap/repos/${encodeURIComponent(joined.ownerSlug)}/${encodeURIComponent(joined.repoName)}`;

    const pushActivity: Record<string, unknown> = {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://forgefed.org/ns',
      ],
      id: `${repoActorUrl}/activities/push/${encodeURIComponent(record.createdAt)}`,
      type: 'Push',
      actor: repoActorUrl,
      published: record.createdAt,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      target: input.ref,
      object: {
        type: 'OrderedCollection',
        totalItems: 0,
        orderedItems: [],
      },
    };

    const signingKey = c.env.PLATFORM_PRIVATE_KEY || undefined;
    const signingKeyId = signingKey ? `${repoActorUrl}#main-key` : undefined;

    await deliverToFollowers(
      c.env.DB,
      repoActorUrl,
      pushActivity,
      signingKey,
      signingKeyId,
    );
  } catch (err) {
    logError('Failed to record/deliver push activity', err, {
      action: 'push_activity_deliver',
      repoId: input.repoId,
    });
  }
}

async function handleFileHistoryRequest(c: Context<AuthenticatedRouteEnv>) {
  const user = c.get('user');
  const repoId = c.req.param('repoId');
  if (!repoId) throw new BadRequestError('Missing repoId');
  const ref = c.req.param('ref');
  if (!ref) throw new BadRequestError('Missing ref');
  const rawPath = getPathFromRouteOrQuery(c);
  const { limit } = parsePagination(c.req.query(), { limit: 50, maxLimit: 200 });

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

  const MAX_FILE_BYTES = GIT_DIFF_MAX_FILE_BYTES;
  const MAX_LINES = GIT_DIFF_MAX_LINES;
  const MAX_COMMITS = GIT_BLAME_MAX_COMMITS;

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
