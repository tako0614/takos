import { Hono } from 'hono';
import { z } from 'zod';
import { generateId, now, toIsoString } from '../../../shared/utils';
import { createNotification } from '../../../application/services/notifications/service';
import { fetchProfileActivity } from '../../../application/services/identity/profile-activity';
import { parseLimit, parseOffset, type OptionalAuthRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import { NotFoundError, AuthenticationError, AuthorizationError, BadRequestError } from '@takos/common/errors';
import { batchStarCheck, getUserByUsername, getUserPrivacySettings, getUserStats, isFollowing, isMutedBy } from './shared';
import { getDb } from '../../../infra/db';
import {
  accountBlocks, accountFollows, accountFollowRequests, accountMutes,
  accounts, repositories, repoStars,
} from '../../../infra/db/schema';
import { eq, and, or, desc, asc, count, inArray } from 'drizzle-orm';
import { getBlockFlags, fetchFollowList, sendFollowNotificationIfNotMuted, isMutedByViewer, hasPendingFollowRequest } from './helpers';
import type { UserProfileResponse, ProfileRepoResponse, FollowUserResponse, FollowRequestResponse } from './types';

export type { UserProfileResponse, ProfileRepoResponse, FollowUserResponse, FollowRequestResponse };

const followListQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
  sort: z.string().optional(),
  order: z.string().optional(),
});

const profilesApi = new Hono<OptionalAuthRouteEnv>()

.get('/:username', async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }

  const blockFlags = await getBlockFlags(db, currentUser?.id, profileUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  const stats = await getUserStats(c.env.DB, profileUser.id);
  const isSelf = !!currentUser && currentUser.id === profileUser.id;
  const privacy = await getUserPrivacySettings(c.env.DB, profileUser.id);
  const following = await isFollowing(c.env.DB, currentUser?.id, profileUser.id);
  const followRequested = !isSelf && !following
    ? await hasPendingFollowRequest(db, currentUser?.id, profileUser.id)
    : false;
  const muted = !isSelf ? await isMutedByViewer(db, currentUser?.id, profileUser.id) : false;

  const profile: UserProfileResponse = {
    username: profileUser.username || username,
    name: profileUser.name,
    bio: profileUser.bio,
    picture: profileUser.picture,
    public_repo_count: stats.public_repo_count,
    followers_count: stats.followers_count,
    following_count: stats.following_count,
    is_self: isSelf,
    private_account: privacy.private_account,
    is_following: following,
    follow_requested: followRequested,
    is_blocking: blockFlags.is_blocking,
    is_muted: muted,
    created_at: profileUser.created_at,
  };

  return c.json({ user: profile });
})

.get('/:username/repos',
  zValidator('query', z.object({
    limit: z.string().optional(),
    offset: z.string().optional(),
    sort: z.string().optional(),
    order: z.string().optional(),
  })),
  async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const { limit: limitRaw, offset: offsetRaw, sort: sortRaw, order: orderRaw } = c.req.valid('query');
  const limit = parseLimit(limitRaw, 20, 100);
  const offset = parseOffset(offsetRaw);
  const sort = sortRaw || 'updated';
  const order = orderRaw || 'desc';
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }
  const blockFlags = await getBlockFlags(db, currentUser?.id, profileUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  const ALLOWED_SORT_COLUMNS = {
    'updated': repositories.updatedAt,
    'stars': repositories.stars,
    'name': repositories.name,
  } as const;
  const orderByColumn = ALLOWED_SORT_COLUMNS[sort as keyof typeof ALLOWED_SORT_COLUMNS] || ALLOWED_SORT_COLUMNS['updated'];
  const orderByClause = order.toLowerCase() === 'asc' ? asc(orderByColumn) : desc(orderByColumn);

  const repoWhere = and(
    eq(repositories.accountId, profileUser.id),
    eq(repositories.visibility, 'public'),
  );

  const totalResult = await db.select({ count: count() }).from(repositories).where(repoWhere).get();
  const total = totalResult?.count ?? 0;

  const reposData = await db.select().from(repositories)
    .where(repoWhere)
    .orderBy(orderByClause)
    .limit(limit)
    .offset(offset)
    .all();

  const starredSet = await batchStarCheck(c.env.DB, currentUser?.id, reposData.map((r) => r.id));

  const repos: ProfileRepoResponse[] = reposData.map((repo) => ({
    owner_username: profileUser.username || username,
    name: repo.name,
    description: repo.description,
    visibility: repo.visibility as 'public' | 'private',
    default_branch: repo.defaultBranch,
    stars: repo.stars,
    forks: repo.forks,
    is_starred: starredSet.has(repo.id),
    updated_at: toIsoString(repo.updatedAt),
  }));

  return c.json({
    repos,
    total,
    has_more: offset + repos.length < total,
  });
})

