import type { MiddlewareHandler } from "hono";
import type { Env, User } from "../../shared/types/index.ts";
import {
  isAccessTokenValid,
  verifyAccessToken,
} from "../../application/services/oauth/token.ts";
import { parseScopes } from "../../application/services/oauth/scopes.ts";
import {
  getSession,
  getSessionIdFromCookie,
} from "../../application/services/identity/session.ts";
import { getCachedUser } from "../../application/services/identity/user-cache.ts";
import { validateTakosAccessToken } from "../../application/services/identity/takos-access-tokens.ts";

import { AuthenticationError } from "takos-common/errors";
import {
  getPlatformConfig,
  getPlatformServices,
} from "../../platform/accessors.ts";

export const oauthAuthDeps = {
  verifyAccessToken,
  isAccessTokenValid,
  parseScopes,
  getSession,
  getSessionIdFromCookie,
  getCachedUser,
  validateTakosAccessToken,
  getPlatformConfig,
  getPlatformServices,
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
        {
          error: "invalid_token",
          error_description: "Missing or invalid Authorization header",
        },
        401,
      );
    }

    // Personal Access Token path
    if (token.startsWith("tak_pat_")) {
      if (!dbBinding) {
        return c.json({
          error: "server_error",
          error_description: "Database binding unavailable",
        }, 500);
      }
      const validated = await oauthAuthDeps.validateTakosAccessToken(
        dbBinding,
        token,
        requiredScopes,
      );
      const ctx = validated
        ? {
          clientId: validated.tokenKind === "personal"
            ? "personal"
            : "managed_builtin",
          scope: validated.scopes.join(" "),
          scopes: validated.scopes,
          userId: validated.userId,
        }
        : null;
      if (!ctx) {
        return c.json({
          error: "invalid_token",
          error_description: "Invalid or expired PAT",
        }, 401);
      }
      c.set("oauth", ctx);
      const patUser = await oauthAuthDeps.getCachedUser(c, ctx.userId);
      if (!patUser) {
        return c.json({
          error: "invalid_token",
          error_description: "User not found",
        }, 401);
      }
      c.set("user", patUser);
      await next();
      return;
    }

    const issuer = `https://${config.adminDomain}`;
    if (!config.platformPublicKey) {
      return c.json({
        error: "server_error",
        error_description: "OAuth public key unavailable",
      }, 500);
    }

    const payload = await oauthAuthDeps.verifyAccessToken({
      token,
      publicKeyPem: config.platformPublicKey,
      issuer,
    });

    if (!payload) {
      return c.json(
        {
          error: "invalid_token",
          error_description: "Token verification failed",
        },
        401,
      );
    }

    // Check revocation (expiration is already validated by jose's jwtVerify)
    if (!dbBinding) {
      return c.json({
        error: "server_error",
        error_description: "Database binding unavailable",
      }, 500);
    }
    const isValid = await oauthAuthDeps.isAccessTokenValid(
      dbBinding,
      payload.jti,
    );
    if (!isValid) {
      return c.json(
        {
          error: "invalid_token",
          error_description: "Token has been revoked",
        },
        401,
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
      const hasValidAudience = tokenAud.some((aud) =>
        validAudiences.includes(aud)
      );

      if (!hasValidAudience) {
        return c.json(
          {
            error: "invalid_token",
            error_description: "Token audience is not valid for this resource",
          },
          401,
        );
      }
    }

    if (requiredScopes && requiredScopes.length > 0) {
      const tokenScopes = oauthAuthDeps.parseScopes(payload.scope);
      const hasRequiredScopes = requiredScopes.every((required) =>
        tokenScopes.includes(required)
      );

      if (!hasRequiredScopes) {
        return c.json(
          {
            error: "insufficient_scope",
            error_description: `Required scopes: ${requiredScopes.join(" ")}`,
          },
          403,
        );
      }
    }

    const user = await oauthAuthDeps.getCachedUser(c, payload.sub);
    if (!user) {
      return c.json(
        {
          error: "invalid_token",
          error_description: "User not found",
        },
        401,
      );
    }

    c.set("oauth", {
      clientId: payload.client_id,
      scope: payload.scope,
      scopes: oauthAuthDeps.parseScopes(payload.scope),
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

    // OAuth Bearer path — scopes enforced by requireOAuthAuth
    if (c.req.header("Authorization")?.startsWith("Bearer ")) {
      return requireOAuthAuth(requiredScopes)(c, next);
    }

    throw new AuthenticationError("Unauthorized");
  };
}
