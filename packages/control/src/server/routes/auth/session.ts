import { Hono, type Context } from 'hono';
import { generateId, now } from '../../../shared/utils';
import {
  createSession,
  deleteSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionIdFromCookie,
} from '../../../application/services/identity/session';
import {
  storeOAuthState,
  validateOAuthState,
  auditLog,
  createAuthSession,
  cleanupUserSessions,
} from '../../../application/services/identity/auth-utils';
import type { OptionalAuthRouteEnv } from '../shared/route-auth';
import { sanitizeReturnTo, provisionGoogleOAuthUser } from './utils';
import { errorPage } from './html';
import { getDb } from '../../../infra/db';
import { accounts, authIdentities } from '../../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { logError } from '../../../shared/utils/logger';
import { getPlatformConfig, getPlatformSessionStore, getPlatformSqlBinding } from '../../../platform/accessors.ts';

export const authSessionRouter = new Hono<OptionalAuthRouteEnv>();

const startGoogleOAuth = async (c: Context<OptionalAuthRouteEnv>) => {
  const returnTo = sanitizeReturnTo(c.req.query('return_to'));
  const config = getPlatformConfig(c);
  const dbBinding = getPlatformSqlBinding(c);
  const redirectUri = `https://${config.adminDomain}/auth/callback`;

  if (!dbBinding || !config.googleClientId) {
    return c.html(errorPage('OAuth Error', 'Google OAuth is not configured.', '/', 'Back'), 500);
  }

  const state = await storeOAuthState(dbBinding, redirectUri, returnTo);

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};

// GET /auth/login - Start Google OAuth flow (internal)
authSessionRouter.get('/login', startGoogleOAuth);

type OAuthUser = {
  id: string;
  email: string | null;
  name: string;
  username: string;
  bio: string | null;
  picture: string | null;
  setup_completed: boolean;
  created_at: string;
  updated_at: string;
};

function userRowToOAuthUser(row: {
  id: string;
  email: string | null;
  name: string;
  slug: string;
  bio: string | null;
  picture: string | null;
  setupCompleted: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}): OAuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    username: row.slug,
    bio: row.bio,
    picture: row.picture,
    setup_completed: row.setupCompleted,
    created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

/**
 * Determine email_kind based on the Google user's email and hd claim.
 */
function determineEmailKind(email: string, hd?: string): string {
  if (hd || email.endsWith('@gmail.com')) {
    return 'google_authoritative';
  }
  return 'google_non_authoritative';
}

// GET /auth/callback - Handle Google OAuth callback
authSessionRouter.get('/callback', async (c) => {
  const config = getPlatformConfig(c);
  const dbBinding = getPlatformSqlBinding(c);
  const sessionStore = getPlatformSessionStore(c);
  const code = c.req.query('code');
  const state = c.req.query('state') || '';
  const error = c.req.query('error');

  if (error) {
    await auditLog('oauth_error', { error });
    return c.html(errorPage('OAuth Error', String(error), '/', 'Back'), 400);
  }

  if (!code) {
    return c.html(errorPage('OAuth Error', 'Missing OAuth code.', '/', 'Back'), 400);
  }

  if (!state) {
    await auditLog('oauth_missing_state', {});
    return c.html(errorPage('OAuth Error', 'Missing OAuth state.', '/', 'Back'), 400);
  }

  if (!dbBinding || !sessionStore || !config.googleClientId || !config.googleClientSecret) {
    return c.html(errorPage('OAuth Error', 'Google OAuth is not configured.', '/', 'Back'), 500);
  }

  const stateResult = await validateOAuthState(dbBinding, state);
  if (!stateResult.valid) {
    await auditLog('oauth_invalid_state', { state });
    return c.html(errorPage('OAuth Error', 'Invalid OAuth state.', '/', 'Back'), 400);
  }

  const returnTo = sanitizeReturnTo(stateResult.returnTo);
  const redirectUri = `https://${config.adminDomain}/auth/callback`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    logError('Token exchange failed', errorText, { module: 'routes/auth/session' });
    return c.html(errorPage('OAuth Error', 'Token exchange failed.', '/', 'Back'), 400);
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    id_token: string;
  };

  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    return c.html(errorPage('OAuth Error', 'Failed to fetch user info.', '/', 'Back'), 400);
  }

  const googleUser = (await userInfoResponse.json()) as {
    id: string;
    email: string;
    name: string;
    picture: string;
    verified_email: boolean;
    hd?: string;
  };

  const db = getDb(dbBinding);

  // Find user by auth_identity (provider='google', providerSub=googleUser.id)
  const identity = await db.select({
    userId: authIdentities.userId,
  }).from(authIdentities).where(
    and(eq(authIdentities.provider, 'google'), eq(authIdentities.providerSub, googleUser.id))
  ).get();

  let user: OAuthUser | null = null;

  if (identity) {
    // Existing identity found — login as that user
    const userRow = await db.select({
      id: accounts.id,
      email: accounts.email,
      name: accounts.name,
      slug: accounts.slug,
      bio: accounts.bio,
      picture: accounts.picture,
      setupCompleted: accounts.setupCompleted,
      createdAt: accounts.createdAt,
      updatedAt: accounts.updatedAt,
    }).from(accounts).where(eq(accounts.id, identity.userId)).get();

    if (userRow) {
      user = userRowToOAuthUser(userRow);
    }

    // Update lastLoginAt on identity
    await db.update(authIdentities).set({
      lastLoginAt: now(),
      emailSnapshot: googleUser.email,
    }).where(
      and(eq(authIdentities.provider, 'google'), eq(authIdentities.providerSub, googleUser.id))
    );
  } else {
    // No identity found — create new user + auth_identity
    // Do NOT search by email for existing users (key security change)
    const provisionedUser = await provisionGoogleOAuthUser(dbBinding, googleUser);
    user = provisionedUser;

    // Create auth_identity for the new user
    const emailKind = determineEmailKind(googleUser.email, googleUser.hd);
    const identityTimestamp = now();
    await db.insert(authIdentities).values({
      id: generateId(),
      userId: provisionedUser.id,
      provider: 'google',
      providerSub: googleUser.id,
      emailSnapshot: googleUser.email,
      emailKind,
      linkedAt: identityTimestamp,
      lastLoginAt: identityTimestamp,
    });
  }

  if (!user) {
    return c.html(errorPage('OAuth Error', 'Failed to resolve user account.', '/', 'Back'), 500);
  }

  const session = await createSession(sessionStore, user.id);
  const maxAge = 7 * 24 * 60 * 60;

  const userAgent = c.req.header('User-Agent');
  const ipAddress = c.req.header('CF-Connecting-IP');
  await createAuthSession(dbBinding, user.id, userAgent, ipAddress);
  await cleanupUserSessions(dbBinding, user.id, 5);

  await auditLog('oauth_success', { userId: user.id, email: user.email });

  const finalReturnTo = user.setup_completed ? returnTo : '/setup';

  return new Response(null, {
    status: 302,
    headers: {
      'Location': finalReturnTo,
      'Set-Cookie': setSessionCookie(session.id, maxAge),
    },
  });
});

// POST /auth/logout
authSessionRouter.post('/logout', async (c) => {
  const sessionStore = getPlatformSessionStore(c);
  const sessionId = getSessionIdFromCookie(c.req.header('Cookie'));
  if (sessionId && sessionStore) {
    await deleteSession(sessionStore, sessionId);
  }

  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/',
      'Set-Cookie': clearSessionCookie(),
    },
  });
});
