import type { D1Database } from "../../../shared/types/bindings.ts";
import type { Database } from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { FollowUserResponse } from "./dto.ts";
import { paginatedResponse } from "../../../shared/utils/index.ts";
import { createNotification } from "../../../application/services/notifications/service.ts";
import { isMutedBy } from "./profile-queries.ts";
import {
  accountBlocks,
  accountFollowRequests,
  accountFollows,
  accountMutes,
  accounts,
} from "../../../infra/db/schema.ts";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";

export async function getBlockFlags(
  db: Database,
  currentUserId: string | undefined,
  targetUserId: string,
): Promise<{ blocked_by_target: boolean; is_blocking: boolean }> {
  if (!currentUserId) return { blocked_by_target: false, is_blocking: false };

  const blockedByTarget = await db.select({
    blockerAccountId: accountBlocks.blockerAccountId,
  })
    .from(accountBlocks)
    .where(and(
      eq(accountBlocks.blockerAccountId, targetUserId),
      eq(accountBlocks.blockedAccountId, currentUserId),
    ))
    .get();
  const isBlocking = await db.select({
    blockerAccountId: accountBlocks.blockerAccountId,
  })
    .from(accountBlocks)
    .where(and(
      eq(accountBlocks.blockerAccountId, currentUserId),
      eq(accountBlocks.blockedAccountId, targetUserId),
    ))
    .get();
  return { blocked_by_target: !!blockedByTarget, is_blocking: !!isBlocking };
}

export async function fetchFollowList(
  _db: D1Database,
  db: Database,
  profileUserId: string,
  currentUserId: string | undefined,
  mode: "followers" | "following",
  options: { limit: number; offset: number; sort: string; order: string },
): Promise<{ users: FollowUserResponse[]; total: number; has_more: boolean }> {
  const { limit, offset, sort, order } = options;
  const orderDirection: "asc" | "desc" = order.toLowerCase() === "asc"
    ? "asc"
    : "desc";

  const isFollowers = mode === "followers";
  const whereField = isFollowers
    ? accountFollows.followingAccountId
    : accountFollows.followerAccountId;
  const joinField = isFollowers
    ? accountFollows.followerAccountId
    : accountFollows.followingAccountId;

  const where = eq(whereField, profileUserId);

  const totalResult = await db.select({ count: count() }).from(accountFollows)
    .where(where).get();
  const total = totalResult?.count ?? 0;

  // Build a query joining accountFollows with accounts
  const orderByClause = sort === "username"
    ? (orderDirection === "asc" ? asc(accounts.slug) : desc(accounts.slug))
    : (orderDirection === "asc"
      ? asc(accountFollows.createdAt)
      : desc(accountFollows.createdAt));

  const followsData = await db.select({
    followId: joinField,
    accountId: accounts.id,
    slug: accounts.slug,
    name: accounts.name,
    picture: accounts.picture,
    bio: accounts.bio,
  })
    .from(accountFollows)
    .innerJoin(accounts, eq(joinField, accounts.id))
    .where(where)
    .orderBy(orderByClause)
    .limit(limit)
    .offset(offset)
    .all();

  // Batch follow-check: collect all user IDs, single query, build Set
  const candidateUsers = followsData.filter((u) => !!u.slug);
  const candidateUserIds = candidateUsers.map((u) => u.accountId);

  let followingSet = new Set<string>();
  if (currentUserId && candidateUserIds.length > 0) {
    const followRows = await db.select({
      followingAccountId: accountFollows.followingAccountId,
    })
      .from(accountFollows)
      .where(and(
        eq(accountFollows.followerAccountId, currentUserId),
        inArray(accountFollows.followingAccountId, candidateUserIds),
      ))
      .all();
    followingSet = new Set(followRows.map((r) => r.followingAccountId));
  }

  const users: FollowUserResponse[] = [];
  for (const user of candidateUsers) {
    users.push({
      username: user.slug,
      name: user.name,
      picture: user.picture,
      bio: user.bio,
      is_following: followingSet.has(user.accountId),
    });
  }

  const { has_more } = paginatedResponse(users, total, { limit, offset });
  return { users, total, has_more };
}

export async function sendFollowNotificationIfNotMuted(
  env: Env,
  d1: D1Database,
  targetUserId: string,
  actor: { id: string; username: string; name: string; picture: string | null },
  type: "social.follow.requested" | "social.followed",
): Promise<void> {
  const targetMutedActor = await isMutedBy(d1, targetUserId, actor.id);
  if (targetMutedActor) return;

  const isRequest = type === "social.follow.requested";
  const prefix = isRequest ? "requester" : "follower";
  await createNotification(env, {
    userId: targetUserId,
    type,
    title: isRequest ? "New follow request" : "New follower",
    body: isRequest
      ? `${actor.username} requested to follow you`
      : `${actor.username} started following you`,
    data: {
      [`${prefix}_username`]: actor.username,
      [`${prefix}_name`]: actor.name,
      [`${prefix}_picture`]: actor.picture,
    },
  });
}

export async function isMutedByViewer(
  db: Database,
  currentUserId: string | undefined,
  targetUserId: string,
): Promise<boolean> {
  if (!currentUserId) return false;
  const row = await db.select({ muterAccountId: accountMutes.muterAccountId })
    .from(accountMutes)
    .where(and(
      eq(accountMutes.muterAccountId, currentUserId),
      eq(accountMutes.mutedAccountId, targetUserId),
    ))
    .get();
  return !!row;
}

export async function hasPendingFollowRequest(
  db: Database,
  requesterId: string | undefined,
  targetId: string,
): Promise<boolean> {
  if (!requesterId) return false;
  const row = await db.select({ id: accountFollowRequests.id })
    .from(accountFollowRequests)
    .where(and(
      eq(accountFollowRequests.requesterAccountId, requesterId),
      eq(accountFollowRequests.targetAccountId, targetId),
      eq(accountFollowRequests.status, "pending"),
    ))
    .get();
  return !!row;
}
