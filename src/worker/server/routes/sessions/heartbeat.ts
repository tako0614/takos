import { getDb } from "../../../infra/db/index.ts";
import { sessions } from "../../../infra/db/schema.ts";
import { and, eq } from "drizzle-orm";
import { checkSpaceAccess } from "../../../application/services/identity/space-access.ts";
import { HEARTBEAT_TIMEOUT_MS } from "../../../shared/constants/index.ts";
import {
  AuthorizationError,
  BadRequestError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import type { SessionContext } from "./session-mappers.ts";
import { textDateNullable } from "../../../shared/utils/db-guards.ts";

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
  const heartbeatMs = session.lastHeartbeat
    ? new Date(session.lastHeartbeat).getTime()
    : 0;

  const isRunning = session.status === "running";
  // `sessions.lastHeartbeat` currently has no writer — interactive git-mode
  // sessions do not post heartbeats (the old container `/forward/heartbeat`
  // proxy was removed with the internal-marker cleanup). A null/0 heartbeat
  // therefore means "liveness is not tracked via heartbeat for this session",
  // NOT "dead": only a heartbeat that was actually recorded and then went stale
  // is treated as a liveness failure (forward-compatible with re-introducing a
  // real heartbeat writer over the authenticated runtime proxy path).
  const heartbeatRecorded = heartbeatMs > 0;
  const heartbeatTimedOut = heartbeatRecorded &&
    (nowMs - heartbeatMs) >= HEARTBEAT_TIMEOUT_MS;
  const isHealthy = isRunning && !heartbeatTimedOut;

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
    } else if (heartbeatTimedOut) {
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
