import { Hono } from 'hono';
import { validateClientCredentials } from '../../../application/services/oauth/client';
import { getRefreshToken, revokeToken, verifyAccessToken } from '../../../application/services/oauth/token';
import { tryLogOAuthEvent, getBodyValue, type FormBody } from './request-utils';
import type { PublicRouteEnv } from '../route-auth';
import { RateLimiters } from '../../../shared/utils/rate-limiter';

const oauthRevoke = new Hono<PublicRouteEnv>();

// Apply rate limiting: 10 requests per minute per IP
const revokeRateLimiter = RateLimiters.oauthRevoke();
oauthRevoke.use('/revoke', revokeRateLimiter.middleware());

oauthRevoke.post('/revoke', async (c) => {
  const body = await c.req.parseBody() as FormBody;
  const token = getBodyValue(body.token);
  const tokenTypeHint = getBodyValue(body.token_type_hint) as 'access_token' | 'refresh_token' | undefined;
  const clientId = getBodyValue(body.client_id);
  const clientSecret = getBodyValue(body.client_secret);

  if (!token || !clientId) {
    return c.json(
      { error: 'invalid_request', error_description: 'Missing required parameters' },
      400
    );
  }

  const { valid, error } = await validateClientCredentials(c.env.DB, clientId, clientSecret);
  if (!valid) {
    return c.json({ error: 'invalid_client', error_description: error }, 401);
  }

  let isClientMismatch = false;

  if (tokenTypeHint !== 'refresh_token') {
    const accessTokenPayload = await verifyAccessToken({
      token,
      publicKeyPem: c.env.PLATFORM_PUBLIC_KEY,
      issuer: `https://${c.env.ADMIN_DOMAIN}`,
    });

    if (accessTokenPayload && accessTokenPayload.client_id !== clientId) {
      isClientMismatch = true;
    }
  }

  if (!isClientMismatch && tokenTypeHint !== 'access_token') {
    const refreshToken = await getRefreshToken(c.env.DB, token);
    if (refreshToken && refreshToken.client_id !== clientId) {
      isClientMismatch = true;
    }
  }

  if (!isClientMismatch) {
    await revokeToken(c.env.DB, token, tokenTypeHint);

    await tryLogOAuthEvent(c, {
      clientId,
      eventType: 'token_revoked',
      details: {
        token_type_hint: tokenTypeHint || null,
      },
    });
  }

  return c.body(null, 200);
});

export default oauthRevoke;