.get('/:username/stars',

  zValidator('query', z.object({
    limit: z.string().optional(),
    offset: z.string().optional(),
  })),
  async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const { limit: limitRaw, offset: offsetRaw } = c.req.valid('query');
  const limit = parseLimit(limitRaw, 20, 100);
  const offset = parseOffset(offsetRaw);
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }
  const blockFlags = await getBlockFlags(db, currentUser?.id, profileUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  // Count stars with public repos using a join
  const totalResult = await db.select({ count: count() })
    .from(repoStars)
    .innerJoin(repositories, eq(repoStars.repoId, repositories.id))
    .where(and(
      eq(repoStars.accountId, profileUser.id),
      eq(repositories.visibility, 'public'),
    ))
    .get();
  const total = totalResult?.count ?? 0;

  // Query stars with joined repo and account data
  const starsData = await db.select({
    starAccountId: repoStars.accountId,
    starRepoId: repoStars.repoId,
    starCreatedAt: repoStars.createdAt,
    repoId: repositories.id,
    repoName: repositories.name,
    repoDescription: repositories.description,
    repoVisibility: repositories.visibility,
    repoDefaultBranch: repositories.defaultBranch,
    repoStars: repositories.stars,
    repoForks: repositories.forks,
    repoUpdatedAt: repositories.updatedAt,
    repoAccountId: repositories.accountId,
    ownerSlug: accounts.slug,
  })
    .from(repoStars)
    .innerJoin(repositories, eq(repoStars.repoId, repositories.id))
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(
      eq(repoStars.accountId, profileUser.id),
      eq(repositories.visibility, 'public'),
    ))
    .orderBy(desc(repoStars.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  // Filter valid entries and batch star-check
  const validStars = starsData.filter((sd) => !!sd.ownerSlug);
  const starRepoIds = validStars.map((sd) => sd.repoId);

  // Viewing own stars page — all are starred; otherwise batch-check
  const starredSet = (currentUser && currentUser.id === profileUser.id)
    ? new Set(starRepoIds)
    : await batchStarCheck(c.env.DB, currentUser?.id, starRepoIds);

  const repos: (ProfileRepoResponse & { starred_at: string })[] = validStars.map((starData) => {
    return {
      owner_username: starData.ownerSlug!,
      name: starData.repoName,
      description: starData.repoDescription,
      visibility: starData.repoVisibility as 'public' | 'private',
      default_branch: starData.repoDefaultBranch,
      stars: starData.repoStars,
      forks: starData.repoForks,
      is_starred: starredSet.has(starData.repoId),
      updated_at: toIsoString(starData.repoUpdatedAt),
      starred_at: toIsoString(starData.starCreatedAt),
    };
  });

  return c.json({
    repos,
    total,
    has_more: offset + repos.length < total,
  });
})

