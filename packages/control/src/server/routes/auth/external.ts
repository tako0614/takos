import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { createSession, getSession, getSessionIdFromCookie, setSessionCookie } from '../../../application/services/identity/session';
import {
  storeOAuthState,
  validateOAuthState,
  auditLog,
  createAuthSession,
  cleanupUserSessions,
  isValidRedirectUri,
} from '../../../application/services/identity/auth-utils';
import { getDb, accounts, authIdentities } from '../../../infra/db';
import type { OptionalAuthRouteEnv } from '../route-auth';
import { errorPage, externalLoginPage, externalTokenPostRedirectPage } from './html';
import { BadRequestError, AuthorizationError } from 'takos-common/errors';
import { getPlatformConfig, getPlatformSessionStore, getPlatformSqlBinding } from '../../../platform/accessors.ts';

function normalizeServiceName(value: string | null | undefined): string {
  if (!value) return 'サービス';
  const trimmed = value.trim();
  if (!trimmed) return 'サービス';
  return trimmed.slice(0, 64);
}

function resolveAuthPublicBaseUrl(adminDomain: string, configuredBaseUrl?: string): string {
  if (configuredBaseUrl) {
    try {
      return new URL(configuredBaseUrl).toString();
    } catch {
      // Invalid operator config is ignored to keep auth endpoints available.
    }
  }
  return `https://${adminDomain}`;
}

function resolveAuthPublicHost(baseUrl: string, fallbackHost: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    // Malformed base URL -- fall back to provided host
    return fallbackHost;
  }
}

function redirectFallbackDomains(adminDomain: string): readonly string[] {
  return [adminDomain, 'localhost', '127.0.0.1'];
}

function getOptionalEnvBinding(env: unknown, key: string): string | undefined {
  const value = (env as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function generateNonce() {
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  return btoa(String.fromCharCode(...nonceBytes));
}

export const externalAuthRouter = new Hono<OptionalAuthRouteEnv>();

// GET /auth/external/session - Check if user is logged in (for JS-based session check)
// Called from the externalLoginPage inline script (same-origin fetch).
// Creates a short-lived auth session token for external service handoff.
externalAuthRouter.get('/external/session', async (c) => {
  // Verify request originates from our own pages (defense against cross-origin session token theft)
  const origin = c.req.header('Origin');
  const platformConfig = getPlatformConfig(c);
  const dbBinding = getPlatformSqlBinding(c);
  const sessionStore = getPlatformSessionStore(c);
  const expectedOrigin = `https://${platformConfig.adminDomain}`;
  if (origin && origin !== expectedOrigin) {
    throw new AuthorizationError();
  }

  const cookieHeader = c.req.header('Cookie');
  const sessionId = getSessionIdFromCookie(cookieHeader);

  if (!sessionId) {
    return c.json({ logged_in: false });
  }

  if (!dbBinding || !sessionStore) {
    return c.json({ logged_in: false });
  }

  const session = await getSession(sessionStore, sessionId);

  if (!session?.user_id) {
    return c.json({ logged_in: false });
  }

  const userAgent = c.req.header('User-Agent') || undefined;
  const ipAddress = c.req.header('CF-Connecting-IP') || undefined;
  const authSession = await createAuthSession(dbBinding, session.user_id, userAgent, ipAddress);
  await cleanupUserSessions(dbBinding, session.user_id, 5);

  c.header('Cache-Control', 'no-store');
  return c.json({ logged_in: true, token: authSession.token });
});

// GET /auth/external - External service login page
externalAuthRouter.get('/external', async (c) => {
  const redirectUri = c.req.query('redirect_uri');
  const serviceName = normalizeServiceName(c.req.query('service'));
  const platformConfig = getPlatformConfig(c);
  const dbBinding = getPlatformSqlBinding(c);
  const configuredAllowedDomains = getOptionalEnvBinding(c.env, 'AUTH_ALLOWED_REDIRECT_DOMAINS');

  if (!redirectUri) {
    return c.html(errorPage('エラー', 'redirect_uri が指定されていません'), 400);
  }

  if (!isValidRedirectUri(
    redirectUri,
    configuredAllowedDomains,
    redirectFallbackDomains(platformConfig.adminDomain)
  )) {
    await auditLog('external_auth_invalid_redirect', { redirect_uri: redirectUri });
    return c.html(errorPage('エラー', '許可されていないリダイレクト先です'), 400);
  }

  if (!dbBinding) {
    return c.html(errorPage('エラー', '認証サービスを利用できません'), 500);
  }

  const oauthState = await storeOAuthState(
    dbBinding,
    redirectUri,
    undefined,
    undefined
  );

  const googleOAuthUrl = `https://${platformConfig.adminDomain}/auth/external/google?state=${oauthState}`;
  const encodedRedirectUri = encodeURIComponent(redirectUri);

  const nonce = generateNonce();
  const redirectOrigin = new URL(redirectUri).origin;
  const authPublicBaseUrl = resolveAuthPublicBaseUrl(
    platformConfig.adminDomain,
    getOptionalEnvBinding(c.env, 'AUTH_PUBLIC_BASE_URL')
  );

  const html = externalLoginPage({
    serviceName,
    googleOAuthUrl,
    encodedRedirectUri,
    nonce,
    homeUrl: authPublicBaseUrl,
    homeLabel: resolveAuthPublicHost(authPublicBaseUrl, platformConfig.adminDomain),
  });

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://static.cloudflareinsights.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://accounts.google.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    `form-action 'self' https://${platformConfig.adminDomain} ${redirectOrigin}`,
    "object-src 'none'",
  ].join('; ');

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
    },
  });
});

