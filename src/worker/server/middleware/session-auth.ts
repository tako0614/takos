import type { Context } from "hono";
import type { Env, Session, User } from "../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../shared/types/bindings.ts";
import type { getSession } from "../../application/services/identity/session.ts";
import type { isSessionRevoked } from "../../application/services/identity/session-revocation.ts";
import type {
  getCachedUser,
  isValidUserId,
} from "../../application/services/identity/user-cache.ts";

/**
 * Sentinel for the revocation-invariant failure. `resolveCookieSession`
 * returns this (rather than throwing) so each caller decides whether a revoked
 * session id is fatal (`requireAuth`/`requireAnyAuth`) or silently ignored
 * (`optionalAuth`). Callers must surface it as an authentication failure when
 * rejecting sessions — never treat it as "anonymous".
 */
export type SessionResolution =
  /** Session record absent or its `user_id` is not a valid id. */
  | { kind: "no-session" }
  /** Session valid but the resolved user has no cached record. */
  | { kind: "user-not-found" }
  /**
   * Phase 18.2 H11: the session id is on the server-side revocation blacklist.
   * This is the primary defense against post-logout / post-rotation replay and
   * MUST be rejected by any caller that gates access on the cookie session.
   */
  | { kind: "revoked" }
  /** Session and cached user both resolved. */
  | { kind: "ok"; user: User; session: Session };

/**
 * Dependency seam shared by `authDeps` / `oauthAuthDeps`. Reading through the
 * passed object (not module bindings) keeps test overrides effective.
 */
export interface CookieSessionResolverDeps {
  getSession: typeof getSession;
  isSessionRevoked: typeof isSessionRevoked;
  getCachedUser: typeof getCachedUser;
  isValidUserId: typeof isValidUserId;
}

/**
 * Single-sourced cookie-session resolution carrying the Phase 18.2 H11
 * revocation invariant: a `sessions_revoked` hit is reported as `revoked`
 * (fail-closed at the caller), and only an active session whose user resolves
 * yields `ok`. Session rotation is intentionally NOT done here — `requireAuth`
 * layers rotation on top of an `ok` result; `requireAnyAuth` does not rotate.
 *
 * The `dbBinding`-guard preserves prior behavior: when no SQL binding is
 * configured the revocation check is skipped (there is no blacklist to read).
 */
export async function resolveCookieSession<TVariables extends object>(
  c: Context<{ Bindings: Env; Variables: TVariables }>,
  deps: CookieSessionResolverDeps,
  input: {
    sessionId: string;
    sessionStore: NonNullable<unknown>;
    dbBinding: SqlDatabaseBinding | undefined;
  },
): Promise<SessionResolution> {
  if (input.dbBinding) {
    const revoked = await deps.isSessionRevoked(
      input.dbBinding,
      input.sessionId,
    );
    if (revoked) return { kind: "revoked" };
  }

  const session = await deps.getSession(
    input.sessionStore as Parameters<typeof getSession>[0],
    input.sessionId,
  );
  if (!session || !deps.isValidUserId(session.user_id)) {
    return { kind: "no-session" };
  }

  const user = await deps.getCachedUser(c, session.user_id);
  if (!user) return { kind: "user-not-found" };

  return { kind: "ok", user, session: session as Session };
}
