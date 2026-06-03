import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import type { Env } from "../../../shared/types/index.ts";
import { getDb, sessions } from "../../../infra/db/index.ts";
import { and, eq, lt, or } from "drizzle-orm";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";

export interface CleanupDeadSessionsSummary {
  markedDead: number;
  cutoffTime: string;
  startupCutoff: string;
  maxAgeCutoff: string;
  heartbeatTimeoutMs: number;
  startupGraceMs: number;
  maxSessionAgeMs: number;
}

export async function cleanupDeadSessions(
  env: Pick<Env, "DB">,
  options?: {
    heartbeatTimeoutMs?: number;
    startupGraceMs?: number;
    maxSessionAgeMs?: number;
  },
  clock: Clock = systemClock,
): Promise<CleanupDeadSessionsSummary> {
  const db = getDb(env.DB);

  const heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? 2 * 60 * 1000; // 2 minutes
  const startupGraceMs = options?.startupGraceMs ?? 30 * 1000; // 30 seconds
  // Absolute lifetime cap for a still-"running" session. No interactive git-mode
  // session legitimately runs this long, so a row older than this is abandoned
  // (the underlying Cloudflare Container is reaped by its own idle timeout; only
  // the DB row leaks). Generous on purpose so an active session is never killed.
  const maxSessionAgeMs = options?.maxSessionAgeMs ?? 24 * 60 * 60 * 1000; // 24 hours

  const nowMs = clock.now();
  const cutoffTime = new Date(nowMs - heartbeatTimeoutMs).toISOString();
  const startupCutoff = new Date(nowMs - startupGraceMs).toISOString();
  const maxAgeCutoff = new Date(nowMs - maxSessionAgeMs).toISOString();
  const timestamp = new Date().toISOString();

  // `sessions.lastHeartbeat` has no writer today (interactive git-mode sessions
  // do not post heartbeats), so a null heartbeat means "liveness not tracked via
  // heartbeat", NOT "dead" — reaping on `isNull(lastHeartbeat)` would mass-kill
  // every running session past the 30s grace. Liveness is therefore enforced by
  // two signals that exist:
  //   1. A heartbeat that was recorded and then went stale (forward-compatible
  //      for re-adding a heartbeat writer over the authenticated runtime proxy).
  //   2. Absolute age past `maxSessionAgeMs` — an abandoned session whose client
  //      never stopped it and whose container is long gone.
  // Both are gated on the startup grace so a just-created session is never reaped.
  const result = await db.update(sessions)
    .set({ status: "dead", updatedAt: timestamp })
    .where(
      and(
        eq(sessions.status, "running"),
        lt(sessions.createdAt, startupCutoff),
        or(
          lt(sessions.lastHeartbeat, cutoffTime),
          lt(sessions.createdAt, maxAgeCutoff),
        ),
      ),
    )
    .run();

  const markedDead = affectedRowCount(result);

  return {
    markedDead,
    cutoffTime,
    startupCutoff,
    maxAgeCutoff,
    heartbeatTimeoutMs,
    startupGraceMs,
    maxSessionAgeMs,
  };
}