// GET /auth/external/google - Start Google OAuth for external services
externalAuthRouter.get('/external/google', async (c) => {
  const platformConfig = getPlatformConfig(c);
  const dbBinding = getPlatformSqlBinding(c);
  const state = c.req.query('state');
  if (!state) {
    throw new BadRequestError('Missing state');
  }

  if (!dbBinding || !platformConfig.googleClientId) {
    throw new BadRequestError('External auth is not configured');
  }

  const stateResult = await validateOAuthState(dbBinding, state);
  if (!stateResult.valid) {
    throw new BadRequestError('Invalid state');
  }

  const newState = await storeOAuthState(
    dbBinding,
    stateResult.redirectUri!,
    undefined,
    undefined
  );

  const redirectUri = `https://${platformConfig.adminDomain}/auth/external/callback`;
  const params = new URLSearchParams({
    client_id: platformConfig.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: newState,
    access_type: 'offline',
    prompt: 'consent',
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /auth/external/callback - Handle Google OAuth callback for external services
externalAuthRouter.get('/external/callback', async (c) => {
  const platformConfig = getPlatformConfig(c);
  const dbBinding = getPlatformSqlBinding(c);
  const sessionStore = getPlatformSessionStore(c);
  const code = c.req.query('code');
  const state = c.req.query('state') || '';
  const error = c.req.query('error');

  if (error) {
    await auditLog('external_oauth_error', { error });
    return c.html(errorPage('認証エラー', '外部認証プロバイダーでエラーが発生しました'), 400);
  }

  if (!code || !state) {
    return c.html(errorPage('認証エラー', '認証コードが取得できませんでした'), 400);
  }

  if (!dbBinding || !sessionStore || !platformConfig.googleClientId || !platformConfig.googleClientSecret) {
    return c.html(errorPage('認証エラー', '外部認証が設定されていません'), 500);
  }

  const stateResult = await validateOAuthState(dbBinding, state);
  if (!stateResult.valid || !stateResult.redirectUri) {
    await auditLog('external_oauth_invalid_state', { state });
    return c.html(errorPage('認証エラー', '無効なセッションです'), 400);
  }

  const externalRedirectUri = stateResult.redirectUri;
  const configuredAllowedDomains = getOptionalEnvBinding(c.env, 'AUTH_ALLOWED_REDIRECT_DOMAINS');
  if (!isValidRedirectUri(
    externalRedirectUri,
    configuredAllowedDomains,
    redirectFallbackDomains(platformConfig.adminDomain)
  )) {
    await auditLog('external_oauth_invalid_redirect_after_state', { redirect_uri: externalRedirectUri });
    return c.html(errorPage('認証エラー', '無効なリダイレクト先です'), 400);
  }
  const redirectUri = `https://${platformConfig.adminDomain}/auth/external/callback`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: platformConfig.googleClientId,
      client_secret: platformConfig.googleClientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    await auditLog('external_oauth_token_error', {});
    return c.html(errorPage('認証エラー', 'トークンの取得に失敗しました'), 400);
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
    return c.html(errorPage('認証エラー', 'ユーザー情報の取得に失敗しました'), 400);
  }

  const googleUser = (await userInfoResponse.json()) as {
    id: string;
    email: string;
    name: string;
    picture: string;
    verified_email: boolean;
  };

  const db = getDb(dbBinding);

  // Look up user by auth_identity (provider='google', providerSub=googleUser.id)
  const identity = await db.select({
    userId: authIdentities.userId,
  }).from(authIdentities).where(and(
    eq(authIdentities.provider, 'google'),
    eq(authIdentities.providerSub, googleUser.id),
  )).get();

  let user: { id: string } | undefined;

  if (identity) {
    user = await db.select({
      id: accounts.id,
    }).from(accounts).where(eq(accounts.id, identity.userId)).get();
  }

  if (!user) {
    const authPublicBaseUrl = resolveAuthPublicBaseUrl(
      platformConfig.adminDomain,
      getOptionalEnvBinding(c.env, 'AUTH_PUBLIC_BASE_URL')
    );
    const authPublicHost = resolveAuthPublicHost(authPublicBaseUrl, platformConfig.adminDomain);
    return c.html(errorPage(
      'アカウントが見つかりません',
      `takos アカウントが登録されていません。<br>先に ${authPublicHost} でアカウントを作成してください。`,
      new URL('/auth/login', authPublicBaseUrl).toString(),
      `${authPublicHost} でアカウント作成`
    ), 403);
  }

  const userAgent = c.req.header('User-Agent');
  const ipAddress = c.req.header('CF-Connecting-IP');
  const authSession = await createAuthSession(dbBinding, user.id, userAgent, ipAddress || undefined);
  await cleanupUserSessions(dbBinding, user.id, 5);

  const doSession = await createSession(sessionStore, user.id);
  const maxAge = 7 * 24 * 60 * 60;

  await auditLog('external_oauth_success', { userId: user.id, redirectUri: externalRedirectUri });

  const nonce = generateNonce();
  const redirectOrigin = new URL(externalRedirectUri).origin;
  const html = externalTokenPostRedirectPage({
    redirectUri: externalRedirectUri,
    token: authSession.token,
    nonce,
  });

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    `form-action ${redirectOrigin}`,
    "object-src 'none'",
  ].join('; ');

  return new Response(html, {
    status: 200,
    headers: {
      'Set-Cookie': setSessionCookie(doSession.id, maxAge),
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Cache-Control': 'no-store',
    },
  });
});
