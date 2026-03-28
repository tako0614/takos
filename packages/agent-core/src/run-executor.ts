/**
 * Shared run executor for canonical Control RPC based execution.
 *
 * Used by both takos-executor (container) and private runner integrations.
 * The concrete executeRun implementation is injected via RunExecutorOptions
 * so that this package does not depend on takos-control internals.
 */

import { ControlRpcClient, createStaticControlRpcTokenSource } from './control-rpc.js';

// ---------------------------------------------------------------------------
// --- Run lifecycle utilities ---
// Pure functions that don't depend on takos-control internals.
// ---------------------------------------------------------------------------

// NOTE: Agent RunStatus — intentionally duplicated from takos-control shared/types/models.ts.
// takos-agent-core has no dependency on takos-control, so the type is redefined here to
// keep this package self-contained. If you change the canonical definition in
// packages/control/src/shared/types/models.ts, update this copy to match.
// See also: takos-computer/packages/computer-core/src/shared/types.ts (another copy).
//
// This is NOT the same as the GitHub Actions RunStatus ('queued'|'in_progress'|'completed'|'cancelled')
// defined in packages/actions-engine/src/types.ts — those are different domain concepts.
export type RunStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Whether the run should be reset to queued when the container/executor encounters
 * an error. Only resets if the run is still in 'running' status — terminal states
 * (completed, failed, cancelled) are preserved.
 */
