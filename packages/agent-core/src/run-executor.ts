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
 * (resolved from @takos/control-agent at build time) into agent-core's executor.
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

function createControlRpcRunIo(
  controlRpc: ControlRpcClient,
): {
  getRunBootstrap: (input: {
    runId: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getRunBootstrap']>>>;
  getRunRecord: (input: {
    runId: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getRunRecord']>>>;
  getRunStatus: (input: {
    runId: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getRunStatus']>>>;
  getConversationHistory: (input: {
    runId: string;
    threadId: string;
    spaceId: string;
    aiModel: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getConversationHistory']>>>;
  resolveSkillPlan: (input: {
    runId: string;
    threadId: string;
    spaceId: string;
    agentType: string;
    history: Array<{
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      tool_call_id?: string;
    }>;
    availableToolNames: string[];
  }) => Promise<Awaited<ReturnType<ControlRpcClient['resolveSkillPlan']>>>;
  getMemoryActivation: (input: {
    spaceId: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getMemoryActivation']>>>;
  finalizeMemoryOverlay: (input: {
    runId: string;
    spaceId: string;
    claims: Array<{
      id: string;
      accountId: string;
      claimType: 'fact' | 'preference' | 'decision' | 'observation';
      subject: string;
      predicate: string;
      object: string;
      confidence: number;
      status: 'active' | 'superseded' | 'retracted';
      supersededBy: string | null;
      sourceRunId: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    evidence: Array<{
      id: string;
      accountId: string;
      claimId: string;
      kind: 'supports' | 'contradicts' | 'context';
      sourceType: 'tool_result' | 'user_message' | 'agent_inference' | 'memory_recall';
      sourceRef: string | null;
      content: string;
      trust: number;
      taint: string | null;
      createdAt: string;
    }>;
  }) => Promise<void>;
  addMessage: (input: {
    runId: string;
    threadId: string;
    message: {
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      tool_calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
      tool_call_id?: string;
    };
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  updateRunStatus: (input: {
    runId: string;
    status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    usage: { inputTokens: number; outputTokens: number };
    output?: string;
    error?: string;
  }) => Promise<void>;
  getCurrentSessionId: (input: { runId: string; spaceId: string }) => Promise<string | null>;
  isCancelled: (input: { runId: string }) => Promise<boolean>;
  getToolCatalog: (input: {
    runId: string;
  }) => Promise<Awaited<ReturnType<ControlRpcClient['getToolCatalog']>>>;
  executeTool: (input: {
    runId: string;
    toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
  }) => Promise<Awaited<ReturnType<ControlRpcClient['executeTool']>>>;
  cleanupToolExecutor: (input: { runId: string }) => Promise<void>;
  emitRunEvent: (input: {
    runId: string;
    type: 'started' | 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'artifact' | 'completed' | 'error' | 'cancelled' | 'progress';
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
  }) => Promise<void>;
} {
  return {
    getRunBootstrap(input) {
      return controlRpc.getRunBootstrap(input.runId);
    },
    getRunRecord(input) {
      return controlRpc.getRunRecord(input.runId);
    },
    getRunStatus(input) {
      return controlRpc.getRunStatus(input.runId);
    },
    getConversationHistory(input) {
      return controlRpc.getConversationHistory(input);
    },
    resolveSkillPlan(input) {
      return controlRpc.resolveSkillPlan(input);
    },
    getMemoryActivation(input) {
      return controlRpc.getMemoryActivation(input);
    },
    finalizeMemoryOverlay(input) {
      return controlRpc.finalizeMemoryOverlay(input);
    },
    addMessage(input) {
      return controlRpc.addMessage(input);
    },
    updateRunStatus(input) {
      return controlRpc.updateRunStatus(input);
    },
    getCurrentSessionId(input) {
      return controlRpc.getCurrentSessionId(input);
    },
    isCancelled(input) {
      return controlRpc.isCancelled(input.runId);
    },
    getToolCatalog(input) {
      return controlRpc.getToolCatalog(input.runId);
    },
    executeTool(input) {
      return controlRpc.executeTool(input);
    },
    cleanupToolExecutor(input) {
      return controlRpc.cleanupToolExecutor(input.runId);
    },
    emitRunEvent(input) {
      return controlRpc.emitRunEvent(input);
    },
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
    } catch { /* best-effort */ }
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
    } catch { /* best-effort */ }
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
        runPromise.catch(() => {}),
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
