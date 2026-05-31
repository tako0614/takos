import type { Context, MiddlewareHandler } from "hono";
import { and, eq } from "drizzle-orm";
import type { Env, Session, User } from "../../shared/types/index.ts";
import { getDb, sessions } from "../../infra/db/index.ts";
import {
  getSession,
  getSessionIdFromCookie,
  normalizeSessionId,
  rotateSession,
  SESSION_TTL_MS,
  setSessionCookie,
  shouldRotateSession,
} from "../../application/services/identity/session.ts";
import {
  isSessionRevoked,
  recordSessionRevocation,
} from "../../application/services/identity/session-revocation.ts";
import {
  getCachedUser,
  isValidUserId,
} from "../../application/services/identity/user-cache.ts";
import { validateTakosumiAccountsBearer } from "./accounts-bearer.ts";
import {
  isRetiredAppLocalBearerToken,
  isTakosumiAccountsBearerCandidate,
} from "./bearer-token-classification.ts";

import {
  AppError,
  AuthenticationError,
  InternalError,
} from "@takos/worker-platform-utils/errors";
import { toSeconds } from "@takos/worker-platform-utils/ttl";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import {
  getPlatformConfig,
  getPlatformServices,
} from "../../platform/accessors.ts";

type AuthVariables = {
  user?: User;
  /**
   * Phase 18.2 H11: when the auth middleware rotates the cookie session ID,
   * it stashes the new session ID here so the downstream response handler
   * (or a `setRotatedSessionCookie` helper) can reset the cookie. Routes that
   * care about cookie freshness can read this; the `requireAuth` middleware
   * itself appends a `Set-Cookie` header on the response.
   */
  rotated_session_id?: string;
};

type AuthContext = Context<{ Bindings: Env; Variables: AuthVariables }>;
type AuthMiddleware = MiddlewareHandler<
  { Bindings: Env; Variables: AuthVariables }
>;

export const authDeps = {
  getSession,
  getSessionIdFromCookie,
  normalizeSessionId,
  getCachedUser,
  isValidUserId,
  validateTakosumiAccountsBearer,
  logError,
  logWarn,
  getPlatformServices,
  getPlatformConfig,
  // Phase 18.2 H11
  isSessionRevoked,
  recordSessionRevocation,
  rotateSession,
  shouldRotateSession,
};

async function validateContainerAuth(c: AuthContext): Promise<User | null> {
  const services = authDeps.getPlatformServices(c);
  const dbBinding = services.sql?.binding;
  const sessionStore = services.notifications.sessionStore;
  const rawTakosSessionId = c.req.header("X-Takos-Session-Id");
  if (!rawTakosSessionId) return null;
  const takosSessionId = authDeps.normalizeSessionId(rawTakosSessionId);
  if (!takosSessionId) {
    authDeps.logWarn(
      "Container auth attempted with invalid session ID format",
      { module: "middleware/auth" },
    );
    return null;
  }

  // Internal requests from service binding (runtime-host /forward/* proxy).
  // The marker header is separate from the unrelated `X-Takos-Internal`
  // shared-secret header consumed by `runtime/executor-proxy-api.ts`.
  const isInternal = c.req.header("X-Takos-Internal-Marker") === "1";
  if (isInternal) {
    const spaceId = c.req.header("X-Takos-Space-Id");

    if (!dbBinding || !sessionStore) {
      return null;
    }
    const db = getDb(dbBinding);
    const containerSession = await db.select({
      userAccountId: sessions.userAccountId,
      accountId: sessions.accountId,
    }).from(sessions)
      .where(
        and(eq(sessions.id, takosSessionId), eq(sessions.status, "running")),
      )
      .get();

    if (!containerSession) return null;
    if (spaceId && spaceId !== containerSession.accountId) {
      authDeps.logWarn("Container auth failed: space_id header mismatch", {
        module: "middleware/auth",
      });
      return null;
    }
    if (!containerSession.userAccountId) {
      authDeps.logWarn("Container auth failed: session has no bound user", {
        module: "middleware/auth",
      });
      return null;
    }

    return await authDeps.getCachedUser(c, containerSession.userAccountId);
  }

  return null;
}

interface ResolveAuthOptions {
  rejectInvalidBearer: boolean;
  rejectInvalidSession: boolean;
}

function authenticationErrorResponse(c: AuthContext, message: string) {
  return c.json(new AuthenticationError(message).toResponse(), 401);
}

