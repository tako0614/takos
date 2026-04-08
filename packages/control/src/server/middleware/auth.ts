import type { Context, MiddlewareHandler } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { Env, User } from '../../shared/types/index.ts';
import { getDb, sessions } from '../../infra/db/index.ts';
import { getSession, getSessionIdFromCookie, normalizeSessionId } from '../../application/services/identity/session.ts';
import { getCachedUser, isValidUserId } from '../../application/services/identity/user-cache.ts';
import { validateTakosPersonalAccessToken } from '../../application/services/identity/takos-access-tokens.ts';

import { AppError, AuthenticationError, InternalError } from 'takos-common/errors';
import { logError, logWarn } from '../../shared/utils/logger.ts';
import { getPlatformServices } from '../../platform/accessors.ts';

type AuthVariables = {
  user?: User;
};

type AuthContext = Context<{ Bindings: Env; Variables: AuthVariables }>;
type AuthMiddleware = MiddlewareHandler<{ Bindings: Env; Variables: AuthVariables }>;

export const authDeps = {
  getSession,
  getSessionIdFromCookie,
  normalizeSessionId,
  getCachedUser,
  isValidUserId,
  validateTakosPersonalAccessToken,
  logError,
  logWarn,
  getPlatformServices,
};

async function validateContainerAuth(c: AuthContext): Promise<User | null> {
  const services = authDeps.getPlatformServices(c);
  const dbBinding = services.sql?.binding;
  const sessionStore = services.notifications.sessionStore;
  const rawTakosSessionId = c.req.header('X-Takos-Session-Id');
  if (!rawTakosSessionId) return null;
  const takosSessionId = authDeps.normalizeSessionId(rawTakosSessionId);
  if (!takosSessionId) {
    authDeps.logWarn('Container auth attempted with invalid session ID format', { module: 'middleware/auth' });
    return null;
  }

  // Internal requests from service binding (runtime-host /forward/* proxy).
  // Accepts `X-Takos-Internal-Marker: "1"` from the host. The legacy
  // `X-Takos-Internal: "1"` sentinel was renamed to avoid colliding with the
  // unrelated `X-Takos-Internal` shared-secret header consumed by
  // `runtime/executor-proxy-api.ts` (Round 11 MEDIUM #11).
  const isInternal = c.req.header('X-Takos-Internal-Marker') === '1';
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
      authDeps.logWarn('Container auth failed: space_id header mismatch', { module: 'middleware/auth' });
      return null;
    }
    if (!containerSession.userAccountId) {
      authDeps.logWarn('Container auth failed: session has no bound user', { module: 'middleware/auth' });
      return null;
    }

    return await authDeps.getCachedUser(c, containerSession.userAccountId);
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
  const services = authDeps.getPlatformServices(c);
  const dbBinding = services.sql?.binding;
  const sessionStore = services.notifications.sessionStore;
  const containerUser = await validateContainerAuth(c);
  if (containerUser) {
    return { user: containerUser };
  }

  let sessionId = authDeps.getSessionIdFromCookie(c.req.header('Cookie'));

  if (!sessionId) {
    const authHeader = c.req.header('Authorization');
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() || null : null;
    if (bearer) {
      if (bearer.startsWith('tak_pat_')) {
        if (!dbBinding) {
          return { user: null };
        }
        const tokenResult = await authDeps.validateTakosPersonalAccessToken(dbBinding, bearer);
        if (!tokenResult || !authDeps.isValidUserId(tokenResult.userId)) {
          if (options.rejectInvalidPat) {
            return {
              user: null,
              errorResponse: c.json({ error: 'invalid_token', error_description: 'Invalid or expired PAT' }, 401),
            };
          }
          return { user: null };
        }
        const patUser = await authDeps.getCachedUser(c, tokenResult.userId);
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

      sessionId = authDeps.normalizeSessionId(bearer);
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
  const session = await authDeps.getSession(sessionStore, sessionId);
  if (!session || !authDeps.isValidUserId(session.user_id)) {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError('Session expired');
    }
    return { user: null };
  }

  const user = await authDeps.getCachedUser(c, session.user_id);
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
export const requireAuth: AuthMiddleware = async (c, next): Promise<Response | void> => {
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
    authDeps.logError('Failed to resolve request user', err, { module: 'auth' });
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
    authDeps.logError('Failed to resolve optional auth', err, { module: 'auth' });
    // Continue without user on auth failure for optional auth
  }
  await next();
};
