/**
 * Provider linking — add another OAuth identity to an existing account.
 * Requires active session (user must be logged in).
 * Security: never auto-merge by email, only explicit link from authenticated session.
 */
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { getDb, accounts, authIdentities } from '../../../infra/db';
import { generateId } from '../../../shared/utils';
import { storeOAuthState, validateOAuthState } from '../../../application/services/identity/auth-utils';
import type { OptionalAuthRouteEnv } from '../shared/route-auth';
import { AuthenticationError } from '@takoserver/common/errors';

export const authLinkRouter = new Hono<OptionalAuthRouteEnv>();

// GET /auth/link/google — start linking Google identity (requires login)
authLinkRouter.get('/link/google', async (c) => {
  const user = c.get('user');
  if (!user) {
    throw new AuthenticationError('Login required');
  }

  const redirectUri = `https://${c.env.ADMIN_DOMAIN}/auth/link/google/callback`;
  // Store user ID in returnTo so we can retrieve it in callback
  const state = await storeOAuthState(c.env.DB, redirectUri, `link:${user.id}`);

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account', // Force account picker
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /auth/link/google/callback — handle Google callback for linking
authLinkRouter.get('/link/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state') || '';
  const error = c.req.query('error');

  if (error || !code) {
    return c.redirect('/?link_error=oauth_failed');
  }

  const stateResult = await validateOAuthState(c.env.DB, state);
  if (!stateResult.valid || !stateResult.returnTo?.startsWith('link:')) {
    return c.redirect('/?link_error=invalid_state');
  }

  const userId = stateResult.returnTo.replace('link:', '');

  // Verify user still exists
  const db = getDb(c.env.DB);
  const userExists = await db.select({ id: accounts.id })
    .from(accounts).where(eq(accounts.id, userId)).get();
  if (!userExists) {
    return c.redirect('/?link_error=user_not_found');
  }

  const redirectUri = `https://${c.env.ADMIN_DOMAIN}/auth/link/google/callback`;

  // Exchange code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    return c.redirect('/?link_error=token_exchange_failed');
  }

  const tokens = await tokenResponse.json() as { access_token: string };

  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    return c.redirect('/?link_error=userinfo_failed');
  }

  const googleUser = await userInfoResponse.json() as {
    id: string;
    email: string;
    name: string;
  };

  // Check if this Google identity is already linked to another user
  const existing = await db.select({ userId: authIdentities.userId })
    .from(authIdentities)
    .where(and(
      eq(authIdentities.provider, 'google'),
      eq(authIdentities.providerSub, googleUser.id),
    )).get();

  if (existing) {
    if (existing.userId === userId) {
      // Already linked to this user
      return c.redirect('/?link_result=already_linked');
    }
    // Linked to a different user — cannot steal
    return c.redirect('/?link_error=identity_taken');
  }

  // Determine email kind
  const emailKind = googleUser.email.endsWith('@gmail.com')
    ? 'google_authoritative'
    : 'google_non_authoritative';

  const timestamp = new Date().toISOString();

  // Link the identity
  await db.insert(authIdentities).values({
    id: generateId(),
    userId,
    provider: 'google',
    providerSub: googleUser.id,
    emailSnapshot: googleUser.email,
    emailKind,
    linkedAt: timestamp,
    lastLoginAt: timestamp,
  });

  return c.redirect('/?link_result=success');
});

// GET /api/auth/identities — list linked identities for current user
authLinkRouter.get('/api/auth/identities', async (c) => {
  const user = c.get('user');
  if (!user) {
    throw new AuthenticationError('Login required');
  }

  const db = getDb(c.env.DB);
  const identities = await db.select({
    id: authIdentities.id,
    provider: authIdentities.provider,
    emailSnapshot: authIdentities.emailSnapshot,
    emailKind: authIdentities.emailKind,
    linkedAt: authIdentities.linkedAt,
    lastLoginAt: authIdentities.lastLoginAt,
  }).from(authIdentities)
    .where(eq(authIdentities.userId, user.id))
    .all();

  return c.json({ identities });
});
