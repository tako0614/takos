import { getDb } from '../../../infra/db';
import { sessions } from '../../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { checkWorkspaceAccess, now, toIsoString } from '../../../shared/utils';
import { ERR, HEARTBEAT_TIMEOUT_MS, STARTUP_GRACE_MS } from '../../../shared/constants';
import { badRequest, forbidden, notFound } from '../../../shared/utils/error-response';
import type {
  JwtHeartbeatPayload,
  SessionContext,
} from './shared';

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function heartbeatSession(
  c: SessionContext,
  jwtPayload?: JwtHeartbeatPayload,
): Promise<Response> {
  const sessionId = c.req.param('sessionId');
  if (!sessionId) return badRequest(c, 'Missing sessionId');
  const db = getDb(c.env.DB);

  if (jwtPayload?.session_id && jwtPayload.session_id !== sessionId) {
    return forbidden(c, 'Forbidden: session_id mismatch');
  }

  const headerSessionId = c.req.header('X-Takos-Session-Id');
  if (headerSessionId && headerSessionId !== sessionId) {
    return forbidden(c, 'Forbidden: session_id header mismatch');
  }

  const session = await db.select({
    id: sessions.id,
    accountId: sessions.accountId,
    status: sessions.status,
    createdAt: sessions.createdAt,
  }).from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!session) {
    return notFound(c, 'Session');
  }

  if (jwtPayload?.space_id && jwtPayload.space_id !== session.accountId) {
    return forbidden(c, 'Forbidden: space_id mismatch');
  }

  const sessionAge = Date.now() - new Date(session.createdAt).getTime();
  if (sessionAge > SESSION_MAX_AGE_MS) {
    await db.update(sessions).set({ status: 'dead', updatedAt: now() }).where(
      and(eq(sessions.id, sessionId), eq(sessions.status, 'running'))
    );
    return badRequest(c, 'Session expired: exceeded maximum age');
  }

  if (session.status !== 'running') {
    return badRequest(c, 'Session is not running');
  }

  const timestamp = now();
  await db.update(sessions).set({ lastHeartbeat: timestamp, updatedAt: timestamp }).where(eq(sessions.id, sessionId));

  return c.json({ success: true, timestamp });
}

export async function getSessionHealth(c: SessionContext): Promise<Response> {
  const user = c.get('user');
  const sessionId = c.req.param('sessionId');
  if (!sessionId) return badRequest(c, 'Missing sessionId');
  const db = getDb(c.env.DB);
  const session = await db.select({
    id: sessions.id,
    accountId: sessions.accountId,
    status: sessions.status,
    lastHeartbeat: sessions.lastHeartbeat,
    createdAt: sessions.createdAt,
  }).from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!session) {
    return notFound(c, 'Session');
  }

  const access = await checkWorkspaceAccess(c.env.DB, session.accountId, user.id);
  if (!access) {
    return forbidden(c, 'Permission denied');
  }

  const nowMs = Date.now();
  const createdMs = new Date(session.createdAt).getTime();
  const heartbeatMs = session.lastHeartbeat ? new Date(session.lastHeartbeat).getTime() : 0;

  const isRunning = session.status === 'running';
  const isNewSession = (nowMs - createdMs) < STARTUP_GRACE_MS;
  const hasRecentHeartbeat = heartbeatMs > 0 && (nowMs - heartbeatMs) < HEARTBEAT_TIMEOUT_MS;
  const isHealthy = isRunning && (isNewSession || hasRecentHeartbeat);

  if (!isHealthy && session.status === 'running') {
    await db.update(sessions).set({ status: 'dead', updatedAt: now() }).where(
      and(eq(sessions.id, sessionId), eq(sessions.status, 'running'))
    );
  }

  let reason: string | undefined;
  if (!isHealthy) {
    if (!isRunning) {
      reason = 'not_running';
    } else if (!isNewSession && !hasRecentHeartbeat) {
      reason = 'heartbeat_timeout';
    } else {
      reason = 'unknown';
    }
  }

  return c.json({
    session_id: sessionId,
    status: session.status,
    is_healthy: isHealthy,
    last_heartbeat: toIsoString(session.lastHeartbeat),
    created_at: toIsoString(session.createdAt) ?? new Date(0).toISOString(),
    reason,
  });
}
