import type { MiddlewareHandler } from "hono";
import type { Env, User } from "../../shared/types/index.ts";
import {
  getSession,
  getSessionIdFromCookie,
} from "../../application/services/identity/session.ts";
import { getCachedUser } from "../../application/services/identity/user-cache.ts";
import { isSessionRevoked } from "../../application/services/identity/session-revocation.ts";
import { validateTakosumiAccountsBearer } from "./accounts-bearer.ts";
import {
  isRetiredAppLocalBearerToken,
  isTakosumiAccountsBearerCandidate,
} from "./bearer-token-classification.ts";

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
  isSessionRevoked,
  validateTakosumiAccountsBearer,
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
    const dbBinding = oauthAuthDeps.getPlatformServices(c).sql?.binding;
    const config = oauthAuthDeps.getPlatformConfig(c);
    const authorizationHeader = c.req.header("Authorization");
    const token = authorizationHeader?.startsWith("Bearer ")
      ? authorizationHeader.slice(7).trim() || null
      : null;

    if (!token) {
      return c.json(
        new AuthenticationError("Missing or invalid Authorization header")
          .toResponse(),
        401,
      );
    }

    // App-local managed tokens are retired. Human, automation, and service
    // credentials are Takosumi Accounts bearer/AppGrant credentials.
    if (isRetiredAppLocalBearerToken(token)) {
      return c.json(
        new AuthenticationError("Unsupported bearer token").toResponse(),
        401,
      );
    }

    if (isTakosumiAccountsBearerCandidate(token)) {
      if (!dbBinding) {
        return c.json(
          new InternalError("Database binding unavailable").toResponse(),
          500,
        );
      }
      const validated = await oauthAuthDeps.validateTakosumiAccountsBearer({
        db: dbBinding,
        token,
        issuerUrl: config.oidcIssuerUrl,
        discoveryUrl: config.oidcDiscoveryUrl,
        clientId: config.oidcClientId,
        clientSecret: config.oidcClientSecret,
        requiredScopes,
      });
      if (!validated) {
        return c.json(
          new AuthenticationError("Invalid or expired bearer token")
            .toResponse(),
          401,
        );
      }
      if (
        requiredScopes?.length &&
        !requiredScopes.every((required) => validated.scopes.includes(required))
      ) {
        return c.json(
          new AuthorizationError(`Required scopes: ${requiredScopes.join(" ")}`)
            .toResponse(),
          403,
        );
      }
      const user = await oauthAuthDeps.getCachedUser(c, validated.userId);
      if (!user) {
        return c.json(
          new AuthenticationError("User not found").toResponse(),
          401,
        );
      }
      c.set("oauth", {
        clientId: "takosumi_accounts",
        scope: validated.scopes.join(" "),
        scopes: validated.scopes,
        userId: validated.userId,
      });
      c.set("user", user);
      await next();
      return;
    }

    return c.json(
      new AuthenticationError("Unsupported bearer token").toResponse(),
      401,
    );
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
    const sessionStore =
      oauthAuthDeps.getPlatformServices(c).notifications.sessionStore;
    if (c.get("user")) {
      await next();
      return;
    }

    // Session auth path — full access, no scope check (see design note above)
    const sessionId = oauthAuthDeps.getSessionIdFromCookie(
      c.req.header("Cookie") ?? null,
    );
    if (sessionId && sessionStore) {
      // Phase 18.2 H11: mirror requireAuth's server-side blacklist check so a
      // revoked session ID cannot authenticate via the requireAnyAuth cookie
      // path. Fail-closed; guard on dbBinding to preserve behavior when no SQL
      // binding is configured (mirrors auth.ts).
      const dbBinding = oauthAuthDeps.getPlatformServices(c).sql?.binding;
      if (dbBinding && await oauthAuthDeps.isSessionRevoked(dbBinding, sessionId)) {
        throw new AuthenticationError("Session revoked");
      }
      const session = await oauthAuthDeps.getSession(sessionStore, sessionId);
      if (session) {
        const user = await oauthAuthDeps.getCachedUser(c, session.user_id);
        if (user) {
          c.set("user", user);
          await next();
          return;
        }
      }
    }

    // Bearer path — scopes enforced by requireOAuthAuth
    if (c.req.header("Authorization")?.startsWith("Bearer ")) {
      return requireOAuthAuth(requiredScopes)(c, next);
    }

    throw new AuthenticationError("Unauthorized");
  };
}
