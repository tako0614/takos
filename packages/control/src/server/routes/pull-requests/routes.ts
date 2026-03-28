import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { PullRequestStatus, AuthorType } from '../../../shared/types';
import { generateId, now, toIsoString } from '../../../shared/utils';
import { parseJsonBody, parseLimit, parseOffset, type AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import { checkRepoAccess, type RepoAccess } from '../../../application/services/source/repos';
import { getDb } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import { pullRequests } from '../../../infra/db/schema';
import {
  scheduleActionsAutoTrigger,
  triggerPushWorkflows,
  triggerPullRequestWorkflows,
  type PullRequestWorkflowEvent,
} from '../../../application/services/actions';
import {
  resolveConflictsAndMerge,
  checkConflicts,
  ConflictCheckError,
  type Resolution,
} from '../../../application/services/pull-requests/merge-resolution';

import {
  buildPullRequestDtoFull,
  buildUserLiteMap,
  resolveActorLite,
  toPullRequestDto,
  toPullRequestRecord,
} from './dto';
import {
  jsonErrorWithStatus,
  performPullRequestMerge,
  validateConflictResolutionPath,
} from './merge';
import { buildDetailedRepoDiffPayload } from './diff';
import { toGitBucket } from './git-store';
import { logError } from '../../../shared/utils/logger';
import { BadRequestError, NotFoundError, InternalError, AppError } from 'takos-common/errors';
import {
  buildPullRequestDetail,
  buildPullRequestList,
  findPullRequest,
  getNextPullRequestNumber,
} from './read-model';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function triggerPullRequestEventInBackground(
  c: Context<AuthenticatedRouteEnv>,
  options: {
    repoId: string;
    repoName: string;
    defaultBranch: string;
    actorId: string;
    event: PullRequestWorkflowEvent;
  }
): void {
  const task = triggerPullRequestWorkflows({
    db: c.env.DB,
    bucket: c.env.GIT_OBJECTS,
    queue: c.env.WORKFLOW_QUEUE,
    encryptionKey: c.env.ENCRYPTION_KEY,
    repoId: options.repoId,
    repoName: options.repoName,
    defaultBranch: options.defaultBranch,
    actorId: options.actorId,
    event: options.event,
  }).catch((err: unknown) => {
    logError('Failed to trigger pull_request workflows', err, { module: 'routes/pull-requests/base' });
  });

  const executionCtx = c.executionCtx;
  if (executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(task);
    return;
  }

  void task;
}

/** Trigger the PR workflow event using common repo-access fields. */
function triggerPrEvent(
  c: Context<AuthenticatedRouteEnv>,
  repoAccess: RepoAccess,
  actorId: string,
  event: PullRequestWorkflowEvent,
): void {
  triggerPullRequestEventInBackground(c, {
    repoId: repoAccess.repo.id,
    repoName: repoAccess.repo.name,
    defaultBranch: repoAccess.repo.default_branch || 'main',
    actorId,
    event,
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default new Hono<AuthenticatedRouteEnv>()
  .post('/repos/:repoId/pulls', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const body = await parseJsonBody<{
      title: string;
      description?: string;
      head_branch: string;
      base_branch?: string;
      author_type?: AuthorType;
      run_id?: string;
    }>(c);

    if (!body) {
      throw new BadRequestError('Invalid JSON body');
    }

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    if (!body.title || body.title.trim().length === 0) {
      throw new BadRequestError('Title is required');
    }

    if (!body.head_branch || body.head_branch.trim().length === 0) {
      throw new BadRequestError('Head branch is required');
    }

    const db = getDb(c.env.DB);
    const id = generateId();
    const number = await getNextPullRequestNumber(c.env.DB, repoId);
    const baseBranch = body.base_branch || repoAccess.repo.default_branch;
    const authorType = body.author_type || 'user';
    const timestamp = now();

    const pullRequest = await db.insert(pullRequests).values({
      id,
      repoId,
      number,
      title: body.title.trim(),
      description: body.description || null,
      headBranch: body.head_branch.trim(),
      baseBranch,
      status: 'open',
      authorType,
      authorId: user.id,
      runId: body.run_id || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).returning().get();
    const normalizedPullRequest = toPullRequestRecord(pullRequest);

    triggerPrEvent(c, repoAccess, user.id, {
      action: 'opened',
      number: normalizedPullRequest.number,
      title: normalizedPullRequest.title,
      body: normalizedPullRequest.description,
      state: 'open',
      merged: false,
      headRef: normalizedPullRequest.headBranch,
      baseRef: normalizedPullRequest.baseBranch,
      authorId: normalizedPullRequest.authorId,
    });

    const userMap = await buildUserLiteMap(db, [user.id]);
    const author = resolveActorLite({
      actorType: normalizedPullRequest.authorType,
      actorId: normalizedPullRequest.authorId,
      userMap,
    });

    return c.json({
      pull_request: toPullRequestDto(normalizedPullRequest, {
        author,
        commitsCount: 0,
        commentsCount: 0,
        reviewsCount: 0,
        isMergeable: true,
      }),
    }, 201);
  })
  .get('/repos/:repoId/pulls', zValidator('query', z.object({
    status: z.string().optional(),
    limit: z.string().optional(),
    offset: z.string().optional(),
  })), async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const { status: statusRaw, limit: limitRaw, offset: offsetRaw } = c.req.valid('query');
    const status = statusRaw as PullRequestStatus | undefined;
    const limit = parseLimit(limitRaw, 50, 100);
    const offset = parseOffset(offsetRaw);

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    return c.json({
      pull_requests: await buildPullRequestList(
        c.env,
        repoId,
        status,
        limit,
        offset,
      ),
    });
  })
  .get('/repos/:repoId/pulls/:prNumber', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const prNumber = parseInt(c.req.param('prNumber'));

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const found = await findPullRequest(c.env.DB, repoId, prNumber);
    if (!found) {
      throw new NotFoundError('Pull request');
    }
    const { db, pullRequest } = found;

    const detail = await buildPullRequestDetail(
      c.env,
      repoId,
      db,
      pullRequest,
    );

    return c.json({
      pull_request: detail.pullRequest,
      diff: detail.diff,
      diff_stats: detail.diffStats,
      review_count: detail.reviewCount,
      comment_count: detail.commentCount,
    });
  })
  .get('/repos/:repoId/pulls/:prNumber/diff', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const prNumber = parseInt(c.req.param('prNumber'));

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const found = await findPullRequest(c.env.DB, repoId, prNumber);
    if (!found) {
      throw new NotFoundError('Pull request');
    }
    const { pullRequest } = found;

    const diffResult = await buildDetailedRepoDiffPayload(c.env, repoId, pullRequest.baseBranch, pullRequest.headBranch);
    if (!diffResult.success) {
      return c.json(diffResult.body, diffResult.status);
    }

    return c.json(diffResult.payload);
  })
  .patch('/repos/:repoId/pulls/:prNumber', zValidator('json', z.object({
    title: z.string().optional(),
    description: z.string().optional(),
  })), async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const prNumber = parseInt(c.req.param('prNumber'));
    const body = c.req.valid('json');

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const found = await findPullRequest(c.env.DB, repoId, prNumber);
    if (!found) {
      throw new NotFoundError('Pull request');
    }
    const { db, pullRequest } = found;

    if (pullRequest.status !== 'open') {
      throw new BadRequestError('Cannot update a closed or merged pull request');
    }

    const updateData: { title?: string; description?: string; updatedAt: string } = {
      updatedAt: now(),
    };

    if (body.title !== undefined && body.title.trim().length > 0) {
      updateData.title = body.title.trim();
    }

    if (body.description !== undefined) {
      updateData.description = body.description;
    }

    if (Object.keys(updateData).length === 1) {
      throw new BadRequestError('No valid updates provided');
    }

    const updated = await db.update(pullRequests)
      .set(updateData)
      .where(eq(pullRequests.id, pullRequest.id))
      .returning()
      .get();
    const normalizedUpdated = toPullRequestRecord(updated);

    triggerPrEvent(c, repoAccess, user.id, {
      action: 'edited',
      number: normalizedUpdated.number,
      title: normalizedUpdated.title,
      body: normalizedUpdated.description,
      state: 'open',
      merged: false,
      headRef: normalizedUpdated.headBranch,
      baseRef: normalizedUpdated.baseBranch,
      authorId: normalizedUpdated.authorId,
    });

    const dto = await buildPullRequestDtoFull(db, normalizedUpdated);

    return c.json({ pull_request: dto });
  })
  .post('/repos/:repoId/pulls/:prNumber/close', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const prNumber = parseInt(c.req.param('prNumber'));

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin', 'editor']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const found = await findPullRequest(c.env.DB, repoId, prNumber);
    if (!found) {
      throw new NotFoundError('Pull request');
    }
    const { db, pullRequest } = found;

    if (pullRequest.status !== 'open') {
      throw new BadRequestError('Pull request is already closed or merged');
    }

    const updated = await db.update(pullRequests)
      .set({
        status: 'closed',
        updatedAt: now(),
      })
      .where(eq(pullRequests.id, pullRequest.id))
      .returning()
      .get();
    const normalizedUpdated = toPullRequestRecord(updated);

    triggerPrEvent(c, repoAccess, user.id, {
      action: 'closed',
      number: normalizedUpdated.number,
      title: normalizedUpdated.title,
      body: normalizedUpdated.description,
      state: 'closed',
      merged: false,
      headRef: normalizedUpdated.headBranch,
      baseRef: normalizedUpdated.baseBranch,
      authorId: normalizedUpdated.authorId,
    });

    const dto = await buildPullRequestDtoFull(db, normalizedUpdated);

    return c.json({ pull_request: dto });
  })
  .post('/repos/:repoId/pulls/:prNumber/merge', zValidator('json', z.object({
    merge_method: z.enum(['merge', 'squash', 'rebase']).optional(),
    commit_message: z.string().optional(),
  })), async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const prNumber = parseInt(c.req.param('prNumber'));
    const body = c.req.valid('json');

    const mergeMethodRaw = body.merge_method;
    const mergeMethod: 'merge' | 'squash' | 'rebase' =
      mergeMethodRaw === 'merge' || mergeMethodRaw === 'squash' || mergeMethodRaw === 'rebase'
        ? mergeMethodRaw
        : 'merge';

    if (mergeMethodRaw !== undefined && mergeMethod !== mergeMethodRaw) {
      throw new BadRequestError('Invalid merge_method');
    }

    const commitMessage = typeof body.commit_message === 'string' ? body.commit_message.trim() : '';

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const found = await findPullRequest(c.env.DB, repoId, prNumber);
    if (!found) {
      throw new NotFoundError('Pull request');
    }
    const { db, pullRequest } = found;

    if (pullRequest.status !== 'open') {
      throw new BadRequestError('Pull request is already closed or merged');
    }

    try {
      const mergeResult = await performPullRequestMerge({
        env: c.env,
        db,
        repoId,
        pullRequest,
        mergeMethod,
        commitMessage,
        user,
      });

      if (!mergeResult.success) {
        return jsonErrorWithStatus(mergeResult.body, mergeResult.status);
      }

      if (mergeResult.pushBefore) {
        scheduleActionsAutoTrigger(
          c.executionCtx,
          () => triggerPushWorkflows(
            {
              db: c.env.DB,
              bucket: c.env.GIT_OBJECTS,
              queue: c.env.WORKFLOW_QUEUE,
              encryptionKey: c.env.ENCRYPTION_KEY,
            },
            {
              repoId,
              branch: pullRequest.baseBranch,
              before: mergeResult.pushBefore,
              after: mergeResult.mergeCommit,
              actorId: user.id,
              actorName: user.name,
              actorEmail: user.email,
            }
          ),
          `pull-requests.merge repo=${repoId} branch=${pullRequest.baseBranch}`
        );
      }

      triggerPrEvent(c, repoAccess, user.id, {
        action: 'closed',
        number: mergeResult.pullRequest.number,
        title: mergeResult.pullRequest.title,
        body: mergeResult.pullRequest.description,
        state: 'closed',
        merged: true,
        mergedAt: toIsoString(mergeResult.pullRequest.mergedAt),
        headRef: mergeResult.pullRequest.headBranch,
        headSha: mergeResult.headSha,
        baseRef: mergeResult.pullRequest.baseBranch,
        baseSha: mergeResult.baseShaForEvent,
        authorId: mergeResult.pullRequest.authorId,
      });

      return c.json({
        pull_request: await buildPullRequestDtoFull(db, mergeResult.pullRequest),
        merge_commit: mergeResult.mergeCommit,
      });
    } catch (err: unknown) {
      logError('Failed to merge', err, { module: 'routes/pull-requests/base' });
      throw new InternalError('Failed to perform merge');
    }
  })
  .get('/repos/:repoId/pulls/:prNumber/conflicts', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const prNumber = parseInt(c.req.param('prNumber'));

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const found = await findPullRequest(c.env.DB, repoId, prNumber);
    if (!found) {
      throw new NotFoundError('Pull request');
    }
    const { pullRequest } = found;

    if (pullRequest.status !== 'open') {
      throw new BadRequestError('Pull request is not open');
    }

    const bucketBinding = c.env.GIT_OBJECTS;
    if (!bucketBinding) throw new InternalError('Git storage not configured');
    const bucket = toGitBucket(bucketBinding);

    try {
      const result = await checkConflicts(
        c.env.DB,
        bucket,
        repoId,
        pullRequest.baseBranch,
        pullRequest.headBranch,
      );

      if (result.message) {
        return c.json({
          conflicts: result.conflicts,
          merge_base: result.merge_base,
          message: result.message,
        }, 409);
      }

      return c.json(result);
    } catch (err: unknown) {
      if (err instanceof ConflictCheckError) {
        throw new AppError(err.message, undefined, err.status);
      }
      throw err;
    }
  })
  .post('/repos/:repoId/pulls/:prNumber/resolve', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const prNumber = parseInt(c.req.param('prNumber'));
    const body = await parseJsonBody<{
      resolutions: Array<{ path: string; content: string; delete?: boolean }>;
      commit_message?: string;
    }>(c, { resolutions: [] });

    if (!body || !body.resolutions || !Array.isArray(body.resolutions)) {
      throw new BadRequestError('resolutions array is required');
    }

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id, ['owner', 'admin']);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const found = await findPullRequest(c.env.DB, repoId, prNumber);
    if (!found) {
      throw new NotFoundError('Pull request');
    }
    const { db, pullRequest } = found;

    if (pullRequest.status !== 'open') {
      throw new BadRequestError('Pull request is not open');
    }

    const bucketBinding = c.env.GIT_OBJECTS;
    if (!bucketBinding) throw new InternalError('Git storage not configured');
    const bucket = toGitBucket(bucketBinding);

    // Validate and normalize resolutions in the route layer (early return on bad input)
    const normalizedResolutions: Resolution[] = [];
    const seenResolutionPaths = new Set<string>();
    for (const resolution of body.resolutions) {
      const normalizedPath = validateConflictResolutionPath(resolution.path);
      if (!normalizedPath) {
        throw new BadRequestError('Invalid resolution path');
      }
      if (seenResolutionPaths.has(normalizedPath)) {
        throw new BadRequestError(`Duplicate resolution path: ${normalizedPath}`);
      }
      seenResolutionPaths.add(normalizedPath);

      const isDelete = resolution.delete === true;
      if (!isDelete && typeof resolution.content !== 'string') {
        throw new BadRequestError(`Resolution content must be a string for path: ${normalizedPath}`);
      }

      normalizedResolutions.push({
        path: normalizedPath,
        content: isDelete ? '' : resolution.content,
        delete: isDelete,
      });
    }

    try {
      const result = await resolveConflictsAndMerge({
        db: c.env.DB,
        bucket,
        repoId,
        pullRequestId: pullRequest.id,
        baseBranch: pullRequest.baseBranch,
        headBranch: pullRequest.headBranch,
        resolutions: normalizedResolutions,
        commitMessage: body.commit_message,
        user,
      });

      if (!result.success) {
        return jsonErrorWithStatus(result.body, result.status);
      }

      return c.json({
        pull_request: await buildPullRequestDtoFull(db, result.pullRequest),
        merge_commit: result.mergeCommit,
      });
    } catch (err: unknown) {
      logError('Failed to resolve conflicts', err, { module: 'routes/pull-requests/base' });
      throw new InternalError('Failed to resolve conflicts');
    }
  });
