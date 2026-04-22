import { getDb } from "../../../infra/db/index.ts";
import { sessions } from "../../../infra/db/schema.ts";
import { and, eq } from "drizzle-orm";
import { checkSpaceAccess } from "../../../application/services/identity/space-access.ts";
import {
  HEARTBEAT_TIMEOUT_MS,
  STARTUP_GRACE_MS,
} from "../../../shared/constants/index.ts";
import {
  AuthorizationError,
  BadRequestError,
  NotFoundError,
} from "takos-common/errors";
import type { JwtHeartbeatPayload, SessionContext } from "./session-mappers.ts";
import { textDateNullable } from "../../../shared/utils/db-guards.ts";

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function heartbeatSession(
  c: SessionContext,
  jwtPayload?: JwtHeartbeatPayload,
): Promise<Response> {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) throw new BadRequestError("Missing sessionId");
  const db = getDb(c.env.DB);

  if (jwtPayload?.session_id && jwtPayload.session_id !== sessionId) {
    throw new AuthorizationError("Forbidden: session_id mismatch");
  }

  const headerSessionId = c.req.header("X-Takos-Session-Id");
  if (headerSessionId && headerSessionId !== sessionId) {
    throw new AuthorizationError("Forbidden: session_id header mismatch");
  }

  const session = await db.select({
    id: sessions.id,
    accountId: sessions.accountId,
    status: sessions.status,
    createdAt: sessions.createdAt,
  }).from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!session) {
    throw new NotFoundError("Session");
  }

  if (jwtPayload?.space_id && jwtPayload.space_id !== session.accountId) {
    throw new AuthorizationError("Forbidden: space_id mismatch");
  }

  const sessionAge = Date.now() - new Date(session.createdAt).getTime();
  if (sessionAge > SESSION_MAX_AGE_MS) {
    await db.update(sessions).set({
      status: "dead",
      updatedAt: new Date().toISOString(),
    }).where(
      and(eq(sessions.id, sessionId), eq(sessions.status, "running")),
    );
    throw new BadRequestError("Session expired: exceeded maximum age");
  }

  if (session.status !== "running") {
    throw new BadRequestError("Session is not running");
  }

  const timestamp = new Date().toISOString();
  await db.update(sessions).set({
    lastHeartbeat: timestamp,
    updatedAt: timestamp,
  }).where(eq(sessions.id, sessionId));

  return c.json({ success: true, timestamp });
}

export async function getSessionHealth(c: SessionContext): Promise<Response> {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");
  if (!sessionId) throw new BadRequestError("Missing sessionId");
  const db = getDb(c.env.DB);
  const session = await db.select({
    id: sessions.id,
    accountId: sessions.accountId,
    status: sessions.status,
    lastHeartbeat: sessions.lastHeartbeat,
    createdAt: sessions.createdAt,
  }).from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!session) {
    throw new NotFoundError("Session");
  }

  const access = await checkSpaceAccess(c.env.DB, session.accountId, user.id);
  if (!access) {
    throw new AuthorizationError("Permission denied");
  }

  const nowMs = Date.now();
  const createdMs = new Date(session.createdAt).getTime();
  const heartbeatMs = session.lastHeartbeat
    ? new Date(session.lastHeartbeat).getTime()
    : 0;

  const isRunning = session.status === "running";
  const isNewSession = (nowMs - createdMs) < STARTUP_GRACE_MS;
  const hasRecentHeartbeat = heartbeatMs > 0 &&
    (nowMs - heartbeatMs) < HEARTBEAT_TIMEOUT_MS;
  const isHealthy = isRunning && (isNewSession || hasRecentHeartbeat);

  if (!isHealthy && session.status === "running") {
    await db.update(sessions).set({
      status: "dead",
      updatedAt: new Date().toISOString(),
    }).where(
      and(eq(sessions.id, sessionId), eq(sessions.status, "running")),
    );
  }

  let reason: string | undefined;
  if (!isHealthy) {
    if (!isRunning) {
      reason = "not_running";
    } else if (!isNewSession && !hasRecentHeartbeat) {
      reason = "heartbeat_timeout";
    } else {
      reason = "unknown";
    }
  }

  return c.json({
    session_id: sessionId,
    status: session.status,
    is_healthy: isHealthy,
    last_heartbeat: textDateNullable(session.lastHeartbeat),
    created_at: textDateNullable(session.createdAt) ??
      new Date(0).toISOString(),
    reason,
  });
}
