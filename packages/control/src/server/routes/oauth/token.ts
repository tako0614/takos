import { Hono, type Context } from 'hono';
import { supportsGrantType, validateClientCredentials, getClientAllowedScopes } from '../../../application/services/oauth/client';
import { exchangeAuthorizationCode } from '../../../application/services/oauth/authorization';
import {
  buildAuthorizationCodeTokenFamily,
  generateTokenResponse,
  RefreshTokenReuseDetectedError,
  rotateRefreshToken,
  getRefreshTokenWithReuseCheck,
  revokeTokenFamily,
} from '../../../application/services/oauth/token';
import { areScopesAllowed, parseScopes } from '../../../application/services/oauth/scopes';
import { consumeApprovedDeviceAuthorization, pollDeviceAuthorization } from '../../../application/services/oauth/device';
import { DEVICE_CODE_GRANT_TYPE } from '../../../shared/types/oauth';
import { tryLogOAuthEvent, getBodyValue } from './helpers';
import type { PublicRouteEnv } from '../shared/helpers';
import { RateLimiters } from '../../../shared/utils/rate-limiter';
import { logWarn } from '../../../shared/utils/logger';

const oauthToken = new Hono<PublicRouteEnv>();

const tokenRateLimiter = RateLimiters.oauthToken();
oauthToken.use('/token', tokenRateLimiter.middleware());

type TokenContext = Context<PublicRouteEnv>;

type TokenRequestBody = Record<string, string | string[]>;

oauthToken.post('/token', async (c) => {
  const contentType = c.req.header('Content-Type');
  if (!contentType?.includes('application/x-www-form-urlencoded')) {
    return c.json(
      { error: 'invalid_request', error_description: 'Content-Type must be application/x-www-form-urlencoded' },
      400
    );
  }

  const body = await c.req.parseBody() as TokenRequestBody;
  const grantType = getBodyValue(body.grant_type);

  if (grantType === 'authorization_code') {
    return handleAuthorizationCodeGrant(c, body);
  } else if (grantType === 'refresh_token') {
    return handleRefreshTokenGrant(c, body);
  } else if (grantType === 'client_credentials') {
    return handleClientCredentialsGrant(c, body);
  } else if (grantType === DEVICE_CODE_GRANT_TYPE) {
    return handleDeviceCodeGrant(c, body);
  } else {
    return c.json(
      { error: 'unsupported_grant_type', error_description: 'Unsupported grant type' },
      400
    );
  }
});

async function handleAuthorizationCodeGrant(c: TokenContext, body: TokenRequestBody) {
  const code = getBodyValue(body.code);
  const redirectUri = getBodyValue(body.redirect_uri);
  const clientId = getBodyValue(body.client_id);
  const clientSecret = getBodyValue(body.client_secret);
  const codeVerifier = getBodyValue(body.code_verifier);

  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return c.json(
      { error: 'invalid_request', error_description: 'Missing required parameters' },
      400
    );
  }

  const { valid, client, error } = await validateClientCredentials(
    c.env.DB,
    clientId,
    clientSecret
  );

  if (!valid || !client) {
    return c.json({ error: 'invalid_client', error_description: error }, 401);
  }

  const exchange = await exchangeAuthorizationCode(c.env.DB, {
    code,
    clientId,
    redirectUri,
    codeVerifier,
  });

  if (!exchange.valid) {
    return c.json(
      { error: exchange.error, error_description: exchange.errorDescription },
      400
    );
  }

  const exchangedCode = exchange.code;
  if (!exchangedCode) {
    return c.json(
      { error: 'server_error', error_description: 'Code exchange succeeded but code data is missing' },
      500
    );
  }

  const issuer = `https://${c.env.ADMIN_DOMAIN}`;
  const tokenResponse = await generateTokenResponse(c.env.DB, {
    privateKeyPem: c.env.PLATFORM_PRIVATE_KEY,
    issuer,
    userId: exchangedCode.user_id,
    client,
    scope: exchangedCode.scope,
    tokenFamily: buildAuthorizationCodeTokenFamily(exchangedCode.id),
  });

  await tryLogOAuthEvent(c, {
    userId: exchangedCode.user_id,
    clientId,
    eventType: 'token_issued',
    details: {
      grant_type: 'authorization_code',
      scope: exchangedCode.scope,
    },
  });

  c.header('Cache-Control', 'no-store');
  return c.json(tokenResponse);
}

