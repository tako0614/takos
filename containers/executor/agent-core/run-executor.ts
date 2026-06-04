/**
 * Shared run executor for canonical Control RPC based execution.
 *
 * Used by both takos-executor (container) and private runner integrations.
 * The concrete executeRun implementation is injected via RunExecutorOptions
 * so that this package does not depend on takos-control internals.
 */

import {
  ControlRpcClient,
  createStaticControlRpcTokenSource,
} from "./control-rpc.ts";
import {
  buildCanonicalRemoteExecutionEnv,
  DEFAULT_AGENT_TOTAL_TIMEOUT,
  isNoLlmFallbackAllowed,
  runNoLlmFastPath,
} from "./run-executor-env.ts";
import {
  DEFAULT_MAX_HEARTBEAT_FAILURES,
  startHeartbeatMonitor,
} from "./run-executor-heartbeat.ts";
import {
  ABORT_SETTLE_GRACE_MS,
  fetchCurrentRunStatus,
  sleep,
} from "./run-executor-status.ts";
import {
  createControlRpcRunIo,
  fetchApiKeys,
} from "./control-rpc-io-adapter.ts";

// ---------------------------------------------------------------------------
// Re-exports from split modules (preserve public API surface)
// ---------------------------------------------------------------------------

export {
  buildCanonicalRemoteExecutionEnv,
  buildNoLlmFallbackResponse,
  DEFAULT_AGENT_ITERATION_TIMEOUT,
  DEFAULT_AGENT_TOTAL_TIMEOUT,
  DEFAULT_LANGGRAPH_TIMEOUT,
  DEFAULT_TOOL_EXECUTION_TIMEOUT,
  isNoLlmFallbackAllowed,
  runNoLlmFastPath,
} from "./run-executor-env.ts";

export {
  DEFAULT_MAX_HEARTBEAT_FAILURES,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  markRunFailedFromExecutor,
  startHeartbeatMonitor,
} from "./run-executor-heartbeat.ts";

export {
  ABORT_SETTLE_GRACE_MS,
  fetchCurrentRunStatus,
  isValidRunStatus,
  sleep,
  VALID_RUN_STATUSES,
} from "./run-executor-status.ts";

export {
  createControlRpcRunIo,
  fetchApiKeys,
} from "./control-rpc-io-adapter.ts";

// ---------------------------------------------------------------------------
// --- Public types ---
// ---------------------------------------------------------------------------

// NOTE: Agent RunStatus — intentionally duplicated from takos-control shared/types/models.ts.
// takos-agent-core has no dependency on takos-control, so the type is redefined here to
// keep this package self-contained. If you change the canonical definition in
// packages/control/src/shared/types/models.ts, update this copy to match.
// See also: takos-apps/takos-computer/packages/computer-core/src/shared/types.ts (another copy).
//
// This is NOT the same as the GitHub Actions RunStatus ('queued'|'in_progress'|'completed'|'cancelled')
// defined in packages/actions-engine/src/types.ts — those are different domain concepts.
export type RunStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Whether the run should be reset to queued when the container/executor encounters
 * an error. Only resets if the run is still in 'running' status — terminal states
 * (completed, failed, cancelled) are preserved.
 */
export function shouldResetRunToQueuedOnContainerError(
  status: RunStatus | null | undefined,
): boolean {
  return status === "running";
}

/**
 * Function signature for the agent runner's `executeRun`.
 * Used for dependency injection — callers pass the concrete implementation
 * (resolved from takos-control/agent/public-runner) into agent-core's executor.
 */
export type ExecuteRunFn = (
  env: Record<string, unknown>,
  apiKey: string | undefined,
  runId: string,
  model: string | undefined,
  options: {
    abortSignal?: AbortSignal;
    runIo: unknown;
  },
) => Promise<void>;

// ---------------------------------------------------------------------------

export interface StartPayload {
  runId: string;
  serviceId: string;
  workerId: string;
  model?: string;
  leaseVersion?: number;
  executorTier?: 1 | 2 | 3;
  executorContainerId?: string;
  controlRpcToken?: string;
  controlRpcBaseUrl?: string;
  /** Signal from the server's graceful shutdown — aborts this run early. */
  shutdownSignal?: AbortSignal;
}

