import { Hono } from 'hono';
import type { Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import { createSession } from '../../../application/services/identity/session';
import { storeOAuthState, validateOAuthState } from '../../../application/services/identity/auth-utils';
import { getDb, accounts, authIdentities } from '../../../infra/db';
import type { OptionalAuthRouteEnv } from '../shared/route-auth';
import { validateCliCallbackUrl } from './provisioning';
import { escapeHtml, errorPage, warningPage } from './html';
import { BadRequestError } from 'takos-common/errors';
import { getPlatformConfig, getPlatformSessionStore, getPlatformSqlBinding } from '../../../platform/accessors.ts';

const CLI_STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const CLI_CALLBACK_STYLE = 'body{font-family:system-ui,sans-serif;padding:24px;}';
const CLI_CALLBACK_AUTOSUBMIT_SCRIPT = "document.getElementById('cli-callback-form')?.submit();";

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function hashSha256Base64(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toBase64(new Uint8Array(digest));
}

const cliCallbackCspPromise = Promise.all([
  hashSha256Base64(CLI_CALLBACK_AUTOSUBMIT_SCRIPT),
  hashSha256Base64(CLI_CALLBACK_STYLE),
]).then(([scriptHash, styleHash]) => (
  `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' http://127.0.0.1:* http://localhost:*; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'`
));


async function respondToCliWithPost(
  c: Pick<Context<OptionalAuthRouteEnv>, 'header' | 'html'>,
  cliCallback: string,
  params: Record<string, string>,
  cliState?: string
) {
  const fields: Record<string, string> = { ...params };
  if (cliState) {
    fields.state = cliState;
  }
  const hiddenFields = Object.entries(fields)
    .map(([name, value]) => (
      `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`
    ))
    .join('\n');

  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Content-Security-Policy', await cliCallbackCspPromise);
  return c.html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
    <meta http-equiv="Pragma" content="no-cache" />
    <title>CLI Authentication</title>
    <style>${CLI_CALLBACK_STYLE}</style>
  </head>
  <body>
    <p>Completing CLI authentication...</p>
    <form id="cli-callback-form" method="POST" action="${escapeHtml(cliCallback)}">
      ${hiddenFields}
      <noscript>
        <button type="submit">Continue</button>
      </noscript>
    </form>
    <script>${CLI_CALLBACK_AUTOSUBMIT_SCRIPT}</script>
  </body>
</html>`);
}

export const authCliRouter = new Hono<OptionalAuthRouteEnv>();

// CLI authentication - starts Google OAuth with CLI callback
authCliRouter.get('/cli', async (c) => {
  const config = getPlatformConfig(c);
  const dbBinding = getPlatformSqlBinding(c);
  const callbackUrl = c.req.query('callback');
  const cliStateRaw = c.req.query('state');
  const cliState = typeof cliStateRaw === 'string' ? cliStateRaw.trim() : '';

  if (!callbackUrl) {
    throw new BadRequestError('Missing callback URL');
  }

  if (cliState && !CLI_STATE_PATTERN.test(cliState)) {
    throw new BadRequestError('Invalid CLI state');
  }

  const validation = validateCliCallbackUrl(callbackUrl);
  if (!validation.valid) {
    throw new BadRequestError(validation.error!);
  }

  if (!dbBinding || !config.googleClientId) {
    throw new BadRequestError('CLI auth is not configured');
  }

  const redirectUri = `https://${config.adminDomain}/auth/cli/callback`;

  const state = await storeOAuthState(dbBinding, redirectUri, cliState || undefined, validation.sanitizedUrl);

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
});

// CLI callback - receives OAuth callback and redirects to CLI
authCliRouter.get('/cli/callback', async (c) => {
  const config = getPlatformConfig(c);
  const dbBinding = getPlatformSqlBinding(c);
  const sessionStore = getPlatformSessionStore(c);
  const code = c.req.query('code');
  const state = c.req.query('state') || '';
  const error = c.req.query('error');

  if (!dbBinding || !sessionStore || !config.googleClientId || !config.googleClientSecret) {
    return c.html(errorPage('認証エラー', 'CLI auth is not configured.'), 500);
  }

  const stateResult = await validateOAuthState(dbBinding, state);
  if (!stateResult.valid || !stateResult.cliCallback) {
    return c.html(errorPage('認証エラー', '無効な CLI コールバックです。'), 400);
  }

  const cliCallback = stateResult.cliCallback;
  const cliState = typeof stateResult.returnTo === 'string' && CLI_STATE_PATTERN.test(stateResult.returnTo)
    ? stateResult.returnTo
    : undefined;

  if (error) {
    return respondToCliWithPost(c, cliCallback, { error }, cliState);
  }

  if (!code) {
    return respondToCliWithPost(c, cliCallback, { error: 'No authorization code received' }, cliState);
  }

  const redirectUri = `https://${config.adminDomain}/auth/cli/callback`;

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
    return respondToCliWithPost(c, cliCallback, { error: 'Token exchange failed' }, cliState);
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    return respondToCliWithPost(c, cliCallback, { error: 'Failed to get user info' }, cliState);
  }

  const googleUser = (await userInfoResponse.json()) as {
    id: string;
    email: string;
  };

  const db = getDb(dbBinding);

  // Look up user by auth_identity (provider='google', providerSub=googleUser.id)
  const identity = await db.select({
    userId: authIdentities.userId,
  }).from(authIdentities).where(and(
    eq(authIdentities.provider, 'google'),
    eq(authIdentities.providerSub, googleUser.id),
  )).get();

  if (!identity) {
    return respondToCliWithPost(c, cliCallback, { error: 'Please complete registration on the web first' }, cliState);
  }

  const user = await db.select({
    id: accounts.id,
    setupCompleted: accounts.setupCompleted,
  }).from(accounts).where(eq(accounts.id, identity.userId)).get();

  if (!user) {
    return respondToCliWithPost(c, cliCallback, { error: 'Please complete registration on the web first' }, cliState);
  }

  if (!user.setupCompleted) {
    return c.html(warningPage(
      'セットアップが必要です',
      'CLI を使用する前にアカウントのセットアップを完了してください。',
      '/setup',
      'セットアップを完了する'
    ), 403);
  }

  const session = await createSession(sessionStore, user.id);

  return respondToCliWithPost(c, cliCallback, { token: session.id }, cliState);
});
