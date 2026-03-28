import type { MiddlewareHandler } from 'hono';
import type { Env, User } from '../../shared/types';
import { verifyAccessToken, isAccessTokenValid } from '../../application/services/oauth/token';
import { parseScopes } from '../../application/services/oauth/scopes';
import { getSession, getSessionIdFromCookie } from '../../application/services/identity/session';
import { getCachedUser } from '../../application/services/identity/user-cache';
import { validateTakosAccessToken } from '../../application/services/identity/takos-access-tokens';
import { extractBearerToken } from '../../shared/utils';
import { AuthenticationError } from '@takoserver/common/errors';
import { getPlatformConfig, getPlatformSessionStore, getPlatformSqlBinding } from '../../platform/accessors.ts';

export interface OAuthContext {
  clientId: string;
  scope: string;
  scopes: string[];
  userId: string;
}

type Variables = {
  user?: User;
  oauth?: OAuthContext;
};

export function requireOAuthAuth(
  requiredScopes?: string[]
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const dbBinding = getPlatformSqlBinding(c);
    const config = getPlatformConfig(c);
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

    // Personal Access Token path
    if (token.startsWith('tak_pat_')) {
      if (!dbBinding) {
        return c.json({ error: 'server_error', error_description: 'Database binding unavailable' }, 500);
      }
      const validated = await validateTakosAccessToken(dbBinding, token, requiredScopes);
      const ctx = validated ? {
        clientId: validated.tokenKind === 'personal' ? 'personal' : 'managed_builtin',
        scope: validated.scopes.join(' '),
        scopes: validated.scopes,
        userId: validated.userId,
      } : null;
      if (!ctx) {
        return c.json({ error: 'invalid_token', error_description: 'Invalid or expired PAT' }, 401);
      }
      c.set('oauth', ctx);
      const patUser = await getCachedUser(c, ctx.userId);
      if (!patUser) {
        return c.json({ error: 'invalid_token', error_description: 'User not found' }, 401);
      }
      c.set('user', patUser);
      await next();
      return;
    }

    const issuer = `https://${config.adminDomain}`;
    if (!config.platformPublicKey) {
      return c.json({ error: 'server_error', error_description: 'OAuth public key unavailable' }, 500);
    }

    const payload = await verifyAccessToken({
      token,
      publicKeyPem: config.platformPublicKey,
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

    // Check revocation (expiration is already validated by jose's jwtVerify)
    if (!dbBinding) {
      return c.json({ error: 'server_error', error_description: 'Database binding unavailable' }, 500);
    }
    const isValid = await isAccessTokenValid(dbBinding, payload.jti);
    if (!isValid) {
      return c.json(
        {
          error: 'invalid_token',
          error_description: 'Token has been revoked',
        },
        401
      );
    }

    // Validate audience: token must target the requesting client or the platform
    if (payload.aud) {
      const validAudiences = [
        payload.client_id,
        issuer,
        `${issuer}/api`,
      ];

      const tokenAud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      const hasValidAudience = tokenAud.some((aud) => validAudiences.includes(aud));

      if (!hasValidAudience) {
        return c.json(
          {
            error: 'invalid_token',
            error_description: 'Token audience is not valid for this resource',
          },
          401
        );
      }
    }

    if (requiredScopes && requiredScopes.length > 0) {
      const tokenScopes = parseScopes(payload.scope);
      const hasRequiredScopes = requiredScopes.every((required) =>
        tokenScopes.includes(required)
      );

      if (!hasRequiredScopes) {
        return c.json(
          {
            error: 'insufficient_scope',
            error_description: `Required scopes: ${requiredScopes.join(' ')}`,
          },
          403
        );
      }
    }

    const user = await getCachedUser(c, payload.sub);
    if (!user) {
      return c.json(
        {
          error: 'invalid_token',
          error_description: 'User not found',
        },
        401
      );
    }

    c.set('oauth', {
      clientId: payload.client_id,
      scope: payload.scope,
      scopes: parseScopes(payload.scope),
      userId: payload.sub,
    });

    await next();
  };
}

/**
 * Accepts either session-based or OAuth2 authentication (session takes priority).
 *
 * Design note: when authenticated via session cookie, requiredScopes are intentionally
 * NOT checked. Session = browser-logged-in user with full access to their own account.
 * OAuth Bearer tokens (third-party apps) go through requireOAuthAuth which enforces
 * scope restrictions. Per-route scope enforcement is handled by requireOAuthScope on
 * storage/API routes that need it.
 */
export function requireAnyAuth(
  requiredScopes?: string[]
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const sessionStore = getPlatformSessionStore(c);
    if (c.get('user')) {
      await next();
      return;
    }

    // Session auth path — full access, no scope check (see design note above)
    const sessionId = getSessionIdFromCookie(c.req.header('Cookie') ?? null);
    if (sessionId && sessionStore) {
      const session = await getSession(sessionStore, sessionId);
      if (session) {
        const user = await getCachedUser(c, session.user_id);
        if (user) {
          c.set('user', user);
          await next();
          return;
        }
      }
    }

    // OAuth Bearer path — scopes enforced by requireOAuthAuth
    if (extractBearerToken(c.req.header('Authorization'))) {
      return requireOAuthAuth(requiredScopes)(c, next);
    }

    throw new AuthenticationError('Unauthorized');
  };
}
