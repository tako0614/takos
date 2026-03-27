import { Hono } from 'hono';
import { z } from 'zod';
import type { ReviewStatus, ReviewerType } from '../../../shared/types';
import { generateId, now, toIsoString } from '../../../shared/utils';
import { badRequest, type AuthenticatedRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import { checkRepoAccess } from '../../../application/services/source/repos';
import { getDb } from '../../../infra/db';
import { eq, and, asc } from 'drizzle-orm';
import { pullRequests, prReviews } from '../../../infra/db/schema';
import { AiReviewError, runAiReview } from '../../../application/services/pull-requests/ai-review';
import { createNotification } from '../../../application/services/notifications/service';

import type { PullRequestCommentDto, PullRequestReviewDto } from './dto';
import { AI_USER_LITE, buildUserLiteMap, resolveActorLite } from './dto';
import { logError, logWarn } from '../../../shared/utils/logger';
import { NotFoundError, InternalError } from '@takos/common/errors';

function toReviewStatus(value: string): ReviewStatus {
  if (value === 'approved' || value === 'changes_requested' || value === 'commented') {
    return value;
  }
  return 'commented';
}

function toReviewerType(value: string): ReviewerType {
  if (value === 'user' || value === 'ai') {
    return value;
  }
  return 'user';
}

function toReviewDto(
  review: {
    id: string;
    prId: string;
    reviewerType: string;
    reviewerId: string | null;
    status: string;
    body: string | null;
    analysis: string | null;
    createdAt: string | Date;
  },
  userMap: Map<string, { id: string; name: string; avatar_url: string | null }>
): PullRequestReviewDto {
  return {
    id: review.id,
    pr_id: review.prId,
    reviewer_type: toReviewerType(review.reviewerType),
    reviewer_id: review.reviewerId,
    status: toReviewStatus(review.status),
    body: review.body,
    analysis: review.analysis,
    created_at: toIsoString(review.createdAt),
    author: resolveActorLite({
      actorType: review.reviewerType,
      actorId: review.reviewerId,
      userMap,
    }),
  };
}

function toAiReviewDto(review: {
  id: string;
  pr_id: string;
  reviewer_type: string;
  reviewer_id: string | null;
  status: string;
  body: string | null;
  analysis: string | null;
  created_at: string;
}): PullRequestReviewDto {
  return {
    id: review.id,
    pr_id: review.pr_id,
    reviewer_type: review.reviewer_type === 'ai' ? 'ai' : 'user',
    reviewer_id: review.reviewer_id,
    status: toReviewStatus(review.status),
    body: review.body,
    analysis: review.analysis,
    created_at: review.created_at,
    author: AI_USER_LITE,
  };
}

function toAiCommentDto(comment: {
  id: string;
  pr_id: string;
  author_type: string;
  author_id: string | null;
  content: string;
  file_path: string | null;
  line_number: number | null;
  created_at: string;
}): PullRequestCommentDto {
  return {
    id: comment.id,
    pr_id: comment.pr_id,
    author_type: comment.author_type === 'ai' ? 'ai' : 'user',
    author_id: comment.author_id,
    body: comment.content,
    path: comment.file_path,
    line: comment.line_number,
    created_at: comment.created_at,
    author: AI_USER_LITE,
  };
}

export default new Hono<AuthenticatedRouteEnv>()
  .post('/repos/:repoId/pulls/:prNumber/reviews',
    zValidator('json', z.object({
      status: z.enum(['approved', 'changes_requested', 'commented']),
      body: z.string().optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const prNumber = parseInt(c.req.param('prNumber'));
    const body = c.req.valid('json');

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const db = getDb(c.env.DB);
    const pullRequest = await db.select()
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, prNumber)))
      .get();

    if (!pullRequest) {
      throw new NotFoundError('Pull request');
    }

    const validStatuses: ReviewStatus[] = ['approved', 'changes_requested', 'commented'];
    if (!body.status || !validStatuses.includes(body.status)) {
      return badRequest(c, 'Invalid review status');
    }

    const id = generateId();
    const reviewerType = 'user';
    const timestamp = now();

    const review = await db.insert(prReviews).values({
      id,
      prId: pullRequest.id,
      reviewerType,
      reviewerId: user.id,
      status: body.status,
      body: body.body || null,
      analysis: null,
      createdAt: timestamp,
    }).returning().get();

    // Notify PR author
    try {
      if (pullRequest.authorType === 'user' && pullRequest.authorId && pullRequest.authorId !== user.id) {
        await createNotification(c.env, {
          userId: pullRequest.authorId,
          spaceId: repoAccess.repo.space_id,
          type: 'pr.comment',
          title: `Review on PR #${prNumber}: ${pullRequest.title}`,
          body: body.body ? body.body.slice(0, 200) : `Status: ${body.status}`,
          data: {
            repo_id: repoId,
            repo_name: repoAccess.repo.name,
            pr_number: prNumber,
            pr_title: pullRequest.title,
            review_status: body.status,
            reviewer_id: user.id,
          },
        });
      }
    } catch (err) {
      logWarn('Failed to create PR review notification', { module: 'notifications', error: err instanceof Error ? err.message : String(err) });
    }

    const userMap = await buildUserLiteMap(db, [user.id]);
    return c.json({ review: toReviewDto(review, userMap) }, 201);
  })
  .get('/repos/:repoId/pulls/:prNumber/reviews', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const prNumber = parseInt(c.req.param('prNumber'));

    const repoAccess = await checkRepoAccess(c.env, repoId, user?.id, undefined, { allowPublicRead: true });
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const db = getDb(c.env.DB);
    const pullRequest = await db.select()
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, prNumber)))
      .get();

    if (!pullRequest) {
      throw new NotFoundError('Pull request');
    }

    const reviews = await db.select()
      .from(prReviews)
      .where(eq(prReviews.prId, pullRequest.id))
      .orderBy(asc(prReviews.createdAt))
      .all();

    const userIds = reviews
      .filter((review) => review.reviewerType === 'user' && review.reviewerId)
      .map((review) => review.reviewerId!) as string[];
    const userMap = await buildUserLiteMap(db, userIds);

    return c.json({
      reviews: reviews.map((review) => toReviewDto(review, userMap)),
    });
  })
  .post('/repos/:repoId/pulls/:prNumber/ai-review', async (c) => {
    const user = c.get('user');
    const repoId = c.req.param('repoId');
    const prNumber = parseInt(c.req.param('prNumber'));

    const repoAccess = await checkRepoAccess(c.env, repoId, user.id);
    if (!repoAccess) {
      throw new NotFoundError('Repository');
    }

    const db = getDb(c.env.DB);
    const pullRequest = await db.select()
      .from(pullRequests)
      .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, prNumber)))
      .get();

    if (!pullRequest) {
      throw new NotFoundError('Pull request');
    }

    try {
      const result = await runAiReview({
        env: c.env,
        repoId,
        pullRequest,
        spaceId: repoAccess.repo.space_id,
      });

      return c.json({
        review: toAiReviewDto(result.review),
        comments: result.comments.map((comment) => toAiCommentDto(comment)),
        model: result.model,
        provider: result.provider,
      }, 201);
    } catch (err) {
      if (err instanceof AiReviewError) {
        throw err;
      }
      logError('AI review failed', err, { module: 'reviews' });
      throw new InternalError('AI review failed');
    }
  });
