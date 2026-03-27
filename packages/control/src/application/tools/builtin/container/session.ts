import type { ToolContext } from '../../types';
import type { D1Database } from '../../../../shared/types/bindings.ts';
import { getDb, sessions } from '../../../../infra/db';
import { eq } from 'drizzle-orm';
import { callRuntimeRequest } from '../../../services/execution/runtime-request-handler';
import { toIsoString } from '../../../../shared/utils';
import { HEARTBEAT_TIMEOUT_MS, STARTUP_GRACE_MS } from '../../../../shared/constants';

export async function callSessionApi(
  context: ToolContext,
  endpoint: string,
  body: Record<string, unknown> = {},
  timeoutMs: number = 30000
): Promise<Response> {
  if (!context.env.RUNTIME_HOST) {
    throw new Error('RUNTIME_HOST binding is required');
  }

  return callRuntimeRequest(context.env, endpoint, {
    method: 'POST',
    body: {
      session_id: context.sessionId,
      space_id: context.spaceId,
      ...body,
    },
    timeoutMs,
    signal: context.abortSignal,
  });
}

export interface SessionHealth {
  isHealthy: boolean;
  session: {
    id: string;
    status: string;
    last_heartbeat: string | null;
    created_at: string;
  } | null;
  reason?: string;
}

export async function checkSessionHealth(
  db: D1Database,
  sessionId: string
): Promise<SessionHealth> {
  const drizzle = getDb(db);
  const sessionResult = await drizzle.select({
    id: sessions.id,
    status: sessions.status,
    lastHeartbeat: sessions.lastHeartbeat,
    createdAt: sessions.createdAt,
  }).from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!sessionResult) {
    return { isHealthy: false, session: null, reason: 'session_not_found' };
  }

  const session = {
    id: sessionResult.id,
    status: sessionResult.status,
    last_heartbeat: toIsoString(sessionResult.lastHeartbeat),
    created_at: toIsoString(sessionResult.createdAt) ?? new Date(0).toISOString(),
  };

  if (session.status !== 'running') {
    return { isHealthy: false, session, reason: 'session_not_running' };
  }

  const now = Date.now();
  const createdAt = new Date(session.created_at).getTime();
  const lastHeartbeat = session.last_heartbeat ? new Date(session.last_heartbeat).getTime() : null;

  if (!lastHeartbeat) {
    if (now - createdAt < STARTUP_GRACE_MS) {
      return { isHealthy: true, session };
    }
    return { isHealthy: false, session, reason: 'heartbeat_timeout' };
  }

  if (now - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
    return { isHealthy: false, session, reason: 'session_dead' };
  }

  return { isHealthy: true, session };
}

export function validateStringInput(
  value: unknown,
  fieldName: string
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

export function normalizeMountPath(value: unknown): string {
  const raw = validateStringInput(value, 'mount_path');
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (normalized.includes('..')) {
    throw new Error('mount_path cannot contain ".."');
  }
  if (normalized === '.') return '';
  return normalized;
}
