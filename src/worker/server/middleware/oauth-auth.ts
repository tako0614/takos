import type { MiddlewareHandler } from "hono";
import type { Env, User } from "../../shared/types/index.ts";
import {
  getSession,
  getSessionIdFromCookie,
} from "../../application/services/identity/session.ts";
import {
  getCachedUser,
  isValidUserId,
} from "../../application/services/identity/user-cache.ts";
import { isSessionRevoked } from "../../application/services/identity/session-revocation.ts";
import { resolveAccountsBearer } from "./accounts-bearer.ts";
import { resolveSelfIssuedBearer } from "../routes/auth/in-process-bearer.ts";
import { resolveCookieSession } from "./session-auth.ts";

import {
  AuthenticationError,
  AuthorizationError,
  InternalError,
} from "@takos/worker-platform-utils/errors";
import {
  getPlatformConfig,
  getPlatformServices,
} from "../../platform/accessors.ts";

export const oauthAuthDeps = {
  getSession,
  getSessionIdFromCookie,
  getCachedUser,
  isValidUserId,
  isSessionRevoked,
  resolveSelfIssuedBearer,
  getPlatformServices,
  getPlatformConfig,
};

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
  requiredScopes?: string[],
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next): Promise<Response | void> => {
    const result = await resolveAccountsBearer(c, oauthAuthDeps, {
      requiredScopes,
    });
    switch (result.kind) {
      case "no-bearer":
        return c.json(
          new AuthenticationError("Missing or invalid Authorization header")
            .toResponse(),
          401,
        );
      // App-local managed tokens are retired, and any non-Accounts bearer is
      // unsupported. Human, automation, and service credentials are Takosumi
      // Accounts bearer/AppGrant credentials.
      case "retired":
      case "not-accounts":
        return c.json(
          new AuthenticationError("Unsupported bearer token").toResponse(),
          401,
        );
      case "no-db":
        return c.json(
          new InternalError("Database binding unavailable").toResponse(),
          500,
        );
      case "invalid":
        return c.json(
          new AuthenticationError("Invalid or expired bearer token")
            .toResponse(),
          401,
        );
      case "scope-insufficient":
        return c.json(
          new AuthorizationError(
            `Required scopes: ${(requiredScopes ?? []).join(" ")}`,
          ).toResponse(),
          403,
        );
      case "user-not-found":
        return c.json(
          new AuthenticationError("User not found").toResponse(),
          401,
        );
      case "ok":
        c.set("oauth", {
          clientId: "takosumi_accounts",
          scope: result.scopes.join(" "),
          scopes: result.scopes,
          userId: result.userId,
        });
        c.set("user", result.user);
        await next();
        return;
    }
  };
}

/**
 * Accepts either session-based auth or scoped bearer auth (session takes priority).
 *
 * Design note: when authenticated via session cookie, requiredScopes are intentionally
 * NOT checked. Session = browser-logged-in user with full access to their own account.
 * Bearer tokens go through requireOAuthAuth, which enforces scope restrictions.
 * Per-route scope enforcement is handled by requireOAuthScope on storage/API routes
 * that need it.
 */
export function requireAnyAuth(
  requiredScopes?: string[],
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const services = oauthAuthDeps.getPlatformServices(c);
    const sessionStore = services.notifications.sessionStore;
    if (c.get("user")) {
      await next();
      return;
    }

    // Session auth path — full access, no scope check (see design note above).
    // Phase 18.2 H11: routed through the same resolveCookieSession helper as
    // requireAuth so the server-side revocation blacklist check cannot drift.
    // Fail-closed; the helper's dbBinding guard preserves behavior when no SQL
    // binding is configured.
    const sessionId = oauthAuthDeps.getSessionIdFromCookie(
      c.req.header("Cookie") ?? null,
    );
    if (sessionId && sessionStore) {
      const resolution = await resolveCookieSession(c, oauthAuthDeps, {
        sessionId,
        sessionStore,
        dbBinding: services.sql?.binding,
      });
      if (resolution.kind === "revoked") {
        throw new AuthenticationError("Session revoked");
      }
      if (resolution.kind === "ok") {
        c.set("user", resolution.user);
        await next();
        return;
      }
      // no-session / user-not-found: fall through to the bearer path.
    }

    // Bearer path — scopes enforced by requireOAuthAuth. The presence gate is
    // intentionally `startsWith("Bearer ")` (not extractBearerToken): a header
    // with an empty token still delegates so requireOAuthAuth surfaces its
    // "Missing or invalid Authorization header" 401 rather than "Unauthorized".
    if (c.req.header("Authorization")?.startsWith("Bearer ")) {
      return requireOAuthAuth(requiredScopes)(c, next);
    }

    throw new AuthenticationError("Unauthorized");
  };
}
