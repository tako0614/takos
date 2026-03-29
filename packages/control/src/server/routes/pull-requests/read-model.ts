import * as gitStore from '../../../application/services/git-smart';
import { getDb, type Database } from '../../../infra/db';
import { eq, and, count, desc, inArray, sql } from 'drizzle-orm';
import { pullRequests, prReviews, prComments } from '../../../infra/db/schema';
import type { PullRequestStatus } from '../../../shared/types';
import { buildRepoDiffPayload, type RepoDiffPayload } from './diff';
import {
  buildUserLiteMap,
  resolveActorLite,
  toPullRequestDto,
  toPullRequestRecord,
  type PullRequestDto,
  type PullRequestRecord,
} from './dto';
import { toGitBucket } from '../../../shared/utils/git-bucket';
import type { AuthenticatedRouteEnv } from '../route-auth';
import { logError } from '../../../shared/utils/logger';

export type PullRequestDetail = {
  pullRequest: PullRequestDto;
  diff: RepoDiffPayload | null;
  diffStats: RepoDiffPayload['stats'] | null;
  reviewCount: number;
  commentCount: number;
};

async function buildCommitMetrics(
  env: AuthenticatedRouteEnv['Bindings'],
  repoId: string,
  pullRequests: PullRequestRecord[],
): Promise<{
  commitsCountByPrId: Map<string, number>;
  mergeableByPrId: Map<string, boolean>;
}> {
  const bucketBinding = env.GIT_OBJECTS;
  const commitsCountByPrId = new Map<string, number>();
  const mergeableByPrId = new Map<string, boolean>();

  if (!bucketBinding || pullRequests.length === 0) {
    return { commitsCountByPrId, mergeableByPrId };
  }

  const bucket = toGitBucket(bucketBinding);
  await Promise.all(pullRequests.map(async (pullRequest) => {
    const [baseSha, headSha] = await Promise.all([
      gitStore.resolveRef(env.DB, repoId, pullRequest.baseBranch),
      gitStore.resolveRef(env.DB, repoId, pullRequest.headBranch),
    ]);
    if (!baseSha || !headSha) {
      mergeableByPrId.set(pullRequest.id, false);
      return;
    }

    mergeableByPrId.set(pullRequest.id, true);
    try {
      const { ahead } = await gitStore.countCommitsBetween(env.DB, bucket, repoId, baseSha, headSha);
      commitsCountByPrId.set(pullRequest.id, ahead);
    } catch {
      // Commit count lookup can fail for orphaned refs; default to 0
      commitsCountByPrId.set(pullRequest.id, 0);
    }
  }));

  return { commitsCountByPrId, mergeableByPrId };
}

export async function getNextPullRequestNumber(
  d1: AuthenticatedRouteEnv['Bindings']['DB'],
  repoId: string,
): Promise<number> {
  const db = getDb(d1);
  const result = await db.select({ maxNumber: sql<number>`max(${pullRequests.number})` })
    .from(pullRequests)
    .where(eq(pullRequests.repoId, repoId))
    .get();
  return (result?.maxNumber || 0) + 1;
}

export async function findPullRequest(
  d1: AuthenticatedRouteEnv['Bindings']['DB'],
  repoId: string,
  prNumber: number,
): Promise<{ db: Database; pullRequest: PullRequestRecord } | null> {
  const db = getDb(d1);
  const pullRequest = await db.select()
    .from(pullRequests)
    .where(and(eq(pullRequests.repoId, repoId), eq(pullRequests.number, prNumber)))
    .get();
  if (!pullRequest) {
    return null;
  }
  return { db, pullRequest: toPullRequestRecord(pullRequest) };
}

