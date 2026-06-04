/**
 * Auth API Routes for takos-control
 *
 * App-local profile management endpoints. Browser login is handled by the
 * Takosumi Accounts OIDC consumer route.
 */

import { Hono } from "hono";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
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
  ConflictError,
} from "@takos/worker-platform-utils/errors";
import { zValidator } from "./zod-validator.ts";

type Variables = {
  user?: User;
};

const authApi = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const setupUsernameSchema = z.object({
  username: z.string(),
});

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

// ============================================================
// Profile Setup Routes
// ============================================================

// POST /api/auth/setup-username - Set username (requires auth)
//
// SECURITY: No per-route rate limit. This endpoint sits on the signup-adjacent
// onboarding path and is reachable by any authenticated session. Without an
// operator-tier limiter (CDN / WAF), it can be abused to enumerate / squat
// usernames via repeated availability probes. See SECURITY.md.
authApi.post(
  "/setup-username",
  zValidator("json", setupUsernameSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      throw new AuthenticationError();
    }

    const body = c.req.valid("json");

    if (!body.username) {
      throw new BadRequestError("Username is required");
    }

    // Validate username format (3-30 chars, lowercase alphanumeric, underscores or hyphens)
    if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(body.username)) {
      throw new BadRequestError(
        "Username must be 3-30 characters, lowercase alphanumeric, underscores or hyphens",
      );
    }

    // Check if username is taken
    const db = getDb(c.env.DB);
    const existing = await db.select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.slug, body.username), ne(accounts.id, user.id)))
      .get();

    if (existing) {
      throw new ConflictError("Username already taken");
    }

    await db.update(accounts).set({
      slug: body.username,
      updatedAt: new Date().toISOString(),
    }).where(eq(accounts.id, user.id)).run();

    return c.json({ success: true, username: body.username });
  },
);

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
