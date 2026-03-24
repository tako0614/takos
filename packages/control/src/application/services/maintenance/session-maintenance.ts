import type { Env } from '../../../shared/types';
import { getDb, sessions } from '../../../infra/db';
import { and, eq, lt, isNull, or, sql } from 'drizzle-orm';
import { now } from '../../../shared/utils';

export interface CleanupDeadSessionsSummary {
  markedDead: number;
  cutoffTime: string;
  startupCutoff: string;
  heartbeatTimeoutMs: number;
  startupGraceMs: number;
}

export async function cleanupDeadSessions(
  env: Pick<Env, 'DB'>,
  options?: { heartbeatTimeoutMs?: number; startupGraceMs?: number }
): Promise<CleanupDeadSessionsSummary> {
  const db = getDb(env.DB);

  const heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? 2 * 60 * 1000; // 2 minutes
  const startupGraceMs = options?.startupGraceMs ?? 30 * 1000; // 30 seconds

  const cutoffTime = new Date(Date.now() - heartbeatTimeoutMs).toISOString();
  const startupCutoff = new Date(Date.now() - startupGraceMs).toISOString();
  const timestamp = now();

  const result = await db.update(sessions)
    .set({ status: 'dead', updatedAt: timestamp })
    .where(
      and(
        eq(sessions.status, 'running'),
        lt(sessions.createdAt, startupCutoff),
        or(
          isNull(sessions.lastHeartbeat),
          lt(sessions.lastHeartbeat, cutoffTime),
        ),
      )
    )
    .run();

  const markedDead = result.meta.changes ?? 0;

  return {
    markedDead,
    cutoffTime,
    startupCutoff,
    heartbeatTimeoutMs,
    startupGraceMs,
  };
}
