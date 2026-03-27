import type { Context, MiddlewareHandler } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Env, User } from '../../shared/types';
import { getDb, sessions } from '../../infra/db';
import { getSession, getSessionIdFromCookie, normalizeSessionId } from '../../application/services/identity/session';
import { getCachedUser, isValidUserId } from '../../shared/utils/user-cache';
import { validateTakosPersonalAccessToken } from '../../application/services/identity/takos-access-tokens';
import { extractBearerToken } from '../../shared/utils';
import { AppError, AuthenticationError, InternalError } from '@takos/common/errors';
import { logError, logWarn } from '../../shared/utils/logger';
import { getPlatformSessionStore, getPlatformSqlBinding } from '../../platform/accessors.ts';

type AuthVariables = {
  user?: User;
};

type AuthContext = Context<{ Bindings: Env; Variables: AuthVariables }>;
type AuthMiddleware = MiddlewareHandler<{ Bindings: Env; Variables: AuthVariables }>;

async function validateContainerAuth(c: AuthContext): Promise<User | null> {
  const dbBinding = getPlatformSqlBinding(c);
  const sessionStore = getPlatformSessionStore(c);
  const rawTakosSessionId = c.req.header('X-Takos-Session-Id');
  if (!rawTakosSessionId) return null;
  const takosSessionId = normalizeSessionId(rawTakosSessionId);
  if (!takosSessionId) {
    logWarn('Container auth attempted with invalid session ID format', { module: 'middleware/auth' });
    return null;
  }

  // Internal requests from service binding (runtime-host /forward/* proxy)
  const isInternal = c.req.header('X-Takos-Internal') === '1';
  if (isInternal) {
    const spaceId = c.req.header('X-Takos-Space-Id');

    if (!dbBinding || !sessionStore) {
      return null;
    }
    const db = getDb(dbBinding);
    const containerSession = await db.select({
      userAccountId: sessions.userAccountId,
      accountId: sessions.accountId,
    }).from(sessions)
      .where(and(eq(sessions.id, takosSessionId), eq(sessions.status, 'running')))
      .get();

    if (!containerSession) return null;
    if (spaceId && spaceId !== containerSession.accountId) {
      logWarn('Container auth failed: space_id header mismatch', { module: 'middleware/auth' });
      return null;
    }
    if (!containerSession.userAccountId) {
      logWarn('Container auth failed: session has no bound user', { module: 'middleware/auth' });
      return null;
    }

    return await getCachedUser(c, containerSession.userAccountId);
  }

  return null;
}

interface ResolveAuthOptions {
  rejectInvalidPat: boolean;
  rejectOAuthBearer: boolean;
  rejectInvalidSession: boolean;
}

async function resolveRequestUser(
  c: AuthContext,
  options: ResolveAuthOptions
): Promise<{ user: User | null; errorResponse?: Response }> {
  const dbBinding = getPlatformSqlBinding(c);
  const sessionStore = getPlatformSessionStore(c);
  const containerUser = await validateContainerAuth(c);
  if (containerUser) {
    return { user: containerUser };
  }

  let sessionId = getSessionIdFromCookie(c.req.header('Cookie'));

  if (!sessionId) {
    const bearer = extractBearerToken(c.req.header('Authorization'));
    if (bearer) {
      if (bearer.startsWith('tak_pat_')) {
        if (!dbBinding) {
          return { user: null };
        }
        const tokenResult = await validateTakosPersonalAccessToken(dbBinding, bearer);
        if (!tokenResult || !isValidUserId(tokenResult.userId)) {
          if (options.rejectInvalidPat) {
            return {
              user: null,
              errorResponse: c.json({ error: 'invalid_token', error_description: 'Invalid or expired PAT' }, 401),
            };
          }
          return { user: null };
        }
        const patUser = await getCachedUser(c, tokenResult.userId);
        if (!patUser) {
          if (options.rejectInvalidPat) {
            return {
              user: null,
              errorResponse: c.json({ error: 'invalid_token', error_description: 'Invalid or expired PAT' }, 401),
            };
          }
          return { user: null };
        }
        return { user: patUser };
      }

      if (bearer.includes('.')) {
        if (options.rejectOAuthBearer) {
          return {
            user: null,
            errorResponse: c.json(
              { error: 'OAuth bearer token is not supported on this endpoint. Use OAuth-protected routes.' },
              401
            ),
          };
        }
        return { user: null };
      }

      sessionId = normalizeSessionId(bearer);
    }
  }

  if (!sessionId) {
    return { user: null };
  }

  if (!sessionStore) {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError('Session service unavailable');
    }
    return { user: null };
  }
  const session = await getSession(sessionStore, sessionId);
  if (!session || !isValidUserId(session.user_id)) {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError('Session expired');
    }
    return { user: null };
  }

  const user = await getCachedUser(c, session.user_id);
  if (!user) {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError('User not found');
    }
    return { user: null };
  }

  return { user };
}

// Supports cookie auth (browser), Bearer token (CLI external), and
// X-Takos-Internal + X-Takos-Session-Id (CLI container mode via service binding)
export const requireAuth: AuthMiddleware = async (c, next) => {
  if (c.get('user')) {
    await next();
    return;
  }

  let resolved;
  try {
    resolved = await resolveRequestUser(c, {
      rejectInvalidPat: true,
      rejectOAuthBearer: true,
      rejectInvalidSession: true,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    logError('Failed to resolve request user', err, { module: 'auth' });
    throw new InternalError('Internal authentication error');
  }
  if (resolved.errorResponse) {
    return resolved.errorResponse;
  }
  if (!resolved.user) {
    throw new AuthenticationError();
  }
  c.set('user', resolved.user);

  await next();
};

// Sets user if logged in, but allows anonymous access
export const optionalAuth: AuthMiddleware = async (c, next) => {
  if (c.get('user')) {
    await next();
    return;
  }

  try {
    const resolved = await resolveRequestUser(c, {
      rejectInvalidPat: false,
      rejectOAuthBearer: false,
      rejectInvalidSession: false,
    });
    if (resolved.user) {
      c.set('user', resolved.user);
    }
  } catch (err) {
    logError('Failed to resolve optional auth', err, { module: 'auth' });
    // Continue without user on auth failure for optional auth
  }
  await next();
};