async function handleRefreshTokenGrant(c: TokenContext, body: TokenRequestBody) {
  const refreshToken = getBodyValue(body.refresh_token);
  const clientId = getBodyValue(body.client_id);
  const clientSecret = getBodyValue(body.client_secret);
  const scope = getBodyValue(body.scope);

  if (!refreshToken || !clientId) {
    return c.json(
      { error: 'invalid_request', error_description: 'Missing required parameters' },
      400
    );
  }

  const { valid, client, error } = await validateClientCredentials(
    c.env.DB,
    clientId,
    clientSecret
  );

  if (!valid || !client) {
    return c.json({ error: 'invalid_client', error_description: error }, 401);
  }

  const { token: storedToken, isReuse } = await getRefreshTokenWithReuseCheck(c.env.DB, refreshToken);

  if (!storedToken) {
    return c.json(
      { error: 'invalid_grant', error_description: 'Invalid refresh token' },
      400
    );
  }

  // SECURITY: Detect refresh token reuse (potential token theft)
  // If a token is presented after it has already been used, this indicates
  // that either the legitimate user or an attacker has a copy of the token.
  // As a security measure, we revoke ALL tokens in the family to force re-authentication.
  if (isReuse) {
    logWarn('SECURITY: Refresh token reuse detected!', { module: 'routes/oauth/token', ...{
      tokenId: storedToken.id,
      userId: storedToken.user_id,
      clientId: storedToken.client_id,
      tokenFamily: storedToken.token_family,
    } });

    if (storedToken.token_family) {
      const revokedCount = await revokeTokenFamily(c.env.DB, storedToken.token_family, 'reuse_detected');
      logWarn(`SECURITY: Revoked ${revokedCount} tokens in family ${storedToken.token_family}`, { module: 'routes/oauth/token' });
    }

    await tryLogOAuthEvent(c, {
      userId: storedToken.user_id,
      clientId,
      eventType: 'token_reuse_detected',
      details: {
        token_id: storedToken.id,
        token_family: storedToken.token_family,
        original_used_at: storedToken.used_at,
      },
    });

    await tryLogOAuthEvent(c, {
      userId: storedToken.user_id,
      clientId,
      eventType: 'token_family_revoked',
      details: {
        token_family: storedToken.token_family,
        reason: 'reuse_detected',
      },
    });

    return c.json(
      { error: 'invalid_grant', error_description: 'Refresh token has been invalidated for security reasons' },
      400
    );
  }

  if (storedToken.client_id !== clientId) {
    return c.json(
      { error: 'invalid_grant', error_description: 'Token was not issued to this client' },
      400
    );
  }

  if (new Date(storedToken.expires_at) < new Date()) {
    return c.json(
      { error: 'invalid_grant', error_description: 'Refresh token expired' },
      400
    );
  }

  let finalScope = storedToken.scope;
  if (scope) {
    const requestedScopes = parseScopes(scope);
    const originalScopes = parseScopes(storedToken.scope);
    if (!areScopesAllowed(requestedScopes, originalScopes)) {
      return c.json(
        { error: 'invalid_scope', error_description: 'Requested scope exceeds original grant' },
        400
      );
    }
    finalScope = scope;
  }

  const issuer = `https://${c.env.ADMIN_DOMAIN}`;
  let tokenResponse;
  try {
    tokenResponse = await rotateRefreshToken(c.env.DB, {
      privateKeyPem: c.env.PLATFORM_PRIVATE_KEY,
      issuer,
      oldRefreshToken: storedToken,
      client,
      scope: finalScope,
    });
  } catch (err) {
    if (err instanceof RefreshTokenReuseDetectedError) {
      return c.json(
        { error: 'invalid_grant', error_description: 'Refresh token has been invalidated for security reasons' },
        400
      );
    }
    throw err;
  }

  await tryLogOAuthEvent(c, {
    userId: storedToken.user_id,
    clientId,
    eventType: 'token_refreshed',
    details: {
      grant_type: 'refresh_token',
      scope: finalScope,
    },
  });

  c.header('Cache-Control', 'no-store');
  return c.json(tokenResponse);
}