.get('/:username/activity',
  zValidator('query', z.object({
    limit: z.string().optional(),
    before: z.string().optional(),
  })),
  async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }

  const blockFlags = await getBlockFlags(db, currentUser?.id, profileUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  const privacy = await getUserPrivacySettings(c.env.DB, profileUser.id);
  const isSelf = !!currentUser && currentUser.id === profileUser.id;
  if (privacy.activity_visibility === 'private' && !isSelf) {
    throw new AuthorizationError('Activity is private');
  }
  if (privacy.activity_visibility === 'followers' && !isSelf) {
    const following = await isFollowing(c.env.DB, currentUser?.id, profileUser.id);
    if (!following) {
      throw new AuthorizationError('Activity is visible to followers only');
    }
  }

  const { limit: limitRaw, before: beforeRaw } = c.req.valid('query');
  const limit = parseLimit(limitRaw, 20, 50);

  let before: string | null = null;
  if (beforeRaw) {
    const v = String(beforeRaw);
    if (!Number.isFinite(Date.parse(v))) {
      throw new BadRequestError('Invalid before');
    }
    before = v;
  }

  const result = await fetchProfileActivity(c.env.DB, {
    profileUserId: profileUser.id,
    profileUserEmail: profileUser.email,
    limit,
    before,
  });

  return c.json(result);
})

.get('/:username/followers',
  zValidator('query', followListQuerySchema),
  async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const { limit: limitRaw, offset: offsetRaw, sort: sortRaw, order: orderRaw } = c.req.valid('query');
  const sort = sortRaw || 'created';
  const order = orderRaw || (sort === 'username' ? 'asc' : 'desc');
  const limit = parseLimit(limitRaw, 20, 100);
  const offset = parseOffset(offsetRaw);
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }
  const blockFlags = await getBlockFlags(db, currentUser?.id, profileUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  const { users: followers, total, has_more } = await fetchFollowList(
    c.env.DB, db, profileUser.id, currentUser?.id, 'followers',
    { limit, offset, sort, order },
  );

  return c.json({ followers, total, has_more });
})

.get('/:username/following',
  zValidator('query', followListQuerySchema),
  async (c) => {
  const currentUser = c.get('user');
  const username = c.req.param('username');
  const { limit: limitRaw, offset: offsetRaw, sort: sortRaw, order: orderRaw } = c.req.valid('query');
  const sort = sortRaw || 'created';
  const order = orderRaw || (sort === 'username' ? 'asc' : 'desc');
  const limit = parseLimit(limitRaw, 20, 100);
  const offset = parseOffset(offsetRaw);
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }
  const blockFlags = await getBlockFlags(db, currentUser?.id, profileUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  const { users: following, total, has_more } = await fetchFollowList(
    c.env.DB, db, profileUser.id, currentUser?.id, 'following',
    { limit, offset, sort, order },
  );

  return c.json({ following, total, has_more });
})

.get('/:username/follow-requests',
  zValidator('query', z.object({
    limit: z.string().optional(),
    offset: z.string().optional(),
  })),
  async (c) => {
  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AuthenticationError();
  }

  const username = c.req.param('username');
  const { limit: limitRaw, offset: offsetRaw } = c.req.valid('query');
  const limit = parseLimit(limitRaw, 20, 100);
  const offset = parseOffset(offsetRaw);

  const db = getDb(c.env.DB);
  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }
  if (profileUser.id !== currentUser.id) {
    throw new AuthorizationError();
  }

  const totalResult = await db.select({ count: count() })
    .from(accountFollowRequests)
    .where(and(
      eq(accountFollowRequests.targetAccountId, currentUser.id),
      eq(accountFollowRequests.status, 'pending'),
    ))
    .get();
  const total = totalResult?.count ?? 0;

  // Join follow requests with requester accounts
  const rows = await db.select({
    id: accountFollowRequests.id,
    requesterAccountId: accountFollowRequests.requesterAccountId,
    targetAccountId: accountFollowRequests.targetAccountId,
    createdAt: accountFollowRequests.createdAt,
    requesterId: accounts.id,
    requesterSlug: accounts.slug,
    requesterName: accounts.name,
    requesterPicture: accounts.picture,
    requesterBio: accounts.bio,
  })
    .from(accountFollowRequests)
    .innerJoin(accounts, eq(accountFollowRequests.requesterAccountId, accounts.id))
    .where(and(
      eq(accountFollowRequests.targetAccountId, currentUser.id),
      eq(accountFollowRequests.status, 'pending'),
    ))
    .orderBy(desc(accountFollowRequests.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  // Batch follow-check for all requesters
  const validRows = rows.filter((r) => !!r.requesterSlug);
  const requesterIds = validRows.map((r) => r.requesterId);

  let followingSet = new Set<string>();
  if (requesterIds.length > 0) {
    const followRows = await db.select({ followingAccountId: accountFollows.followingAccountId })
      .from(accountFollows)
      .where(and(
        eq(accountFollows.followerAccountId, currentUser.id),
        inArray(accountFollows.followingAccountId, requesterIds),
      ))
      .all();
    followingSet = new Set(followRows.map((r) => r.followingAccountId));
  }

  const requests: FollowRequestResponse[] = validRows.map((row) => {
    return {
      id: row.id,
      requester: {
        username: row.requesterSlug!,
        name: row.requesterName,
        picture: row.requesterPicture,
        bio: row.requesterBio,
        is_following: followingSet.has(row.requesterId),
      },
      created_at: toIsoString(row.createdAt),
    };
  });

  return c.json({
    requests,
    total,
    has_more: offset + requests.length < total,
  });
})

