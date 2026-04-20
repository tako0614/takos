// Cron handler: re-enqueue stale running runs whose container crashed.
import type { ScheduledEvent } from "../../shared/types/bindings.ts";
import type { RunnerEnv as Env } from "../../shared/types/index.ts";
import { RUN_QUEUE_MESSAGE_VERSION } from "../../shared/types/index.ts";
import { getDb, runs } from "../../infra/db/index.ts";
import { and, eq, lt } from "drizzle-orm";

import { logError, logInfo, logWarn } from "../../shared/utils/logger.ts";
import { envGuard, STALE_WORKER_THRESHOLD_MS } from "./runner-constants.ts";

export async function handleScheduled(
  _event: ScheduledEvent,
  env: Env,
): Promise<void> {
  // Validate environment on first invocation (cached).
  const envError = envGuard(env);
  if (envError) {
    return;
  }

  if (!env.EXECUTOR_HOST) {
    logError(
      "EXECUTOR_HOST binding is missing; stale run recovery is disabled",
      undefined,
      { module: "runner_cron" },
    );
    return;
  }

  const staleThreshold = new Date(Date.now() - STALE_WORKER_THRESHOLD_MS)
    .toISOString();
  const db = getDb(env.DB);

  const staleRuns = await db.select({ id: runs.id })
    .from(runs).where(
      and(
        eq(runs.status, "running"),
        lt(runs.serviceHeartbeat, staleThreshold),
      ),
    )
    .limit(50).all();

  if (staleRuns.length === 0) return;

  logInfo(`Found ${staleRuns.length} stale running runs, re-enqueuing`, {
    module: "runner_cron",
  });

  for (const run of staleRuns) {
    // Atomically reset status to queued (only if still running and stale)
    const resetResult = await db.update(runs).set({
      status: "queued",
      serviceId: null,
      serviceHeartbeat: null,
    }).where(
      and(
        eq(runs.id, run.id),
        eq(runs.status, "running"),
        lt(runs.serviceHeartbeat, staleThreshold),
      ),
    );

    if (resetResult.meta.changes > 0) {
      try {
        await env.RUN_QUEUE.send({
          version: RUN_QUEUE_MESSAGE_VERSION,
          runId: run.id,
          // model is not stored on the Run record; re-enqueue without it
          // (AgentRunner will fall back to workspace default model)
          timestamp: Date.now(),
          retryCount: 0,
        });
        logInfo(`Re-enqueued stale run ${run.id} (previous worker timed out)`, {
          module: "runner_cron",
        });
      } catch (sendErr) {
        // Queue send failed — revert status back to 'running' so cron retries next cycle (#7)
        logError(
          `Failed to re-enqueue run ${run.id}, reverting to running for retry`,
          sendErr,
          { module: "runner_cron" },
        );
        try {
          await db.update(runs).set({
            status: "running",
            serviceHeartbeat: new Date(0).toISOString(), // Keep stale so cron picks it up again
          }).where(and(eq(runs.id, run.id), eq(runs.status, "queued")));
        } catch (revertErr) {
          logError(
            `Failed to revert run ${run.id} after queue send failure`,
            revertErr,
            { module: "runner_cron" },
          );
        }
      }
    }
  }

  // Clean up old tool_operations records (24h retention)
  try {
    const { cleanupStaleOperations } = await import(
      "../../application/tools/idempotency.ts"
    );
    const cleaned = await cleanupStaleOperations(env.DB);
    if (cleaned > 0) {
      logInfo(`Cleaned ${cleaned} stale tool_operations records`, {
        module: "runner_cron",
      });
    }
  } catch (cleanupErr) {
    logWarn(`Failed to clean up tool_operations`, {
      module: "runner_cron",
      detail: cleanupErr,
    });
  }
}
