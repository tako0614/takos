import { Hono } from "hono";
import {
  clearSessionCookie,
  deleteSession,
  getSessionIdFromCookie,
} from "../../../application/services/identity/session.ts";
import { recordSessionRevocation } from "../../../application/services/identity/session-revocation.ts";
import { auditLog } from "../../../application/services/identity/auth-utils.ts";
import type { OptionalAuthRouteEnv } from "../route-auth.ts";
import { logError } from "../../../shared/utils/logger.ts";
import { getPlatformServices } from "../../../platform/accessors.ts";

export const authSessionRouter = new Hono<OptionalAuthRouteEnv>();

// POST /auth/logout
//
// SECURITY: This endpoint has no per-route rate limit and relies on the
// operator-tier limiter wired in front of the app (e.g. CDN / WAF). Without
// an upstream limiter, an attacker holding a valid cookie can replay
// `POST /auth/logout` to spam `sessions_revoked` inserts + audit-log
// writes. See SECURITY.md "Per-route rate limiting" for the policy.
//
// Phase 18.2 H11: server-side session revocation. We:
//   1. Insert the session ID into `sessions_revoked` so the auth middleware
//      rejects the cookie immediately on subsequent requests, even if the
//      Durable Object delete below races / fails.
//   2. Best-effort delete the session from the SessionDO.
//   3. Emit `session_logout` audit event.
//   4. Return Set-Cookie: clear so the browser drops the cookie.
authSessionRouter.post("/logout", async (c) => {
  const services = getPlatformServices(c);
  const sessionStore = services.notifications.sessionStore;
  const dbBinding = services.sql?.binding;
  const sessionId = getSessionIdFromCookie(c.req.header("Cookie"));

  if (sessionId) {
    if (dbBinding) {
      try {
        await recordSessionRevocation(dbBinding, {
          sessionId,
          reason: "logout",
        });
      } catch (err) {
        logError("Failed to record session revocation on logout", err, {
          module: "routes/auth/session",
        });
      }
    }
    if (sessionStore) {
      await deleteSession(sessionStore, sessionId);
    }
    await auditLog("session_logout", { sessionId });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookie(),
    },
  });
});
