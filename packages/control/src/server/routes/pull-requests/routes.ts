import { Hono } from 'hono';
import { z } from 'zod';
import type { PullRequestStatus, AuthorType } from '../../../shared/types';
import { generateId } from '../../../shared/utils';
import { parseJsonBody, parseLimit, parseOffset, type AuthenticatedRouteEnv } from '../route-auth';
import { zValidator } from '../zod-validator';
import { checkRepoAccess } from '../../../application/services/source/repos';
import { getDb } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import { pullRequests } from '../../../infra/db/schema';

import {
  buildPullRequestDtoFull,
  buildUserLiteMap,
  resolveActorLite,
  toPullRequestDto,
  toPullRequestRecord,
} from './dto';
import { buildDetailedRepoDiffPayload } from './diff';
import { BadRequestError, NotFoundError } from 'takos-common/errors';
import {
  buildPullRequestDetail,
  buildPullRequestList,
  findPullRequest,
  getNextPullRequestNumber,
} from './read-model';
import { triggerPrEvent } from './workflow-trigger';

// ---------------------------------------------------------------------------
// CRUD Routes (create, list, get, get-diff, update, close)
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
    const timestamp = new Date().toISOString();

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
      updatedAt: new Date().toISOString(),
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
        updatedAt: new Date().toISOString(),
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
  });
