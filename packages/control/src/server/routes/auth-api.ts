/**
 * Auth API Routes for takos-control
 *
 * Profile management endpoints.
 * Google OAuth is the sole authentication method.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, ne } from 'drizzle-orm';
import type { Env, User } from '../../shared/types';
import { getDb, accounts, authIdentities } from '../../infra/db';
import {
  deleteAuthSession,
  auditLog,
  isValidAvatarUrl,
} from '../../application/services/identity/auth-utils';
import { now, extractBearerToken } from '../../shared/utils';
import { badRequest, unauthorized, conflict } from './shared/route-auth';
import { zValidator } from './zod-validator';

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
authApi.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) {
    return unauthorized(c);
  }

  // Get linked auth identities
  const db = getDb(c.env.DB);
  const identities = await db.select({
    provider: authIdentities.provider,
    emailSnapshot: authIdentities.emailSnapshot,
  }).from(authIdentities).where(eq(authIdentities.userId, user.id)).all();

  return c.json({
    user: {
      email: user.email,
      username: user.username,
      display_name: user.name,
      avatar_url: user.picture,
      auth_identities: identities.map((i) => ({
        provider: i.provider,
        email: i.emailSnapshot,
      })),
    },
  });
});

// ============================================================
// Profile Setup Routes
// ============================================================

// POST /api/auth/setup-username - Set username (requires auth)
authApi.post('/setup-username',
  zValidator('json', setupUsernameSchema),
  async (c) => {
  const user = c.get('user');
  if (!user) {
    return unauthorized(c);
  }

  const body = c.req.valid('json');

  if (!body.username) {
    return badRequest(c, 'Username is required');
  }

  // Validate username format (3-30 chars, lowercase alphanumeric, underscores or hyphens)
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(body.username)) {
    return badRequest(c, 'Username must be 3-30 characters, lowercase alphanumeric, underscores or hyphens');
  }

  // Check if username is taken
  const db = getDb(c.env.DB);
  const existing = await db.select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.slug, body.username), ne(accounts.id, user.id)))
    .get();

  if (existing) {
    return conflict(c, 'Username already taken');
  }

  await db.update(accounts).set({
    slug: body.username,
    updatedAt: now(),
  }).where(eq(accounts.id, user.id)).run();

  return c.json({ success: true, username: body.username });
});

// PATCH /api/auth/profile - Update profile (requires auth)
authApi.patch('/profile',
  zValidator('json', profileSchema),
  async (c) => {
  const user = c.get('user');
  if (!user) {
    return unauthorized(c);
  }

  const body = c.req.valid('json');

  const updateData: Record<string, string | null> = {};

  if (body.display_name !== undefined) {
    updateData.name = body.display_name;
  }
  if (body.avatar_url !== undefined) {
    if (body.avatar_url && !isValidAvatarUrl(body.avatar_url)) {
      return badRequest(c, 'Invalid avatar URL. Must be a valid HTTPS URL.');
    }
    updateData.picture = body.avatar_url;
  }

  if (Object.keys(updateData).length === 0) {
    return badRequest(c, 'No updates provided');
  }

  updateData.updatedAt = now();

  const db = getDb(c.env.DB);
  await db.update(accounts).set(updateData).where(eq(accounts.id, user.id)).run();

  return c.json({ success: true });
});

// POST /api/auth/logout - Logout (invalidate D1 session)
authApi.post('/logout', async (c) => {
  const token = extractBearerToken(c.req.header('Authorization'));
  if (token) {
    await deleteAuthSession(c.env.DB, token);
  }
  return c.json({ success: true });
});

export default authApi;