export interface RunExecutorOptions {
  /** Service name for log messages (e.g., 'takos-executor', 'private-runner') */
  serviceName: string;
  /** Logger instance */
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  /**
   * Maximum consecutive heartbeat failures before marking run as failed.
   * Default: 10 (10 minutes). External/private runners may want higher values.
   */
  maxHeartbeatFailures?: number;
  /**
   * The agent runner's executeRun function.
   * Injected by the caller so that agent-core does not depend on takos-control internals.
   */
  executeRun: ExecuteRunFn;
  /**
   * Runtime-supplied execution config. Host entry points assemble this from
   * their environment so the shared executor does not read runtime globals.
   */
  runtimeConfig?: RunExecutorRuntimeConfig;
}

export interface RunExecutorExecutionEnv {
  ADMIN_DOMAIN?: string;
  TENANT_BASE_DOMAIN?: string;
  MAX_AGENT_ITERATIONS?: string;
  AGENT_TEMPERATURE?: string;
  AGENT_RATE_LIMIT?: string;
  AGENT_ITERATION_TIMEOUT?: string;
  AGENT_TOTAL_TIMEOUT?: string;
  TOOL_EXECUTION_TIMEOUT?: string;
  LANGGRAPH_TIMEOUT?: string;
  SERPER_API_KEY?: string;
}

export interface RunExecutorRuntimeConfig {
  controlRpcBaseUrl?: string;
  allowNoLlmFallback?: boolean;
  maxRunDurationMs?: number;
  executionEnv?: RunExecutorExecutionEnv;
}

// ---------------------------------------------------------------------------
// --- Main executor ---
// ---------------------------------------------------------------------------

/**
 * Execute a run with the given payload and options.
 * Runs asynchronously (fire-and-forget from the caller's perspective).
 *
 * Canonical path:
 * - Control RPC for lifecycle/state/tool execution
 * - Remote tool execution from the host side
 */
