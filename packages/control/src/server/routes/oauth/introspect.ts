import { Hono } from 'hono';
import { validateClientCredentials } from '../../../application/services/oauth/client';
import { verifyAccessToken, isAccessTokenValid, getRefreshToken } from '../../../application/services/oauth/token';
import { RateLimiters } from '../../../shared/utils/rate-limiter';
import type { PublicRouteEnv } from '../shared/route-auth';
import { getBodyValue, type FormBody } from './request-utils';

const oauthIntrospect = new Hono<PublicRouteEnv>();

const introspectRateLimiter = RateLimiters.oauthToken();
oauthIntrospect.use('/introspect', introspectRateLimiter.middleware());

oauthIntrospect.post('/introspect', async (c) => {
  const body = await c.req.parseBody() as FormBody;
  const token = getBodyValue(body.token);
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

  const issuer = `https://${c.env.ADMIN_DOMAIN}`;
  const payload = await verifyAccessToken({
    token,
    publicKeyPem: c.env.PLATFORM_PUBLIC_KEY,
    issuer,
    expectedAudience: clientId,
  });

  if (payload) {
    if (payload.client_id !== clientId) {
      return c.json({ active: false });
    }

    const isValid = await isAccessTokenValid(c.env.DB, payload.jti);
    if (!isValid) {
      return c.json({ active: false });
    }

    return c.json({
      active: true,
      scope: payload.scope,
      client_id: payload.client_id,
      token_type: 'Bearer',
      exp: payload.exp,
      iat: payload.iat,
      sub: payload.sub,
      aud: payload.aud,
      iss: payload.iss,
      jti: payload.jti,
    });
  }

  const refreshToken = await getRefreshToken(c.env.DB, token);
  if (refreshToken && refreshToken.client_id !== clientId) {
    return c.json({ active: false });
  }

  if (refreshToken && !refreshToken.revoked && new Date(refreshToken.expires_at) > new Date()) {
    return c.json({
      active: true,
      scope: refreshToken.scope,
      client_id: refreshToken.client_id,
      token_type: 'refresh_token',
      exp: Math.floor(new Date(refreshToken.expires_at).getTime() / 1000),
      sub: refreshToken.user_id,
    });
  }

  return c.json({ active: false });
});

export default oauthIntrospect;
