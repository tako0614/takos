/**
 * Run status utilities.
 *
 * Validation, fetching, and general helpers related to run lifecycle status.
 */

import type { ControlRpcClient } from "./control-rpc.ts";
import type { RunExecutorOptions, RunStatus } from "./run-executor.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ABORT_SETTLE_GRACE_MS = 5_000;

// ---------------------------------------------------------------------------
// Status validation
// ---------------------------------------------------------------------------

export const VALID_RUN_STATUSES: ReadonlySet<string> = new Set<RunStatus>([
  "pending",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export function isValidRunStatus(status: string): status is RunStatus {
  return VALID_RUN_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Status fetching
// ---------------------------------------------------------------------------

export async function fetchCurrentRunStatus(
  controlRpc: ControlRpcClient,
  runId: string,
  logger: RunExecutorOptions["logger"],
  tag: string,
): Promise<RunStatus | null> {
  try {
    const status = await controlRpc.getRunStatus(runId);
    return status != null && isValidRunStatus(status) ? status : null;
  } catch (statusError) {
    logger.error(`[${tag}] Failed to load run status for ${runId}`, {
      error: statusError,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// General helpers
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