.post('/:username/follow-requests/:id/accept', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AuthenticationError();
  }

  const username = c.req.param('username');
  const requestId = c.req.param('id');
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }
  if (profileUser.id !== currentUser.id) {
    throw new AuthorizationError();
  }

  const reqRow = await db.select({
    id: accountFollowRequests.id,
    requesterAccountId: accountFollowRequests.requesterAccountId,
    targetAccountId: accountFollowRequests.targetAccountId,
  })
    .from(accountFollowRequests)
    .where(and(
      eq(accountFollowRequests.id, requestId),
      eq(accountFollowRequests.targetAccountId, currentUser.id),
      eq(accountFollowRequests.status, 'pending'),
    ))
    .get();
  if (!reqRow) {
    throw new NotFoundError('Follow request');
  }

  try {
    await db.insert(accountFollows).values({
      followerAccountId: reqRow.requesterAccountId,
      followingAccountId: reqRow.targetAccountId,
      createdAt: now(),
    });
  } catch {
    // ignore (already following)
  }

  await db.update(accountFollowRequests)
    .set({ status: 'accepted', respondedAt: now(), updatedAt: now() })
    .where(eq(accountFollowRequests.id, reqRow.id));

  const requesterMutedTarget = await isMutedBy(c.env.DB, reqRow.requesterAccountId, currentUser.id);
  if (!requesterMutedTarget) {
    await createNotification(c.env, {
      userId: reqRow.requesterAccountId,
      type: 'social.follow.accepted',
      title: 'Follow request accepted',
      body: `${currentUser.username} accepted your follow request`,
      data: {
        target_username: currentUser.username,
        target_name: currentUser.name,
        target_picture: currentUser.picture,
      },
    });
  }

  const stats = await getUserStats(c.env.DB, currentUser.id);
  return c.json({ success: true, followers_count: stats.followers_count });
})

.post('/:username/follow-requests/:id/reject', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AuthenticationError();
  }

  const username = c.req.param('username');
  const requestId = c.req.param('id');
  const db = getDb(c.env.DB);

  const profileUser = await getUserByUsername(c.env.DB, username);
  if (!profileUser) {
    throw new NotFoundError('User');
  }
  if (profileUser.id !== currentUser.id) {
    throw new AuthorizationError();
  }

  const reqRow = await db.select({ id: accountFollowRequests.id })
    .from(accountFollowRequests)
    .where(and(
      eq(accountFollowRequests.id, requestId),
      eq(accountFollowRequests.targetAccountId, currentUser.id),
      eq(accountFollowRequests.status, 'pending'),
    ))
    .get();
  if (!reqRow) {
    throw new NotFoundError('Follow request');
  }

  await db.update(accountFollowRequests)
    .set({ status: 'rejected', respondedAt: now(), updatedAt: now() })
    .where(eq(accountFollowRequests.id, reqRow.id));

  return c.json({ success: true });
})

