import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import type { Env } from "../../../shared/types/index.ts";
import { getDb, sessions } from "../../../infra/db/index.ts";
import { and, eq, lt } from "drizzle-orm";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";

export interface CleanupDeadSessionsSummary {
  markedDead: number;
  cutoffTime: string;
  startupCutoff: string;
  heartbeatTimeoutMs: number;
  startupGraceMs: number;
}

export async function cleanupDeadSessions(
  env: Pick<Env, "DB">,
  options?: { heartbeatTimeoutMs?: number; startupGraceMs?: number },
  clock: Clock = systemClock,
): Promise<CleanupDeadSessionsSummary> {
  const db = getDb(env.DB);

  const heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? 2 * 60 * 1000; // 2 minutes
  const startupGraceMs = options?.startupGraceMs ?? 30 * 1000; // 30 seconds

  const nowMs = clock.now();
  const cutoffTime = new Date(nowMs - heartbeatTimeoutMs).toISOString();
  const startupCutoff = new Date(nowMs - startupGraceMs).toISOString();
  const timestamp = new Date().toISOString();

  // `sessions.lastHeartbeat` currently has no writer (interactive git-mode
  // sessions do not post heartbeats), so a null heartbeat means "liveness not
  // tracked via heartbeat" rather than "dead". Reaping on `isNull(lastHeartbeat)`
  // would mass-kill every still-running session past the startup grace; instead
  // we only reap sessions that recorded a heartbeat and then went stale. With no
  // writer this reaps nothing today — abandoned sessions are cleaned up by
  // explicit stop/discard and the SessionDO alarm. Re-adding a heartbeat writer
  // (over the authenticated runtime proxy path) re-enables stale-session reaping.
  const result = await db.update(sessions)
    .set({ status: "dead", updatedAt: timestamp })
    .where(
      and(
        eq(sessions.status, "running"),
        lt(sessions.createdAt, startupCutoff),
        lt(sessions.lastHeartbeat, cutoffTime),
      ),
    )
    .run();

  const markedDead = affectedRowCount(result);

  return {
    markedDead,
    cutoffTime,
    startupCutoff,
    heartbeatTimeoutMs,
    startupGraceMs,
  };
}
