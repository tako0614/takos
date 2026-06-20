/**
 * Auth API Routes for takos-control
 *
 * App-local profile management endpoints. Browser login is handled by the
 * Takosumi Accounts OIDC consumer route.
 */

import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Env, User } from "../../shared/types/index.ts";
import { accounts, authIdentities, getDb } from "../../infra/db/index.ts";
import {
  deleteAuthSession,
  isValidAvatarUrl,
} from "../../application/services/identity/auth-utils.ts";
import {
  clearSessionCookie,
  deleteSession,
  getSessionIdFromCookie,
} from "../../application/services/identity/session.ts";
import { extractBearerToken } from "../middleware/bearer-token-classification.ts";
import { getPlatformServices } from "../../platform/accessors.ts";

import {
  AuthenticationError,
  BadRequestError,
} from "@takos/worker-platform-utils/errors";
import { zValidator } from "./zod-validator.ts";

type Variables = {
  user?: User;
};

const authApi = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  display_name: z.string().optional(),
  avatar_url: z.string().optional(),
});

// GET /api/auth/me - Get current user (requires auth middleware to set user)
authApi.get("/me", async (c) => {
  const user = c.get("user");
  if (!user) {
    throw new AuthenticationError();
  }

  // Get linked auth identities
  const db = getDb(c.env.DB);
  const identities = await db.select({
    source: authIdentities.provider,
    emailSnapshot: authIdentities.emailSnapshot,
  }).from(authIdentities).where(eq(authIdentities.userId, user.id)).all();

  return c.json({
    user: {
      email: user.email,
      username: user.username,
      display_name: user.name,
      avatar_url: user.picture,
      auth_identities: identities.map((i) => ({
        source: i.source,
        email: i.emailSnapshot,
      })),
    },
  });
});

// PATCH /api/auth/profile - Update profile (requires auth)
authApi.patch("/profile", zValidator("json", profileSchema), async (c) => {
  const user = c.get("user");
  if (!user) {
    throw new AuthenticationError();
  }

  const body = c.req.valid("json");

  const updateData: Record<string, string | null> = {};

  if (body.display_name !== undefined) {
    updateData.name = body.display_name;
  }
  if (body.avatar_url !== undefined) {
    if (body.avatar_url && !isValidAvatarUrl(body.avatar_url)) {
      throw new BadRequestError(
        "Invalid avatar URL. Must be a valid HTTPS URL.",
      );
    }
    updateData.picture = body.avatar_url;
  }

  if (Object.keys(updateData).length === 0) {
    throw new BadRequestError("No updates provided");
  }

  updateData.updatedAt = new Date().toISOString();

  const db = getDb(c.env.DB);
  await db.update(accounts).set(updateData).where(eq(accounts.id, user.id))
    .run();

  return c.json({ success: true });
});

// POST /api/auth/logout - Logout (invalidate SQL store session)
//
// SECURITY: This endpoint has no per-route rate limit and relies on the
// operator-tier limiter (CDN / WAF). Without one, a holder of a valid
// cookie can replay `POST /api/auth/logout` to spam session-store deletes.
// See SECURITY.md "Per-route rate limiting".
authApi.post("/logout", async (c) => {
  const user = c.get("user");
  if (!user) {
    throw new AuthenticationError();
  }

  const sessionStore = getPlatformServices(c).notifications.sessionStore;
  const sessionId = getSessionIdFromCookie(c.req.header("Cookie"));
  if (sessionId && sessionStore) {
    await deleteSession(sessionStore, sessionId);
  }

  const token = extractBearerToken(c.req.header("Authorization"));
  if (token) {
    await deleteAuthSession(c.env.DB, token);
  }
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ success: true });
});

export default authApi;