export function shouldResetRunToQueuedOnContainerError(
  status: RunStatus | null | undefined,
): boolean {
  return status === 'running';
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
  serviceId?: string;
  workerId: string;
  model?: string;
  leaseVersion?: number;
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
   * their environment so the shared executor does not read process.env.
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

const HEARTBEAT_INTERVAL_MS = 60_000;
const DEFAULT_MAX_HEARTBEAT_FAILURES = 10;
const HEARTBEAT_TIMEOUT_MS = 15_000;
const ABORT_SETTLE_GRACE_MS = 5_000;

function buildNoLlmFallbackResponse(query: string): string {
  return `I understand you're asking about: "${query}"\n\n`
    + `I'm an AI agent that can help you with:\n`
    + `- Reading and writing files\n`
    + `- Searching your workspace\n`
    + `- Deploying workers\n`
    + `- Running build commands\n`
    + `- Working with repositories and containers\n`
    + `- Remembering information\n`
    + `- Creating code and documentation\n\n`
    + `Try asking me to "list files" or "read file 'path/to/file'".\n\n`
    + `Note: LLM API key not configured. Running in limited mode.`;
}

async function runNoLlmFastPath(
  controlRpc: ControlRpcClient,
  payload: Pick<StartPayload, 'runId' | 'workerId' | 'serviceId'>,
  logger: RunExecutorOptions['logger'],
  tag: string,
): Promise<void> {
  const context = await controlRpc.getRunContext(payload.runId);
  const query = context.lastUserMessage || 'No message provided';
  const response = buildNoLlmFallbackResponse(query);
  logger.info(`[${tag}] Completing run ${payload.runId} via no-LLM fast path`);
  await controlRpc.completeNoLlmRun({
    runId: payload.runId,
    serviceId: payload.serviceId ?? payload.workerId,
    workerId: payload.workerId,
    response,
  });
}

function isNoLlmFallbackAllowed(runtimeConfig?: RunExecutorRuntimeConfig): boolean {
  return runtimeConfig?.allowNoLlmFallback === true;
}

function buildCanonicalRemoteExecutionEnv(apiKeys: {
  openai?: string;
  anthropic?: string;
  google?: string;
}, executionEnv?: RunExecutorExecutionEnv): Record<string, unknown> {
  return {
    OPENAI_API_KEY: apiKeys.openai,
    ANTHROPIC_API_KEY: apiKeys.anthropic,
    GOOGLE_API_KEY: apiKeys.google,
    ADMIN_DOMAIN: executionEnv?.ADMIN_DOMAIN,
    TENANT_BASE_DOMAIN: executionEnv?.TENANT_BASE_DOMAIN,
    MAX_AGENT_ITERATIONS: executionEnv?.MAX_AGENT_ITERATIONS,
    AGENT_TEMPERATURE: executionEnv?.AGENT_TEMPERATURE,
    AGENT_RATE_LIMIT: executionEnv?.AGENT_RATE_LIMIT,
    AGENT_ITERATION_TIMEOUT: executionEnv?.AGENT_ITERATION_TIMEOUT ?? '120000',
    AGENT_TOTAL_TIMEOUT: executionEnv?.AGENT_TOTAL_TIMEOUT ?? '86400000',
    TOOL_EXECUTION_TIMEOUT: executionEnv?.TOOL_EXECUTION_TIMEOUT ?? '300000',
    LANGGRAPH_TIMEOUT: executionEnv?.LANGGRAPH_TIMEOUT ?? '86400000',
    SERPER_API_KEY: executionEnv?.SERPER_API_KEY,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCurrentRunStatus(
  controlRpc: ControlRpcClient,
  runId: string,
  logger: RunExecutorOptions['logger'],
  tag: string,
): Promise<RunStatus | null> {
  try {
    const status = await controlRpc.getRunStatus(runId);

    return status === 'pending'
      || status === 'queued'
      || status === 'running'
      || status === 'completed'
      || status === 'failed'
      || status === 'cancelled'
      ? status
      : null;
  } catch (statusError) {
    logger.error(`[${tag}] Failed to load run status for ${runId}`, { error: statusError });
    return null;
  }
}

async function markRunFailedFromExecutor(
  controlRpc: ControlRpcClient,
  payload: {
    runId: string;
    serviceId?: string;
    workerId?: string;
    leaseVersion?: number;
    error: string;
  },
  logger: RunExecutorOptions['logger'],
  tag: string,
): Promise<void> {
  try {
    await controlRpc.failRun(payload);
  } catch (markErr) {
    logger.error(`[${tag}] Failed to mark run ${payload.runId} as failed after heartbeat loss`, { error: markErr });
  }
}

/** Fetch API keys from the gateway Worker proxy (keys never travel in the dispatch payload). */
async function fetchApiKeys(controlRpc: ControlRpcClient): Promise<{
  openai?: string;
  anthropic?: string;
  google?: string;
}> {
  return controlRpc.fetchApiKeys();
}

/**
 * Adapt a ControlRpcClient to the runIo interface expected by AgentRunner.
 *
 * Most methods are pure passthroughs. The handful that differ just unwrap
 * `{ runId }` into a plain string because ControlRpcClient takes `runId: string`
 * while AgentRunnerIo consistently uses `{ runId: string }` input objects.
 */
function createControlRpcRunIo(controlRpc: ControlRpcClient) {
  return {
    // --- Methods that unwrap { runId } → plain string ---
    getRunBootstrap: (input: { runId: string }) => controlRpc.getRunBootstrap(input.runId),
    getRunRecord: (input: { runId: string }) => controlRpc.getRunRecord(input.runId),
    getRunStatus: (input: { runId: string }) => controlRpc.getRunStatus(input.runId),
    isCancelled: (input: { runId: string }) => controlRpc.isCancelled(input.runId),
    getToolCatalog: (input: { runId: string }) => controlRpc.getToolCatalog(input.runId),
    cleanupToolExecutor: (input: { runId: string }) => controlRpc.cleanupToolExecutor(input.runId),

    // --- Pure passthroughs (input shape matches ControlRpcClient) ---
    getConversationHistory: (input: Parameters<ControlRpcClient['getConversationHistory']>[0]) => controlRpc.getConversationHistory(input),
    resolveSkillPlan: (input: Parameters<ControlRpcClient['resolveSkillPlan']>[0]) => controlRpc.resolveSkillPlan(input),
    getMemoryActivation: (input: Parameters<ControlRpcClient['getMemoryActivation']>[0]) => controlRpc.getMemoryActivation(input),
    finalizeMemoryOverlay: (input: Parameters<ControlRpcClient['finalizeMemoryOverlay']>[0]) => controlRpc.finalizeMemoryOverlay(input),
    addMessage: (input: Parameters<ControlRpcClient['addMessage']>[0]) => controlRpc.addMessage(input),
    updateRunStatus: (input: Parameters<ControlRpcClient['updateRunStatus']>[0]) => controlRpc.updateRunStatus(input),
    getCurrentSessionId: (input: Parameters<ControlRpcClient['getCurrentSessionId']>[0]) => controlRpc.getCurrentSessionId(input),
    executeTool: (input: Parameters<ControlRpcClient['executeTool']>[0]) => controlRpc.executeTool(input),
    emitRunEvent: (input: Parameters<ControlRpcClient['emitRunEvent']>[0]) => controlRpc.emitRunEvent(input),
  };
}

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
  const { runId, workerId, model, leaseVersion } = payload;
  const serviceId = payload.serviceId ?? workerId;
  const { serviceName, logger } = options;
  const maxHeartbeatFailures = options.maxHeartbeatFailures ?? DEFAULT_MAX_HEARTBEAT_FAILURES;
  const runtimeConfig = options.runtimeConfig;
  const tag = serviceName;

  const controlToken = payload.controlRpcToken;
  if (!controlToken) {
    throw new Error(`[${tag}] Missing control RPC token for run ${runId}`);
  }
  const controlRpcBaseUrl = runtimeConfig?.controlRpcBaseUrl || payload.controlRpcBaseUrl;
  if (!controlRpcBaseUrl) {
    throw new Error(`[${tag}] Missing CONTROL_RPC_BASE_URL for run ${runId}`);
  }

  const controlRpc = new ControlRpcClient(
    controlRpcBaseUrl,
    runId,
    createStaticControlRpcTokenSource(controlToken),
  );
  const runIo = createControlRpcRunIo(controlRpc);

  // Derive run duration limit from the same env var used by AgentRunner
  const maxRunDurationMs = runtimeConfig?.maxRunDurationMs
    ?? parseInt(runtimeConfig?.executionEnv?.AGENT_TOTAL_TIMEOUT ?? '86400000', 10);

  // Fetch API keys from gateway — fail fast if proxy is unreachable
  let apiKeys: { openai?: string; anthropic?: string; google?: string };
  try {
    apiKeys = await fetchApiKeys(controlRpc);
  } catch (err) {
    logger.error(`[${tag}] Failed to fetch API keys for run ${runId}, aborting`, { error: err });
    try {
      await controlRpc.resetRun({ runId, serviceId, workerId });
    } catch (resetErr) {
      logger.warn(`[${tag}] Failed to reset run ${runId} after API key fetch failure (best-effort)`, { error: resetErr });
    }
    throw err;
  }

  // Verify at least one LLM key is available
  if (!apiKeys.openai && !apiKeys.anthropic && !apiKeys.google) {
    if (isNoLlmFallbackAllowed(runtimeConfig)) {
      logger.warn(`[${tag}] No LLM API keys available for run ${runId}; continuing in no-LLM mode`);
      await runNoLlmFastPath(controlRpc, { runId, serviceId, workerId }, logger, tag);
      return;
    } else {
      const msg = `No LLM API keys available for run ${runId}`;
      logger.error(`[${tag}] ${msg}`);
      try {
        await controlRpc.resetRun({ runId, serviceId, workerId });
      } catch (resetErr) {
        logger.warn(`[${tag}] Failed to reset run ${runId} after missing LLM keys (best-effort)`, { error: resetErr });
      }
      throw new Error(msg);
    }
  }

  const fakeEnv = buildCanonicalRemoteExecutionEnv(apiKeys, runtimeConfig?.executionEnv);

  // AbortController for timeout — shared by heartbeat and run
  const abortController = new AbortController();

  // If the server is shutting down, propagate abort to this run
  if (payload.shutdownSignal) {
    if (payload.shutdownSignal.aborted) {
      abortController.abort(payload.shutdownSignal.reason);
    } else {
      payload.shutdownSignal.addEventListener('abort', () => {
        abortController.abort(payload.shutdownSignal!.reason ?? new Error('Server shutdown'));
      }, { once: true });
    }
  }

  // Heartbeat: update workerHeartbeat every 60s to prevent stale detection
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let consecutiveFailures = 0;
  let nextLogAt = 1; // Exponential backoff: log at 1, 2, 4, 8...
  let runPromise: Promise<void> | null = null;

  function clearHeartbeat(): void {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  heartbeatInterval = setInterval(async () => {
    // Stop sending heartbeats if run was aborted
    if (abortController.signal.aborted) {
      clearHeartbeat();
      return;
    }

    try {
      await controlRpc.heartbeat({ runId, serviceId, workerId, leaseVersion }, HEARTBEAT_TIMEOUT_MS);
      consecutiveFailures = 0;
      nextLogAt = 1;
    } catch (err) {
      // Check if this is a 409 Conflict (lease lost)
      const is409 = err instanceof Error && (err.message.includes('409') || err.message.includes('Lease lost'));
      if (is409) {
        logger.error(`[${tag}] Lease lost for run ${runId}, aborting`);
        clearHeartbeat();
        abortController.abort(new Error('Lease lost'));
        return;
      }
      consecutiveFailures++;
      // Log with exponential backoff: log at 1, 2, 4, 8... consecutive failures
      if (consecutiveFailures >= nextLogAt || consecutiveFailures >= maxHeartbeatFailures) {
        logger.error(`[${tag}] Heartbeat failed for run ${runId} (${consecutiveFailures}/${maxHeartbeatFailures})`, { error: err });
        nextLogAt = Math.min(nextLogAt * 2, maxHeartbeatFailures);
      }
      if (consecutiveFailures >= maxHeartbeatFailures) {
        logger.error(`[${tag}] Too many heartbeat failures for run ${runId}, marking as failed`);
        clearHeartbeat();
        await markRunFailedFromExecutor(controlRpc, {
          runId,
          serviceId,
          workerId,
          leaseVersion,
          error: 'Heartbeat lost — executor marked run as failed',
        }, logger, tag);
        // Abort the run so it doesn't keep executing
        abortController.abort(new Error('Heartbeat lost'));
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

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
        abortController.abort(new Error('Timeout'));
        reject(new Error(`Run ${runId} exceeded maximum duration of ${maxRunDurationMs}ms`));
      }, maxRunDurationMs);
      timer.unref();

      // Also abort on signal (e.g., heartbeat failure)
      abortController.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(abortController.signal.reason ?? new Error('Run aborted'));
      }, { once: true });
    });

    await Promise.race([runPromise, timeoutPromise]);

    // Record billing via proxy after run completes
    try {
      await controlRpc.recordBillingUsage(runId);
    } catch (err) {
      logger.error(`[${tag}] Billing recording failed for run ${runId}`, { error: err });
    }
  } catch (err) {
    logger.error(`[${tag}] Run ${runId} failed`, { error: err });

    // Wait for the aborting AgentRunner to settle before checking status
    if (abortController.signal.aborted && runPromise) {
      await Promise.race([
        runPromise.catch((settleErr) => {
          logger.warn(`[${tag}] Run promise settled with error during abort grace period`, { error: settleErr });
        }),
        sleep(ABORT_SETTLE_GRACE_MS),
      ]);
    }

    const currentStatus = await fetchCurrentRunStatus(controlRpc, runId, logger, tag);
    if (!shouldResetRunToQueuedOnContainerError(currentStatus)) {
      logger.warn(
        `[${tag}] Preserving run ${runId} status ${currentStatus ?? 'unknown'} after error`,
      );
      return;
    }

    // Reset only non-terminal runs for stale recovery.
    try {
      await controlRpc.resetRun({ runId, serviceId, workerId });
    } catch (resetErr) {
      logger.error(`[${tag}] Failed to reset run ${runId}`, { error: resetErr });
    }
  } finally {
    // Always clear heartbeat and abort controller
    clearHeartbeat();
    if (!abortController.signal.aborted) {
      abortController.abort(new Error('Run finished'));
    }
  }
}