export async function buildPullRequestList(
  env: AuthenticatedRouteEnv['Bindings'],
  repoId: string,
  status: PullRequestStatus | undefined,
  limit: number,
  offset: number,
): Promise<PullRequestDto[]> {
  const db = getDb(env.DB);
  const whereConditions = status
    ? and(eq(pullRequests.repoId, repoId), eq(pullRequests.status, status))
    : eq(pullRequests.repoId, repoId);
  const rows = await db.select()
    .from(pullRequests)
    .where(whereConditions)
    .orderBy(desc(pullRequests.createdAt))
    .limit(limit)
    .offset(offset)
    .all();
  const prList = rows.map((row) => toPullRequestRecord(row));
  const prIds = prList.map((pullRequest) => pullRequest.id);

  const [reviewCounts, commentCounts, { commitsCountByPrId, mergeableByPrId }] = await Promise.all([
    prIds.length > 0
      ? db.select({ prId: prReviews.prId, count: count() })
          .from(prReviews)
          .where(inArray(prReviews.prId, prIds))
          .groupBy(prReviews.prId)
          .all()
      : Promise.resolve([]),
    prIds.length > 0
      ? db.select({ prId: prComments.prId, count: count() })
          .from(prComments)
          .where(inArray(prComments.prId, prIds))
          .groupBy(prComments.prId)
          .all()
      : Promise.resolve([]),
    buildCommitMetrics(env, repoId, prList),
  ]);

  const reviewCountMap = new Map(reviewCounts.map((row) => [row.prId, row.count]));
  const commentCountMap = new Map(commentCounts.map((row) => [row.prId, row.count]));
  const authorUserIds = prList
    .filter((pullRequest) => pullRequest.authorType === 'user' && pullRequest.authorId)
    .map((pullRequest) => pullRequest.authorId as string);
  const userMap = await buildUserLiteMap(db, authorUserIds);

  return prList.map((pullRequest) => {
    const author = resolveActorLite({
      actorType: pullRequest.authorType,
      actorId: pullRequest.authorId,
      userMap,
    });
    return toPullRequestDto(pullRequest, {
      author,
      commitsCount: commitsCountByPrId.get(pullRequest.id) || 0,
      commentsCount: commentCountMap.get(pullRequest.id) || 0,
      reviewsCount: reviewCountMap.get(pullRequest.id) || 0,
      isMergeable: mergeableByPrId.get(pullRequest.id) ?? false,
    });
  });
}

export async function buildPullRequestDetail(
  env: AuthenticatedRouteEnv['Bindings'],
  repoId: string,
  db: Database,
  pullRequest: PullRequestRecord,
): Promise<PullRequestDetail> {
  let diff: RepoDiffPayload | null = null;
  try {
    diff = await buildRepoDiffPayload(env, repoId, pullRequest.baseBranch, pullRequest.headBranch);
  } catch (err: unknown) {
    logError('Failed to get diff payload', err, { module: 'routes/pull-requests/read-model' });
  }

  const [reviewResult, commentResult, userMap, { commitsCountByPrId, mergeableByPrId }] = await Promise.all([
    db.select({ count: count() }).from(prReviews).where(eq(prReviews.prId, pullRequest.id)).get(),
    db.select({ count: count() }).from(prComments).where(eq(prComments.prId, pullRequest.id)).get(),
    buildUserLiteMap(
      db,
      pullRequest.authorType === 'user' && pullRequest.authorId ? [pullRequest.authorId] : [],
    ),
    buildCommitMetrics(env, repoId, [pullRequest]),
  ]);
  const reviewCount = reviewResult?.count ?? 0;
  const commentCount = commentResult?.count ?? 0;

  const author = resolveActorLite({
    actorType: pullRequest.authorType,
    actorId: pullRequest.authorId,
    userMap,
  });

  return {
    pullRequest: toPullRequestDto(pullRequest, {
      author,
      commitsCount: commitsCountByPrId.get(pullRequest.id) || 0,
      commentsCount: commentCount,
      reviewsCount: reviewCount,
      isMergeable: mergeableByPrId.get(pullRequest.id) ?? false,
    }),
    diff,
    diffStats: diff?.stats || null,
    reviewCount,
    commentCount,
  };
}
