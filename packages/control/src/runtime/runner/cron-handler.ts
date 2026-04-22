// Cron handler: re-enqueue stale running runs whose container crashed.
import type { ScheduledEvent } from "../../shared/types/bindings.ts";
import type { RunnerEnv as Env } from "../../shared/types/index.ts";
import { RUN_QUEUE_MESSAGE_VERSION } from "../../shared/types/index.ts";
import { getDb, runs } from "../../infra/db/index.ts";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

import { logError, logInfo, logWarn } from "../../shared/utils/logger.ts";
import { envGuard, STALE_WORKER_THRESHOLD_MS } from "./runner-constants.ts";

type StaleRun = {
  id: string;
};

async function sendRunQueueMessage(env: Env, runId: string): Promise<void> {
  await env.RUN_QUEUE.send({
    version: RUN_QUEUE_MESSAGE_VERSION,
    runId,
    // model is not stored on the Run record; re-enqueue without it
    // (AgentRunner will fall back to workspace default model)
    timestamp: Date.now(),
    retryCount: 0,
  });
}

export async function reenqueueStaleRunningRuns(
  env: Env,
  staleThreshold: string,
): Promise<void> {
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
        await sendRunQueueMessage(env, run.id);
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
}

export async function reenqueueStaleUnclaimedRuns(
  env: Env,
  staleThreshold: string,
): Promise<void> {
  const db = getDb(env.DB);
  const recoveryHeartbeat = new Date().toISOString();

  const staleRuns = await db.select({
    id: runs.id,
    status: runs.status,
  })
    .from(runs).where(
      and(
        inArray(runs.status, ["pending", "queued"]),
        isNull(runs.serviceId),
        lt(runs.createdAt, staleThreshold),
        or(
          isNull(runs.serviceHeartbeat),
          lt(runs.serviceHeartbeat, staleThreshold),
        ),
      ),
    )
    .limit(50).all() as Array<StaleRun & { status: string }>;

  if (staleRuns.length === 0) return;

  logInfo(
    `Found ${staleRuns.length} stale unclaimed runs, re-enqueuing`,
    { module: "runner_cron" },
  );

  for (const run of staleRuns) {
    // A stale pending/queued run can happen if the queue message was lost
    // after DB creation. Duplicate queue messages are safe: queue handling
    // claims only queued, unowned runs and acks everything else.
    const resetResult = await db.update(runs).set({
      status: "queued",
      serviceId: null,
      serviceHeartbeat: recoveryHeartbeat,
    }).where(
      and(
        eq(runs.id, run.id),
        inArray(runs.status, ["pending", "queued"]),
        isNull(runs.serviceId),
        lt(runs.createdAt, staleThreshold),
        or(
          isNull(runs.serviceHeartbeat),
          lt(runs.serviceHeartbeat, staleThreshold),
        ),
      ),
    );

    if (resetResult.meta.changes > 0) {
      try {
        await sendRunQueueMessage(env, run.id);
        logInfo(
          `Re-enqueued stale ${run.status} run ${run.id} (queue message missing)`,
          { module: "runner_cron" },
        );
      } catch (sendErr) {
        logError(
          `Failed to re-enqueue stale unclaimed run ${run.id}; will retry next cron`,
          sendErr,
          { module: "runner_cron" },
        );
      }
    }
  }
}

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
  await reenqueueStaleRunningRuns(env, staleThreshold);
  await reenqueueStaleUnclaimedRuns(env, staleThreshold);

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
