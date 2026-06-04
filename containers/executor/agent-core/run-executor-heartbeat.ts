/**
 * Heartbeat management for run execution.
 *
 * Sends periodic heartbeats to the Control RPC server to prevent stale
 * detection, and marks runs as failed when the heartbeat is lost.
 */

import type { ControlRpcClient } from "./control-rpc.ts";
import type { RunExecutorOptions } from "./run-executor.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HEARTBEAT_INTERVAL_MS = 60_000;
export const DEFAULT_MAX_HEARTBEAT_FAILURES = 10;
export const HEARTBEAT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export async function markRunFailedFromExecutor(
  controlRpc: ControlRpcClient,
  payload: {
    runId: string;
    serviceId: string;
    workerId: string;
    leaseVersion?: number;
    error: string;
  },
  logger: RunExecutorOptions["logger"],
  tag: string,
): Promise<void> {
  try {
    await controlRpc.failRun(payload);
  } catch (markErr) {
    logger.error(
      `[${tag}] Failed to mark run ${payload.runId} as failed after heartbeat loss`,
      { error: markErr },
    );
  }
}

// ---------------------------------------------------------------------------
// Heartbeat monitor
// ---------------------------------------------------------------------------

export interface HeartbeatMonitorParams {
  controlRpc: ControlRpcClient;
  runId: string;
  serviceId: string;
  workerId: string;
  leaseVersion?: number;
  maxHeartbeatFailures: number;
  abortController: AbortController;
  logger: RunExecutorOptions["logger"];
  tag: string;
}

/**
 * Start the heartbeat interval.
 *
 * Returns a cleanup function that clears the interval. The heartbeat will
 * also self-clear when the abort controller fires or when max failures
 * are exceeded.
 */
export function startHeartbeatMonitor(
  params: HeartbeatMonitorParams,
): () => void {
  const {
    controlRpc,
    runId,
    serviceId,
    workerId,
    leaseVersion,
    maxHeartbeatFailures,
    abortController,
    logger,
    tag,
  } = params;

  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let consecutiveFailures = 0;
  let nextLogAt = 1; // Exponential backoff: log at 1, 2, 4, 8...

  function clearHeartbeat(): void {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  heartbeatInterval = setInterval(async () => {
    if (abortController.signal.aborted) {
      clearHeartbeat();
      return;
    }

    try {
      await controlRpc.heartbeat(
        { runId, serviceId, workerId, leaseVersion },
        HEARTBEAT_TIMEOUT_MS,
      );
      consecutiveFailures = 0;
      nextLogAt = 1;
      return;
    } catch (err) {
      await handleHeartbeatFailure(err);
    }

    async function handleHeartbeatFailure(err: unknown): Promise<void> {
      const isLeaseLost = err instanceof Error &&
        (err.message.includes("409") || err.message.includes("Lease lost"));
      if (isLeaseLost) {
        logger.error(`[${tag}] Lease lost for run ${runId}, aborting`);
        clearHeartbeat();
        abortController.abort(new Error("Lease lost"));
        return;
      }

      consecutiveFailures++;
      const shouldLog = consecutiveFailures >= nextLogAt ||
        consecutiveFailures >= maxHeartbeatFailures;
      if (shouldLog) {
        logger.error(
          `[${tag}] Heartbeat failed for run ${runId} (${consecutiveFailures}/${maxHeartbeatFailures})`,
          { error: err },
        );
        nextLogAt = Math.min(nextLogAt * 2, maxHeartbeatFailures);
      }

      if (consecutiveFailures < maxHeartbeatFailures) return;

      logger.error(
        `[${tag}] Too many heartbeat failures for run ${runId}, marking as failed`,
      );
      clearHeartbeat();
      await markRunFailedFromExecutor(
        controlRpc,
        {
          runId,
          serviceId,
          workerId,
          leaseVersion,
          error: "Heartbeat lost — executor marked run as failed",
        },
        logger,
        tag,
      );
      abortController.abort(new Error("Heartbeat lost"));
    }
  }, HEARTBEAT_INTERVAL_MS);

  return clearHeartbeat;
}
