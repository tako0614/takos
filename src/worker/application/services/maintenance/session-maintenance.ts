import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import type { Env } from "../../../shared/types/index.ts";
import { getDb, sessions } from "../../../infra/db/index.ts";
import { and, eq, isNull, lt, or } from "drizzle-orm";
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

  const result = await db.update(sessions)
    .set({ status: "dead", updatedAt: timestamp })
    .where(
      and(
        eq(sessions.status, "running"),
        lt(sessions.createdAt, startupCutoff),
        or(
          isNull(sessions.lastHeartbeat),
          lt(sessions.lastHeartbeat, cutoffTime),
        ),
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
