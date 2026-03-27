import { Hono } from 'hono';
import { z } from 'zod';
import { generateId, now, toIsoString } from '../../../shared/utils';
import { createNotification } from '../../../application/services/notifications/service';
import { parseLimit, parseOffset, type OptionalAuthRouteEnv } from '../shared/route-auth';
import { zValidator } from '../zod-validator';
import { NotFoundError, AuthenticationError, AuthorizationError, BadRequestError } from '@takos/common/errors';
import { getUserByUsername, getUserPrivacySettings, getUserStats, isMutedBy } from './shared';
import { getDb } from '../../../infra/db';
import { accountFollows, accountFollowRequests, accounts } from '../../../infra/db/schema';
import { eq, and, desc, count, inArray } from 'drizzle-orm';
import { getBlockFlags, fetchFollowList, sendFollowNotificationIfNotMuted } from './helpers';
import type { FollowUserResponse, FollowRequestResponse } from './types';

const followListQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
  sort: z.string().optional(),
  order: z.string().optional(),
});

export const followRoutes = new Hono<OptionalAuthRouteEnv>()

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