async function resolveRequestUser(
  c: AuthContext,
  options: ResolveAuthOptions,
): Promise<{
  user: User | null;
  errorResponse?: Response;
  rotatedSessionId?: string;
}> {
  const services = authDeps.getPlatformServices(c);
  const config = authDeps.getPlatformConfig(c);
  const dbBinding = services.sql?.binding;
  const sessionStore = services.notifications.sessionStore;
  const containerUser = await validateContainerAuth(c);
  if (containerUser) {
    return { user: containerUser };
  }

  const sessionId = authDeps.getSessionIdFromCookie(c.req.header("Cookie"));
  const cookieSessionId = sessionId;

  if (!sessionId) {
    const authHeader = c.req.header("Authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim() || null
      : null;
    if (bearer) {
      if (isRetiredAppLocalBearerToken(bearer)) {
        return {
          user: null,
          errorResponse: authenticationErrorResponse(
            c,
            "Invalid or expired bearer token",
          ),
        };
      }

      if (isTakosumiAccountsBearerCandidate(bearer)) {
        if (!dbBinding) {
          return { user: null };
        }
        const tokenResult = await authDeps.validateTakosumiAccountsBearer({
          db: dbBinding,
          token: bearer,
          issuerUrl: config.oidcIssuerUrl,
          discoveryUrl: config.oidcDiscoveryUrl,
          clientId: config.oidcClientId,
          clientSecret: config.oidcClientSecret,
        });
        if (!tokenResult || !authDeps.isValidUserId(tokenResult.userId)) {
          if (options.rejectInvalidBearer) {
            return {
              user: null,
              errorResponse: authenticationErrorResponse(
                c,
                "Invalid or expired bearer token",
              ),
            };
          }
          return { user: null };
        }
        const bearerUser = await authDeps.getCachedUser(c, tokenResult.userId);
        if (!bearerUser) {
          if (options.rejectInvalidBearer) {
            return {
              user: null,
              errorResponse: authenticationErrorResponse(
                c,
                "Invalid or expired bearer token",
              ),
            };
          }
          return { user: null };
        }
        return { user: bearerUser };
      }

      if (options.rejectInvalidBearer) {
        return {
          user: null,
          errorResponse: authenticationErrorResponse(
            c,
            "Invalid or expired bearer token",
          ),
        };
      }
      return { user: null };
    }
  }

  if (!sessionId) {
    return { user: null };
  }

  if (!sessionStore) {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError("Session service unavailable");
    }
    return { user: null };
  }

  // Phase 18.2 H11: server-side blacklist check. A session ID present in
  // sessions_revoked is rejected unconditionally — even if the underlying
  // Durable Object still has the row (race window between logout and DO
  // delete). This is the primary defense against token hijacking after
  // logout / rotation.
  if (dbBinding) {
    const revoked = await authDeps.isSessionRevoked(dbBinding, sessionId);
    if (revoked) {
      if (options.rejectInvalidSession) {
        throw new AuthenticationError("Session revoked");
      }
      return { user: null };
    }
  }

  const session = await authDeps.getSession(sessionStore, sessionId);
  if (!session || !authDeps.isValidUserId(session.user_id)) {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError("Session expired");
    }
    return { user: null };
  }

  const user = await authDeps.getCachedUser(c, session.user_id);
  if (!user) {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError("User not found");
    }
    return { user: null };
  }

  // Phase 18.2 H11: rotate the session ID at the configured cadence. We
  // only rotate when the request actually arrived via the cookie path.
  // Accounts bearer tokens do not carry cookie session IDs. Rotation
  // failures are non-fatal — we keep the existing session so a hiccup in
  // the SessionDO does not log the user out.
  let rotatedSessionId: string | undefined;
  if (
    cookieSessionId === sessionId &&
    dbBinding &&
    sessionStore &&
    authDeps.shouldRotateSession(session as Session)
  ) {
    try {
      const next = await authDeps.rotateSession(
        sessionStore,
        session as Session,
      );
      // Add the previous session ID to the blacklist so a stolen pre-rotation
      // cookie cannot be replayed. The blacklist row's expires_at matches the
      // session's original absolute expiry — once the original would have
      // expired anyway there is no replay risk.
      try {
        await authDeps.recordSessionRevocation(dbBinding, {
          sessionId: cookieSessionId,
          userId: session.user_id,
          reason: "rotated",
          expiresAt: new Date(
            session.expires_at ?? Date.now() + SESSION_TTL_MS,
          ).toISOString(),
        });
      } catch (err) {
        authDeps.logWarn("Failed to blacklist rotated session", {
          module: "middleware/auth",
          detail: String(err),
        });
      }
      rotatedSessionId = next.id;
    } catch (err) {
      authDeps.logWarn("Session rotation failed; keeping previous session", {
        module: "middleware/auth",
        detail: String(err),
      });
    }
  }

  return { user, rotatedSessionId };
}

function applyRotatedSessionCookie(
  c: AuthContext,
  rotatedSessionId: string | undefined,
): void {
  if (!rotatedSessionId) return;
  c.set("rotated_session_id", rotatedSessionId);
  // Cookie max-age tracks the configured TTL (7d). The absolute expiry of
  // the underlying Session record is preserved by rotateSession() so the
  // user is not silently extended beyond their original session.
  c.header(
    "Set-Cookie",
    setSessionCookie(rotatedSessionId, toSeconds(SESSION_TTL_MS)),
    { append: true },
  );
}

// Supports cookie auth (browser), Takosumi Accounts Bearer tokens, and
// X-Takos-Internal-Marker + X-Takos-Session-Id (container API proxy via service binding)
export const requireAuth: AuthMiddleware = async (
  c,
  next,
): Promise<Response | void> => {
  if (c.get("user")) {
    await next();
    return;
  }

  let resolved;
  try {
    resolved = await resolveRequestUser(c, {
      rejectInvalidBearer: true,
      rejectInvalidSession: true,
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    authDeps.logError("Failed to resolve request user", err, {
      module: "auth",
    });
    throw new InternalError("Internal authentication error");
  }
  if (resolved.errorResponse) {
    return resolved.errorResponse;
  }
  if (!resolved.user) {
    throw new AuthenticationError();
  }
  c.set("user", resolved.user);
  applyRotatedSessionCookie(c, resolved.rotatedSessionId);

  await next();
};

// Sets user if logged in, but allows anonymous access
export const optionalAuth: AuthMiddleware = async (c, next) => {
  if (c.get("user")) {
    await next();
    return;
  }

  try {
    const resolved = await resolveRequestUser(c, {
      rejectInvalidBearer: false,
      rejectInvalidSession: false,
    });
    if (resolved.errorResponse) {
      return resolved.errorResponse;
    }
    if (resolved.user) {
      c.set("user", resolved.user);
    }
    applyRotatedSessionCookie(c, resolved.rotatedSessionId);
  } catch (err) {
    authDeps.logError("Failed to resolve optional auth", err, {
      module: "auth",
    });
    // Continue without user on auth failure for optional auth
  }
  await next();
};