export async function executeRunInContainer(
  payload: StartPayload,
  options: RunExecutorOptions,
): Promise<void> {
  const { runId, serviceId, workerId, model, leaseVersion } = payload;
  const { serviceName, logger } = options;
  const maxHeartbeatFailures = options.maxHeartbeatFailures ??
    DEFAULT_MAX_HEARTBEAT_FAILURES;
  const runtimeConfig = options.runtimeConfig;
  const tag = serviceName;

  const controlToken = payload.controlRpcToken;
  if (!controlToken) {
    throw new Error(`[${tag}] Missing control RPC token for run ${runId}`);
  }
  const controlRpcBaseUrl = runtimeConfig?.controlRpcBaseUrl ||
    payload.controlRpcBaseUrl;
  if (!controlRpcBaseUrl) {
    throw new Error(
      `[${tag}] Missing TAKOS_AGENT_CONTROL_RPC_BASE_URL for run ${runId}`,
    );
  }

  const controlRpc = new ControlRpcClient(
    controlRpcBaseUrl,
    runId,
    createStaticControlRpcTokenSource(controlToken),
    {
      executorTier: payload.executorTier,
      executorContainerId: payload.executorContainerId,
    },
  );
  const runIo = createControlRpcRunIo(controlRpc);

  // Derive run duration limit from the same env var used by AgentRunner
  const maxRunDurationMs = runtimeConfig?.maxRunDurationMs ??
    parseInt(
      runtimeConfig?.executionEnv?.AGENT_TOTAL_TIMEOUT ??
        DEFAULT_AGENT_TOTAL_TIMEOUT,
      10,
    );

  // Fetch API keys from gateway — fail fast if proxy is unreachable
  let apiKeys: { openai?: string; anthropic?: string; google?: string };
  try {
    apiKeys = await fetchApiKeys(controlRpc);
  } catch (err) {
    logger.error(
      `[${tag}] Failed to fetch API keys for run ${runId}, aborting`,
      { error: err },
    );
    try {
      await controlRpc.resetRun({ runId, serviceId, workerId });
    } catch (resetErr) {
      logger.warn(
        `[${tag}] Failed to reset run ${runId} after API key fetch failure (best-effort)`,
        { error: resetErr },
      );
    }
    throw err;
  }

  // Verify at least one LLM key is available
  if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.google) {
    if (isNoLlmFallbackAllowed(runtimeConfig)) {
      logger.warn(
        `[${tag}] No LLM API keys available for run ${runId}; continuing in no-LLM mode`,
      );
      await runNoLlmFastPath(
        controlRpc,
        { runId, serviceId, workerId },
        logger,
        tag,
      );
      return;
    } else {
      const msg = `No LLM API keys available for run ${runId}`;
      logger.error(`[${tag}] ${msg}`);
      try {
        await controlRpc.resetRun({ runId, serviceId, workerId });
      } catch (resetErr) {
        logger.warn(
          `[${tag}] Failed to reset run ${runId} after missing LLM keys (best-effort)`,
          { error: resetErr },
        );
      }
      throw new Error(msg);
    }
  }

  const fakeEnv = buildCanonicalRemoteExecutionEnv(
    apiKeys,
    runtimeConfig?.executionEnv,
  );

  // AbortController for timeout — shared by heartbeat and run
  const abortController = new AbortController();

  // If the server is shutting down, propagate abort to this run
  if (payload.shutdownSignal) {
    if (payload.shutdownSignal.aborted) {
      abortController.abort(payload.shutdownSignal.reason);
    } else {
      payload.shutdownSignal.addEventListener("abort", () => {
        abortController.abort(
          payload.shutdownSignal!.reason ?? new Error("Server shutdown"),
        );
      }, { once: true });
    }
  }

  // Heartbeat: update workerHeartbeat every 60s to prevent stale detection
  const clearHeartbeat = startHeartbeatMonitor({
    controlRpc,
    runId,
    serviceId,
    workerId,
    leaseVersion,
    maxHeartbeatFailures,
    abortController,
    logger,
    tag,
  });

  let runPromise: Promise<void> | null = null;

  try {
    runPromise = options.executeRun(
      fakeEnv,
      apiKeys.openai,
      runId,
      model,
      { abortSignal: abortController.signal, runIo },
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        // Abort immediately — stops heartbeat and signals run to stop
        abortController.abort(new Error("Timeout"));
        reject(
          new Error(
            `Run ${runId} exceeded maximum duration of ${maxRunDurationMs}ms`,
          ),
        );
      }, maxRunDurationMs);
      timer.unref?.();

      // Also abort on signal (e.g., heartbeat failure)
      abortController.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(abortController.signal.reason ?? new Error("Run aborted"));
      }, { once: true });
    });

    await Promise.race([runPromise, timeoutPromise]);

    // Forward run usage metering via the gateway after completion.
    try {
      await controlRpc.recordRunUsage(runId);
    } catch (err) {
      logger.error(`[${tag}] Run usage recording failed for run ${runId}`, {
        error: err,
      });
    }
  } catch (err) {
    logger.error(`[${tag}] Run ${runId} failed`, { error: err });

    // Wait for the aborting AgentRunner to settle before checking status
    if (abortController.signal.aborted && runPromise) {
      await Promise.race([
        runPromise.catch((settleErr) => {
          logger.warn(
            `[${tag}] Run promise settled with error during abort grace period`,
            { error: settleErr },
          );
        }),
        sleep(ABORT_SETTLE_GRACE_MS),
      ]);
    }

    const currentStatus = await fetchCurrentRunStatus(
      controlRpc,
      runId,
      logger,
      tag,
    );
    if (!shouldResetRunToQueuedOnContainerError(currentStatus)) {
      logger.warn(
        `[${tag}] Preserving run ${runId} status ${
          currentStatus ?? "unknown"
        } after error`,
      );
      return;
    }

    // Reset only non-terminal runs for stale recovery.
    try {
      await controlRpc.resetRun({ runId, serviceId, workerId });
    } catch (resetErr) {
      logger.error(`[${tag}] Failed to reset run ${runId}`, {
        error: resetErr,
      });
    }
  } finally {
    // Always clear heartbeat and abort controller
    clearHeartbeat();
    if (!abortController.signal.aborted) {
      abortController.abort(new Error("Run finished"));
    }
  }
}
