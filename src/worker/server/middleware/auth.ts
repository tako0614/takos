import type { Context, MiddlewareHandler } from "hono";
import type { Env, User } from "../../shared/types/index.ts";
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
import { resolveAccountsBearer } from "./accounts-bearer.ts";
import { resolveSelfIssuedBearer } from "../routes/auth/in-process-bearer.ts";
import { resolveCookieSession } from "./session-auth.ts";

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
type AuthMiddleware = MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthVariables;
}>;

export const authDeps = {
  getSession,
  getSessionIdFromCookie,
  normalizeSessionId,
  getCachedUser,
  isValidUserId,
  resolveSelfIssuedBearer,
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
  const dbBinding = services.sql?.binding;
  const sessionStore = services.notifications.sessionStore;

  const sessionId = authDeps.getSessionIdFromCookie(c.req.header("Cookie"));
  const cookieSessionId = sessionId;

  if (!sessionId) {
    // Bearer-only path: extract → classify → Accounts introspection.
    const bearer = await resolveAccountsBearer(c, authDeps);
    switch (bearer.kind) {
      case "no-bearer":
        return { user: null };
      case "unsupported-app-local-bearer":
        // Unsupported app-local bearer prefixes are never acceptable.
        return {
          user: null,
          errorResponse: authenticationErrorResponse(
            c,
            "Invalid or expired bearer token",
          ),
        };
      case "no-db":
        return { user: null };
      case "scope-insufficient":
        if (options.rejectInvalidBearer) {
          return {
            user: null,
            errorResponse: authenticationErrorResponse(
              c,
              "Insufficient bearer token scope",
            ),
          };
        }
        return { user: null };
      case "invalid":
      case "user-not-found":
      case "not-accounts":
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
      case "ok":
        return { user: bearer.user };
    }
  }

  if (!sessionStore) {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError("Session service unavailable");
    }
    return { user: null };
  }

  // Phase 18.2 H11: server-side blacklist check + session/user load via the
  // shared cookie-session resolver. A session ID present in sessions_revoked is
  // rejected unconditionally — even if the underlying Durable Object still has
  // the row (race window between logout and DO delete). This is the primary
  // defense against token hijacking after logout / rotation.
  const resolution = await resolveCookieSession(c, authDeps, {
    sessionId,
    sessionStore,
    dbBinding,
  });
  if (resolution.kind === "revoked") {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError("Session revoked");
    }
    return { user: null };
  }
  if (resolution.kind === "no-session") {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError("Session expired");
    }
    return { user: null };
  }
  if (resolution.kind === "user-not-found") {
    if (options.rejectInvalidSession) {
      throw new AuthenticationError("User not found");
    }
    return { user: null };
  }
  const { user, session } = resolution;

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
    authDeps.shouldRotateSession(session)
  ) {
    try {
      const next = await authDeps.rotateSession(sessionStore, session);
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

// Supports cookie auth (browser) and Takosumi Accounts Bearer tokens.
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
