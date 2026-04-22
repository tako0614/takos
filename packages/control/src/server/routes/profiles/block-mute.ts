import { Hono } from "hono";

import type { OptionalAuthRouteEnv } from "../route-auth.ts";
import {
  AuthenticationError,
  BadRequestError,
  NotFoundError,
} from "takos-common/errors";
import { getUserByUsername } from "./profile-queries.ts";
import { getDb } from "../../../infra/db/index.ts";
import {
  accountBlocks,
  accountFollowRequests,
  accountFollows,
  accountMutes,
} from "../../../infra/db/schema.ts";
import { and, eq, or } from "drizzle-orm";

export const blockMuteRoutes = new Hono<OptionalAuthRouteEnv>()
  .post("/:username/block", async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
      throw new AuthenticationError();
    }

    const username = c.req.param("username");
    const db = getDb(c.env.DB);
    const targetUser = await getUserByUsername(c.env.DB, username);
    if (!targetUser) {
      throw new NotFoundError("User");
    }
    if (targetUser.id === currentUser.id) {
      throw new BadRequestError("Cannot block yourself");
    }

    try {
      await db.insert(accountBlocks).values({
        blockerAccountId: currentUser.id,
        blockedAccountId: targetUser.id,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // already blocked
    }

    await db.delete(accountFollows).where(
      or(
        and(
          eq(accountFollows.followerAccountId, currentUser.id),
          eq(accountFollows.followingAccountId, targetUser.id),
        ),
        and(
          eq(accountFollows.followerAccountId, targetUser.id),
          eq(accountFollows.followingAccountId, currentUser.id),
        ),
      ),
    );
    await db.delete(accountFollowRequests).where(
      or(
        and(
          eq(accountFollowRequests.requesterAccountId, currentUser.id),
          eq(accountFollowRequests.targetAccountId, targetUser.id),
        ),
        and(
          eq(accountFollowRequests.requesterAccountId, targetUser.id),
          eq(accountFollowRequests.targetAccountId, currentUser.id),
        ),
      ),
    );

    return c.json({ success: true, blocked: true });
  })
  .delete("/:username/block", async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
      throw new AuthenticationError();
    }

    const username = c.req.param("username");
    const db = getDb(c.env.DB);
    const targetUser = await getUserByUsername(c.env.DB, username);
    if (!targetUser) {
      throw new NotFoundError("User");
    }

    await db.delete(accountBlocks).where(
      and(
        eq(accountBlocks.blockerAccountId, currentUser.id),
        eq(accountBlocks.blockedAccountId, targetUser.id),
      ),
    );

    return c.json({ success: true, blocked: false });
  })
  .post("/:username/mute", async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
      throw new AuthenticationError();
    }

    const username = c.req.param("username");
    const db = getDb(c.env.DB);
    const targetUser = await getUserByUsername(c.env.DB, username);
    if (!targetUser) {
      throw new NotFoundError("User");
    }
    if (targetUser.id === currentUser.id) {
      throw new BadRequestError("Cannot mute yourself");
    }

    try {
      await db.insert(accountMutes).values({
        muterAccountId: currentUser.id,
        mutedAccountId: targetUser.id,
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Unique constraint violation means user is already muted -- safe to ignore
    }

    return c.json({ success: true, muted: true });
  })
  .delete("/:username/mute", async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
      throw new AuthenticationError();
    }

    const username = c.req.param("username");
    const db = getDb(c.env.DB);
    const targetUser = await getUserByUsername(c.env.DB, username);
    if (!targetUser) {
      throw new NotFoundError("User");
    }

    await db.delete(accountMutes).where(
      and(
        eq(accountMutes.muterAccountId, currentUser.id),
        eq(accountMutes.mutedAccountId, targetUser.id),
      ),
    );

    return c.json({ success: true, muted: false });
  });