.post('/:username/block', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AuthenticationError();
  }

  const username = c.req.param('username');
  const db = getDb(c.env.DB);
  const targetUser = await getUserByUsername(c.env.DB, username);
  if (!targetUser) {
    throw new NotFoundError('User');
  }
  if (targetUser.id === currentUser.id) {
    throw new BadRequestError('Cannot block yourself');
  }

  try {
    await db.insert(accountBlocks).values({
      blockerAccountId: currentUser.id,
      blockedAccountId: targetUser.id,
      createdAt: now(),
    });
  } catch {
    // already blocked
  }

  await db.delete(accountFollows).where(
    or(
      and(eq(accountFollows.followerAccountId, currentUser.id), eq(accountFollows.followingAccountId, targetUser.id)),
      and(eq(accountFollows.followerAccountId, targetUser.id), eq(accountFollows.followingAccountId, currentUser.id)),
    )
  );
  await db.delete(accountFollowRequests).where(
    or(
      and(eq(accountFollowRequests.requesterAccountId, currentUser.id), eq(accountFollowRequests.targetAccountId, targetUser.id)),
      and(eq(accountFollowRequests.requesterAccountId, targetUser.id), eq(accountFollowRequests.targetAccountId, currentUser.id)),
    )
  );

  return c.json({ success: true, blocked: true });
})

.delete('/:username/block', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AuthenticationError();
  }

  const username = c.req.param('username');
  const db = getDb(c.env.DB);
  const targetUser = await getUserByUsername(c.env.DB, username);
  if (!targetUser) {
    throw new NotFoundError('User');
  }

  await db.delete(accountBlocks).where(
    and(
      eq(accountBlocks.blockerAccountId, currentUser.id),
      eq(accountBlocks.blockedAccountId, targetUser.id),
    )
  );

  return c.json({ success: true, blocked: false });
})

.post('/:username/mute', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AuthenticationError();
  }

  const username = c.req.param('username');
  const db = getDb(c.env.DB);
  const targetUser = await getUserByUsername(c.env.DB, username);
  if (!targetUser) {
    throw new NotFoundError('User');
  }
  if (targetUser.id === currentUser.id) {
    throw new BadRequestError('Cannot mute yourself');
  }

  try {
    await db.insert(accountMutes).values({
      muterAccountId: currentUser.id,
      mutedAccountId: targetUser.id,
      createdAt: now(),
    });
  } catch {
    // Unique constraint violation means user is already muted -- safe to ignore
  }

  return c.json({ success: true, muted: true });
})

.delete('/:username/mute', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AuthenticationError();
  }

  const username = c.req.param('username');
  const db = getDb(c.env.DB);
  const targetUser = await getUserByUsername(c.env.DB, username);
  if (!targetUser) {
    throw new NotFoundError('User');
  }

  await db.delete(accountMutes).where(
    and(
      eq(accountMutes.muterAccountId, currentUser.id),
      eq(accountMutes.mutedAccountId, targetUser.id),
    )
  );

  return c.json({ success: true, muted: false });
})

