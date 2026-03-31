import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Env } from '../../../shared/types/index.ts';
import type { PublicRouteEnv } from '../route-auth.ts';
import { oauthBodyLimit } from '../../middleware/body-size.ts';
import oauthAuthorize from './authorize.ts';
import oauthDevice from './device.ts';
import oauthIntrospect from './introspect.ts';
import oauthRegister from './register.ts';
import oauthRevoke from './revoke.ts';
import oauthToken from './token.ts';
import oauthUserinfo from './userinfo.ts';
import {
  storeOAuthState,
  validateOAuthState,
  isValidRedirectUri,
  auditLog,
  createAuthSession,
  cleanupUserSessions,
} from '../../../application/services/identity/auth-utils.ts';
import { getDb, accounts, authIdentities } from '../../../infra/db/index.ts';
import { externalTokenPostRedirectPage } from '../auth/html.ts';
import { logError } from '../../../shared/utils/logger.ts';
import { BadRequestError, AuthorizationError } from 'takos-common/errors';

const oauth = new Hono<PublicRouteEnv>();

function generateNonce(): string {
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  return btoa(String.fromCharCode(...nonceBytes));
}

function redirectFallbackDomains(adminDomain: string): readonly string[] {
  return [adminDomain, 'localhost', '127.0.0.1'];
}

function getOptionalEnvBinding(env: Env, key: string): string | undefined {
  // Some operator-configured bindings (e.g. AUTH_ALLOWED_REDIRECT_DOMAINS)
  // are not declared in the Env interface because they are optional and
  // deployment-specific. Access them via index signature.
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

// Apply body size limit for all OAuth endpoints (64KB)
// OAuth requests are typically small (auth codes, tokens, client registrations)
oauth.use('*', oauthBodyLimit);

// ============================================================
// Google OAuth for external services
// ============================================================

// GET /oauth/google - Start Google OAuth for external services
oauth.get('/google', async (c) => {
  const env = c.env;
  const configuredAllowedDomains = getOptionalEnvBinding(c.env, 'AUTH_ALLOWED_REDIRECT_DOMAINS');
  const callerState = c.req.query('state') || '';
  let externalRedirectUri: string | undefined;

  if (callerState) {
    try {
      const raw = JSON.parse(atob(callerState));
      if (typeof raw !== 'object' || raw === null) {
        // Not an object, ignore
      } else {
        const stateData = raw as Record<string, unknown>;
        const redirectUri = typeof stateData.redirect_uri === 'string' ? stateData.redirect_uri : undefined;
        if (redirectUri && isValidRedirectUri(
          redirectUri,
          configuredAllowedDomains,
          redirectFallbackDomains(env.ADMIN_DOMAIN)
        )) {
          externalRedirectUri = redirectUri;
        } else if (redirectUri) {
          await auditLog('oauth_invalid_redirect', { attempted_uri: redirectUri });
          throw new BadRequestError('Invalid redirect_uri');
        }
      }
    } catch {
      // Invalid state format (bad base64 or invalid JSON), ignore
    }
  }

  const redirectUri = `https://${env.ADMIN_DOMAIN}/oauth/google/callback`;

  // Store OAuth state with external redirect info
  const state = await storeOAuthState(
    env.DB,
    externalRedirectUri || `https://${env.ADMIN_DOMAIN}`,
    undefined,
    undefined
  );

  // Build Google OAuth URL
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /oauth/google/callback - Handle Google OAuth callback for external services
oauth.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state') || '';
  const error = c.req.query('error');
  const env = c.env;

  if (error) {
    await auditLog('oauth_error', { error });
    return c.json({ error: 'access_denied', error_description: error }, 400);
  }

  if (!code || !state) {
    throw new BadRequestError('Missing code or state');
  }

  const stateResult = await validateOAuthState(env.DB, state);
  if (!stateResult.valid || !stateResult.redirectUri) {
    await auditLog('oauth_invalid_state', { state });
    throw new BadRequestError('Invalid or expired OAuth state');
  }

  const externalRedirectUri = stateResult.redirectUri;
  const redirectUri = `https://${env.ADMIN_DOMAIN}/oauth/google/callback`;

  // Exchange code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    logError('Token exchange failed', await tokenResponse.text(), { module: 'routes/oauth' });
    throw new BadRequestError('Token exchange failed');
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  // Get user info from Google
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    throw new BadRequestError('Failed to get user info');
  }

  const googleUser = (await userInfoResponse.json()) as {
    id: string;
    email: string;
    name: string;
    picture: string;
    verified_email: boolean;
  };

  // Find user by auth_identity (provider='google', providerSub=googleUser.id)
  const db = getDb(env.DB);
  const identity = await db.select({
    userId: authIdentities.userId,
  }).from(authIdentities).where(and(
    eq(authIdentities.provider, 'google'),
    eq(authIdentities.providerSub, googleUser.id),
  )).get();

  if (!identity) {
    // Registration disabled for external OAuth
    throw new AuthorizationError('User not registered');
  }

  const user = await db.select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, identity.userId))
    .get();

  if (!user) {
    throw new AuthorizationError('User not registered');
  }

  // Create D1-based auth session (for service API validation)
  const userAgent = c.req.header('User-Agent');
  const ipAddress = c.req.header('CF-Connecting-IP');
  const session = await createAuthSession(env.DB, user.id, userAgent, ipAddress);
  await cleanupUserSessions(env.DB, user.id, 5);

  await auditLog('oauth_external_success', { userId: user.id });

  // Redirect to external service with token
  if (!isValidRedirectUri(
    externalRedirectUri,
    getOptionalEnvBinding(c.env, 'AUTH_ALLOWED_REDIRECT_DOMAINS'),
    redirectFallbackDomains(env.ADMIN_DOMAIN)
  )) {
    await auditLog('oauth_invalid_redirect_after_state', { redirect_uri: externalRedirectUri });
    throw new BadRequestError('Invalid redirect_uri');
  }

  const nonce = generateNonce();
  const html = externalTokenPostRedirectPage({
    redirectUri: externalRedirectUri,
    token: session.token,
    nonce,
  });
  const redirectOrigin = new URL(externalRedirectUri).origin;
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
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': csp,
      'Cache-Control': 'no-store',
    },
  });
});

// OAuth2 Authorization Server routes
oauth.route('/', oauthAuthorize);
oauth.route('/', oauthDevice);
oauth.route('/', oauthToken);
oauth.route('/', oauthRevoke);
oauth.route('/', oauthIntrospect);
oauth.route('/', oauthRegister);
oauth.route('/', oauthUserinfo);

export default oauth;