async function handleDeviceCodeGrant(c: TokenContext, body: TokenRequestBody) {
  const deviceCode = getBodyValue(body.device_code);
  const clientId = getBodyValue(body.client_id);
  const clientSecret = getBodyValue(body.client_secret);

  if (!deviceCode || !clientId) {
    return c.json(
      { error: 'invalid_request', error_description: 'Missing required parameters' },
      400
    );
  }

  const { valid, client, error } = await validateClientCredentials(
    c.env.DB,
    clientId,
    clientSecret
  );

  if (!valid || !client) {
    return c.json({ error: 'invalid_client', error_description: error }, 401);
  }

  if (!supportsGrantType(client, DEVICE_CODE_GRANT_TYPE)) {
    return c.json(
      { error: 'unauthorized_client', error_description: 'Client does not support device_code grant' },
      400
    );
  }

  const poll = await pollDeviceAuthorization(c.env.DB, { deviceCode, clientId });

  if (poll.kind === 'pending') {
    return c.json(
      {
        error: poll.slowDown ? 'slow_down' : 'authorization_pending',
        error_description: poll.slowDown ? 'Slow down polling' : 'Authorization pending',
      },
      400
    );
  }

  if (poll.kind === 'denied') {
    return c.json(
      { error: 'access_denied', error_description: 'The user denied the request' },
      400
    );
  }

  if (poll.kind === 'expired') {
    return c.json(
      { error: 'expired_token', error_description: 'Device code expired' },
      400
    );
  }

  if (poll.kind === 'used') {
    return c.json(
      { error: 'invalid_grant', error_description: 'Device code already used' },
      400
    );
  }

  if (poll.kind === 'client_mismatch' || poll.kind === 'not_found') {
    return c.json(
      { error: 'invalid_grant', error_description: 'Invalid device code' },
      400
    );
  }

  const consumed = await consumeApprovedDeviceAuthorization(c.env.DB, poll.id);
  if (!consumed) {
    return c.json(
      { error: 'invalid_grant', error_description: 'Device code already used' },
      400
    );
  }

  const issuer = `https://${c.env.ADMIN_DOMAIN}`;
  const tokenResponse = await generateTokenResponse(c.env.DB, {
    privateKeyPem: c.env.PLATFORM_PRIVATE_KEY,
    issuer,
    userId: poll.userId,
    client,
    scope: poll.scope,
  });

  await tryLogOAuthEvent(c, {
    userId: poll.userId,
    clientId,
    eventType: 'token_issued',
    details: {
      grant_type: DEVICE_CODE_GRANT_TYPE,
      scope: poll.scope,
    },
  });

  c.header('Cache-Control', 'no-store');
  return c.json(tokenResponse);
}

async function handleClientCredentialsGrant(c: TokenContext, body: TokenRequestBody) {
  const clientId = getBodyValue(body.client_id);
  const clientSecret = getBodyValue(body.client_secret);
  const scope = getBodyValue(body.scope);

  if (!clientId || !clientSecret) {
    return c.json({ error: 'invalid_request', error_description: 'Missing client_id or client_secret' }, 400);
  }

  const { valid, client, error } = await validateClientCredentials(c.env.DB, clientId, clientSecret);
  if (!valid || !client) {
    return c.json({ error: 'invalid_client', error_description: error }, 401);
  }
  if (!supportsGrantType(client, 'client_credentials')) {
    return c.json({ error: 'unauthorized_client', error_description: 'Grant type not allowed' }, 400);
  }

  const allowedScopes = getClientAllowedScopes(client);
  const requestedScopes = scope ? parseScopes(scope) : [];
  if (requestedScopes.length > 0 && !areScopesAllowed(requestedScopes, allowedScopes)) {
    return c.json({ error: 'invalid_scope', error_description: 'Requested scope exceeds allowed scopes' }, 400);
  }
  const finalScope = requestedScopes.length > 0 ? requestedScopes.join(' ') : allowedScopes.join(' ');

  const issuer = `https://${c.env.ADMIN_DOMAIN}`;
  const tokenResponse = await generateTokenResponse(c.env.DB, {
    privateKeyPem: c.env.PLATFORM_PRIVATE_KEY,
    issuer,
    userId: clientId,
    client,
    scope: finalScope,
    includeRefreshToken: false,
  });

  await tryLogOAuthEvent(c, {
    userId: clientId,
    clientId,
    eventType: 'token_issued',
    details: { grant_type: 'client_credentials', scope: finalScope },
  });

  c.header('Cache-Control', 'no-store');
  return c.json(tokenResponse);
}

export default oauthToken;