.post('/:username/follow', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AuthenticationError();
  }

  const username = c.req.param('username');
  const db = getDb(c.env.DB);

  const targetUser = await getUserByUsername(c.env.DB, username);
  if (!targetUser) {
    throw new NotFoundError('User');
  }

  if (currentUser.id === targetUser.id) {
    throw new BadRequestError('Cannot follow yourself');
  }

  const blockFlags = await getBlockFlags(db, currentUser.id, targetUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }
  if (blockFlags.is_blocking) {
    throw new BadRequestError('Unblock this user to follow');
  }

  const existing = await db.select({ followerAccountId: accountFollows.followerAccountId })
    .from(accountFollows)
    .where(and(
      eq(accountFollows.followerAccountId, currentUser.id),
      eq(accountFollows.followingAccountId, targetUser.id),
    ))
    .get();

  if (existing) {
    throw new BadRequestError('Already following this user');
  }

  const actor = {
    id: currentUser.id,
    username: currentUser.username,
    name: currentUser.name,
    picture: currentUser.picture,
  };

  const privacy = await getUserPrivacySettings(c.env.DB, targetUser.id);
  if (privacy.private_account) {
    const existingReq = await db.select({ id: accountFollowRequests.id, status: accountFollowRequests.status })
      .from(accountFollowRequests)
      .where(and(
        eq(accountFollowRequests.requesterAccountId, currentUser.id),
        eq(accountFollowRequests.targetAccountId, targetUser.id),
      ))
      .get();

    if (existingReq?.status !== 'pending') {
      if (existingReq) {
        await db.update(accountFollowRequests)
          .set({ status: 'pending', respondedAt: null, updatedAt: now() })
          .where(eq(accountFollowRequests.id, existingReq.id));
      } else {
        await db.insert(accountFollowRequests).values({
          id: generateId(16),
          requesterAccountId: currentUser.id,
          targetAccountId: targetUser.id,
          status: 'pending',
          createdAt: now(),
          respondedAt: null,
          updatedAt: now(),
        });
      }

      await sendFollowNotificationIfNotMuted(
        c.env, c.env.DB, targetUser.id, actor, 'social.follow.requested',
      );
    }

    const stats = await getUserStats(c.env.DB, targetUser.id);
    return c.json({
      following: false,
      requested: true,
      followers_count: stats.followers_count,
    });
  }

  await db.insert(accountFollows).values({
    followerAccountId: currentUser.id,
    followingAccountId: targetUser.id,
    createdAt: now(),
  });

  await sendFollowNotificationIfNotMuted(
    c.env, c.env.DB, targetUser.id, actor, 'social.followed',
  );

  const stats = await getUserStats(c.env.DB, targetUser.id);
  return c.json({
    following: true,
    requested: false,
    followers_count: stats.followers_count,
  });
})

.delete('/:username/follow', async (c) => {
  const currentUser = c.get('user');
  if (!currentUser) {
    throw new AuthenticationError();
  }

  const username = c.req.param('username');
  const db = getDb(c.env.DB);

  const targetUser = await getUserByUsername(c.env.DB, username);
  if (!targetUser) {
    throw new NotFoundError('User');
  }

  const blockFlags = await getBlockFlags(db, currentUser.id, targetUser.id);
  if (blockFlags.blocked_by_target) {
    throw new NotFoundError('User');
  }

  const existing = await db.select({ followerAccountId: accountFollows.followerAccountId })
    .from(accountFollows)
    .where(and(
      eq(accountFollows.followerAccountId, currentUser.id),
      eq(accountFollows.followingAccountId, targetUser.id),
    ))
    .get();

  if (existing) {
    await db.delete(accountFollows).where(
      and(
        eq(accountFollows.followerAccountId, currentUser.id),
        eq(accountFollows.followingAccountId, targetUser.id),
      )
    );

    const stats = await getUserStats(c.env.DB, targetUser.id);
    return c.json({
      following: false,
      requested: false,
      followers_count: stats.followers_count,
    });
  }

  const pending = await db.select({ id: accountFollowRequests.id })
    .from(accountFollowRequests)
    .where(and(
      eq(accountFollowRequests.requesterAccountId, currentUser.id),
      eq(accountFollowRequests.targetAccountId, targetUser.id),
      eq(accountFollowRequests.status, 'pending'),
    ))
    .get();

  if (pending) {
    await db.update(accountFollowRequests)
      .set({ status: 'canceled', respondedAt: now(), updatedAt: now() })
      .where(eq(accountFollowRequests.id, pending.id));

    const stats = await getUserStats(c.env.DB, targetUser.id);
    return c.json({
      following: false,
      requested: false,
      followers_count: stats.followers_count,
    });
  }

  throw new BadRequestError('Not following this user');
});

export default profilesApi;
