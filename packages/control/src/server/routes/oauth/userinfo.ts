import { Hono } from 'hono';
import { verifyAccessToken, isAccessTokenValid } from '../../../application/services/oauth/token';
import { parseScopes } from '../../../application/services/oauth/scopes';
import { getDb } from '../../../infra/db';
import { accounts } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';
import type { PublicRouteEnv } from '../shared/route-auth';
import { extractBearerToken } from '../../../shared/utils';

const oauthUserinfo = new Hono<PublicRouteEnv>();

oauthUserinfo.get('/userinfo', async (c) => {
  const token = extractBearerToken(c.req.header('Authorization'));

  if (!token) {
    return c.json(
      {
        error: 'invalid_token',
        error_description: 'Missing or invalid Authorization header',
      },
      401
    );
  }

  const issuer = `https://${c.env.ADMIN_DOMAIN}`;

  const payload = await verifyAccessToken({
    token,
    publicKeyPem: c.env.PLATFORM_PUBLIC_KEY,
    issuer,
  });

  if (!payload) {
    return c.json(
      {
        error: 'invalid_token',
        error_description: 'Token verification failed',
      },
      401
    );
  }

  if (!payload.client_id || payload.aud !== payload.client_id) {
    return c.json(
      {
        error: 'invalid_token',
        error_description: 'Token audience is invalid',
      },
      401
    );
  }

  const isValid = await isAccessTokenValid(c.env.DB, payload.jti);
  if (!isValid) {
    return c.json(
      {
        error: 'invalid_token',
        error_description: 'Token has been revoked',
      },
      401
    );
  }

  const db = getDb(c.env.DB);
  const userData = await db.select().from(accounts).where(eq(accounts.id, payload.sub)).get();

  if (!userData) {
    return c.json(
      {
        error: 'invalid_token',
        error_description: 'User not found',
      },
      401
    );
  }

  const scopes = parseScopes(payload.scope);

  const response: Record<string, unknown> = {
    sub: userData.id,
    user: {
      id: userData.id,
      name: scopes.includes('profile') ? userData.name : undefined,
      email: scopes.includes('email') ? userData.email : undefined,
      picture: scopes.includes('profile') ? userData.picture : undefined,
    },
  };

  if (scopes.includes('profile')) {
    response.name = userData.name;
    response.picture = userData.picture;
  }
  if (scopes.includes('email')) {
    response.email = userData.email;
    response.email_verified = true; // Users are verified via Google OAuth
  }

  return c.json(response);
});

export default oauthUserinfo;
