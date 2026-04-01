import { Hono } from 'hono';
import { z } from 'zod';
import { generateId } from '../../../shared/utils/index.ts';
import type { AuthenticatedRouteEnv } from '../route-auth.ts';
import { BadRequestError } from 'takos-common/errors';
import { zValidator } from '../zod-validator.ts';
import { checkRepoAccess } from '../../../application/services/source/repos.ts';
import { getDb } from '../../../infra/db/index.ts';
import { eq, and, asc } from 'drizzle-orm';
import { pullRequests, prComments } from '../../../infra/db/schema.ts';
import { createNotification } from '../../../application/services/notifications/service.ts';

import type { PullRequestCommentDto } from './dto.ts';
import { buildUserLiteMap, resolveActorLite } from './dto.ts';
import { logWarn } from '../../../shared/utils/logger.ts';
import { NotFoundError } from 'takos-common/errors';
import { textDate } from '../../../shared/utils/db-guards.ts';

function toCommentDto(
  comment: {
    id: string;
    prId: string;
    authorType: string;
    authorId: string | null;
    content: string;
    filePath: string | null;
    lineNumber: number | null;
    createdAt: string | Date;
  },
  userMap: Map<string, { id: string; name: string; avatar_url: string | null }>
): PullRequestCommentDto {
  const author_type = comment.authorType === 'ai' ? 'ai' : 'user';
  return {
    id: comment.id,
    pr_id: comment.prId,
    author_type,
    author_id: comment.authorId,
    body: comment.content,
    path: comment.filePath,
    line: comment.lineNumber,
    created_at: textDate(comment.createdAt),
    author: resolveActorLite({
      actorType: comment.authorType,
      actorId: comment.authorId,
      userMap,
    }),
  };
}

export default new Hono<AuthenticatedRouteEnv>()
  .post('/repos/:repoId/pulls/:prNumber/comments',
    zValidator('json', z.object({
      body: z.string().optional(),
      content: z.string().optional(),
      file_path: z.string().optional(),
      line_number: z.number().optional(),
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

    const content = (body.body ?? body.content ?? '').trim();
    if (!content) {
      throw new BadRequestError( 'Comment content is required');
    }

    const id = generateId();
    const timestamp = new Date().toISOString();

    const comment = await db.insert(prComments).values({
      id,
      prId: pullRequest.id,
      authorType: 'user',
      authorId: user.id,
      content,
      filePath: body.file_path || null,
      lineNumber: body.line_number || null,
      createdAt: timestamp,
    }).returning().get();

    // Notify PR author
    try {
      if (pullRequest.authorType === 'user' && pullRequest.authorId && pullRequest.authorId !== user.id) {
        await createNotification(c.env, {
          userId: pullRequest.authorId,
          spaceId: repoAccess.repo.space_id,
          type: 'pr.comment',
          title: `Comment on PR #${prNumber}: ${pullRequest.title}`,
          body: content.slice(0, 200),
          data: {
            repo_id: repoId,
            repo_name: repoAccess.repo.name,
            pr_number: prNumber,
            pr_title: pullRequest.title,
            comment_id: id,
            author_id: user.id,
            file_path: body.file_path || null,
            line_number: body.line_number || null,
          },
        });
      }
    } catch (err) {
      logWarn('Failed to create PR comment notification', { module: 'notifications', error: err instanceof Error ? err.message : String(err) });
    }

    const userMap = await buildUserLiteMap(db, [user.id]);
    return c.json({ comment: toCommentDto(comment, userMap) }, 201);
  })
  .get('/repos/:repoId/pulls/:prNumber/comments', async (c) => {
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

    const comments = await db.select()
      .from(prComments)
      .where(eq(prComments.prId, pullRequest.id))
      .orderBy(asc(prComments.createdAt))
      .all();

    const userIds = comments
      .filter((comment) => comment.authorType === 'user' && comment.authorId)
      .map((comment) => comment.authorId!) as string[];
    const userMap = await buildUserLiteMap(db, userIds);

    return c.json({
      comments: comments.map((comment) => toCommentDto(comment, userMap)),
    });
  });
