/**
 * Runner Orchestration - Preparation, engine dispatch, cleanup, and queue jobs.
 *
 * Extracted from the AgentRunner class to separate orchestration concerns
 * from the class shell. Each function receives an explicit deps/state object
 * instead of relying on `this`.
 */

import type { Env, RunStatus } from "../../../shared/types/index.ts";
import { INDEX_QUEUE_MESSAGE_VERSION } from "../../../shared/types/index.ts";
import type {
  AgentConfig,
  AgentContext,
  AgentEvent,
  AgentMessage,
} from "./agent-models.ts";
import type { ToolExecutorLike } from "../../tools/executor.ts";
import type { ToolCall } from "./agent-models.ts";
import type { AgentRunnerIo } from "./runner-io.ts";
import type { EventEmitterState } from "./runner-events.ts";
import type { ToolExecution } from "./runner-utils.ts";
import type { LLMState } from "./llm-manager.ts";
import type { SkillPlanDeps, SkillState } from "./skill-plan.ts";
import type { MemoryManagerDeps, MemoryState } from "./memory-manager.ts";
import type { RunTerminalPayload } from "../run-notifier/index.ts";
import type { RunLifecycleDeps } from "./run-lifecycle.ts";

import {
  generateId,
  safeJsonParseOrDefault,
} from "../../../shared/utils/index.ts";
import {
  type AppError as _AppError,
  AuthenticationError,
  InternalError,
} from "takos-common/errors";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import { RunCancelledError } from "./run-lifecycle.ts";
import { runLangGraphRunner } from "./graph-runner.ts";
import { buildSkillPlan, resolveAndApplySkills } from "./skill-plan.ts";
import { bootstrapMemory, finalizeMemory } from "./memory-manager.ts";
import { buildToolCatalogContent } from "./prompt-builder.ts";
import {
  buildBudgetedSystemPrompt,
  LANE_MAX_TOKENS,
  LANE_PRIORITY,
  type PromptLane,
} from "./prompt-budget.ts";
import { RemoteToolExecutor } from "./remote-tool-executor.ts";
import { getDelegationPacketFromRunInput } from "./delegation.ts";
import { runWithoutLLM, runWithSimpleLoop } from "./simple-loop.ts";
import { sanitizeErrorMessage } from "./runner-utils.ts";
import { normalizeRunStatus } from "./runner-history.ts";
import {
  handleCancelledRun,
  handleFailedRun,
  handleSuccessfulRunCompletion,
} from "./run-lifecycle.ts";

// ── Shared deps type for orchestration functions ──────────────────────

/** Aggregated dependencies that orchestration functions need from the runner. */
export interface OrchestrationDeps {
  env: Env;
  db: import("../../../shared/types/bindings.ts").SqlDatabaseBinding;
  context: AgentContext;
  config: AgentConfig;
  runIo: AgentRunnerIo;
  abortSignal?: AbortSignal;

  // Mutable state owned by the runner
  llm: LLMState;
  skillState: SkillState;
  skillDeps: SkillPlanDeps;
  memoryState: MemoryState;
  memoryDeps: MemoryManagerDeps;
  eventState: EventEmitterState;
  toolExecutions: ToolExecution[];
  totalUsage: { inputTokens: number; outputTokens: number };
  toolCallCount: number;
  totalToolCalls: number;

  // Bound delegates from the runner instance
  emitEvent: (
    type: AgentEvent["type"],
    data: Record<string, unknown>,
    options?: { skipDb?: boolean },
  ) => Promise<void>;
  updateRunStatus: (
    status: RunStatus,
    output?: string,
    error?: string,
  ) => Promise<void>;
  buildTerminalEventPayload: (
    status: "completed" | "failed" | "cancelled",
    details?: Record<string, unknown>,
  ) => RunTerminalPayload;
  autoCloseSession: (status: "completed" | "failed") => Promise<void>;
  throwIfCancelled: (ctx: string) => Promise<void>;
  checkCancellation: (force?: boolean) => Promise<boolean>;
  getConversationHistory: () => Promise<AgentMessage[]>;
  addMessage: (
    message: AgentMessage,
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
  getCurrentSessionId: () => Promise<string | null>;
  getRunRecord: () => Promise<
    {
      status: RunStatus | null;
      input: string | null;
      parentRunId: string | null;
    }
  >;

  // Mutable ref for the tool executor (set during init)
  getToolExecutor: () => ToolExecutorLike | undefined;
  setToolExecutor: (te: ToolExecutorLike | undefined) => void;
}

// ── Tool executor initialization ──────────────────────────────────────

export async function initToolExecutor(deps: OrchestrationDeps): Promise<void> {
  const toolExecutor = await RemoteToolExecutor.create(deps.context.runId, {
    getToolCatalog: (input: { runId: string }) =>
      deps.runIo.getToolCatalog(input),
    executeTool: (input: { runId: string; toolCall: ToolCall }) =>
      deps.runIo.executeTool(input),
    cleanupToolExecutor: (input: { runId: string }) =>
      deps.runIo.cleanupToolExecutor(input),
  });
  deps.setToolExecutor(toolExecutor);

  const availableTools = toolExecutor.getAvailableTools();
  deps.config.tools = availableTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  const toolCatalog = buildToolCatalogContent(
    availableTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  );

  const lanes: PromptLane[] = [
    {
      priority: LANE_PRIORITY.BASE_PROMPT,
      name: "base",
      content: deps.config.systemPrompt,
      maxTokens: LANE_MAX_TOKENS.BASE_PROMPT,
    },
    {
      priority: LANE_PRIORITY.TOOL_CATALOG,
      name: "tools",
      content: toolCatalog,
      maxTokens: LANE_MAX_TOKENS.TOOL_CATALOG,
    },
  ];

  deps.config.systemPrompt = buildBudgetedSystemPrompt(lanes);

  const failedMcp = toolExecutor.mcpFailedServers;
  if (failedMcp.length > 0) {
    await deps.emitEvent("thinking", {
      message: `Warning: Failed to load MCP servers: ${failedMcp.join(", ")}`,
      warning: true,
      failed_mcp_servers: failedMcp,
    });
  }
}

// ── Queue job helpers ─────────────────────────────────────────────────

export async function enqueuePostRunJobs(
  deps: OrchestrationDeps,
): Promise<void> {
  const enqueueInfoUnit = async () => {
    if (!deps.env.INDEX_QUEUE) return;
    try {
      await deps.env.INDEX_QUEUE.send({
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: generateId(),
        spaceId: deps.context.spaceId,
        type: "info_unit",
        targetId: deps.context.runId,
        timestamp: Date.now(),
      });
    } catch (err) {
      logWarn(`Failed to enqueue info unit job for run ${deps.context.runId}`, {
        module: "info_unit",
        detail: err,
      });
    }
  };

  const enqueueThreadContext = async () => {
    if (!deps.env.INDEX_QUEUE) return;
    try {
      await deps.env.INDEX_QUEUE.send({
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: generateId(),
        spaceId: deps.context.spaceId,
        type: "thread_context",
        targetId: deps.context.threadId,
        timestamp: Date.now(),
      });
    } catch (err) {
      logWarn(
        `Failed to enqueue thread context job for thread ${deps.context.threadId}`,
        { module: "thread_context", detail: err },
      );
    }
  };

  await Promise.all([enqueueInfoUnit(), enqueueThreadContext()]);
}

// ── Run preparation ───────────────────────────────────────────────────

export async function prepareRunExecution(deps: OrchestrationDeps): Promise<{
  engine: "langgraph" | "simple" | "none";
  history: AgentMessage[];
}> {
  await deps.throwIfCancelled("before-start");
  const engine: "langgraph" | "simple" | "none" = !deps.llm.client
    ? "none"
    : deps.llm.modelBackend === "openai" && !!deps.llm.openAiKey
    ? "langgraph"
    : "simple";

  await deps.updateRunStatus("running");
  await deps.emitEvent("started", {
    agent_type: deps.config.type,
    engine,
  });

  if (!deps.llm.client) {
    await deps.emitEvent("thinking", {
      message:
        `Warning: No API key configured for ${deps.llm.modelBackend} (model: ${deps.llm.aiModel}). Running in limited mode without LLM.`,
      warning: true,
    });
  }

  await initToolExecutor(deps);

  const history = await deps.getConversationHistory();
  if (!deps.llm.client) {
    await deps.throwIfCancelled("before-execution");
    return { engine, history };
  }

  const currentRun = await deps.getRunRecord();
  const runInput = safeJsonParseOrDefault<Record<string, unknown> | unknown>(
    currentRun.input || "{}",
    {},
  );
  const runInputObject =
    runInput && typeof runInput === "object" && !Array.isArray(runInput)
      ? runInput as Record<string, unknown>
      : {};
  const delegationPacket = currentRun.parentRunId
    ? getDelegationPacketFromRunInput(runInputObject)
    : null;
  const delegationObservability = runInputObject.delegation_observability;
  const savedDelegationObservability =
    delegationObservability && typeof delegationObservability === "object" &&
      !Array.isArray(delegationObservability)
      ? delegationObservability as Record<string, unknown>
      : null;
  if (delegationPacket) {
    await deps.emitEvent("thinking", {
      message: "Loaded delegated execution context for sub-agent run",
      delegated_context: true,
      delegation_product_hint: delegationPacket.product_hint,
      delegation_locale: delegationPacket.locale,
      delegation_constraints_count: delegationPacket.constraints.length,
      delegation_context_count: delegationPacket.context.length,
      delegation_has_thread_summary: !!delegationPacket.thread_summary,
      delegation_explicit_fields_count:
        typeof savedDelegationObservability?.explicit_field_count === "number"
          ? savedDelegationObservability.explicit_field_count
          : null,
      delegation_inferred_fields_count:
        typeof savedDelegationObservability?.inferred_field_count === "number"
          ? savedDelegationObservability.inferred_field_count
          : null,
    });
  }

  const toolExecutor = deps.getToolExecutor();
  await resolveAndApplySkills(
    deps.skillDeps,
    deps.skillState,
    history,
    toolExecutor,
    deps.emitEvent,
  );

  // Initialize memory runtime and wire observer + idempotency into tool executor
  await bootstrapMemory(deps.memoryDeps, deps.memoryState, toolExecutor);

  await deps.throwIfCancelled("before-execution");

  return { engine, history };
}

// ── Engine execution dispatch ─────────────────────────────────────────

async function runWithLangGraph(
  deps: OrchestrationDeps,
  history: AgentMessage[],
): Promise<void> {
  if (!deps.llm.openAiKey) {
    throw new AuthenticationError("API key is required for LangGraph");
  }
  const toolExecutor = deps.getToolExecutor();
  if (!toolExecutor) {
    throw new InternalError("Tool executor not initialized");
  }
  await runLangGraphRunner({
    apiKey: deps.llm.openAiKey,
    model: deps.llm.aiModel,
    systemPrompt: deps.config.systemPrompt,
    skillPlan: buildSkillPlan(deps.skillState),
    history,
    threadId: deps.context.threadId,
    runId: deps.context.runId,
    sessionId: deps.context.sessionId,
    toolExecutor,
    db: deps.db,
    maxIterations: deps.config.maxIterations || 10,
    temperature: deps.config.temperature ?? 0.7,
    toolExecutions: deps.toolExecutions,
    emitEvent: deps.emitEvent,
    addMessage: deps.addMessage,
    updateRunStatus: deps.updateRunStatus,
    env: deps.env,
    spaceId: deps.context.spaceId,
    shouldCancel: deps.checkCancellation,
    abortSignal: deps.abortSignal,
    memoryRuntime: deps.memoryState.runtime,
  });
}

async function runSimpleLoop(deps: OrchestrationDeps): Promise<void> {
  const llmClient = deps.llm.client;
  if (!llmClient) {
    throw new InternalError("No LLM client available");
  }
  await runWithSimpleLoop({
    env: deps.env,
    config: deps.config,
    llmClient,
    toolExecutor: deps.getToolExecutor(),
    skillLocale: deps.skillState.locale,
    availableSkills: deps.skillState.availableSkills,
    selectedSkills: deps.skillState.selectedSkills,
    activatedSkills: deps.skillState.activatedSkills,
    spaceId: deps.context.spaceId,
    abortSignal: deps.abortSignal,
    toolExecutions: deps.toolExecutions,
    totalUsage: deps.totalUsage,
    toolCallCount: deps.toolCallCount,
    totalToolCalls: deps.totalToolCalls,
    memoryRuntime: deps.memoryState.runtime,
    throwIfCancelled: (ctx) => deps.throwIfCancelled(ctx),
    emitEvent: (type, data) => deps.emitEvent(type, data),
    addMessage: (msg, meta) => deps.addMessage(msg, meta),
    updateRunStatus: (status, output, error) =>
      deps.updateRunStatus(status, output, error),
    buildTerminalEventPayload: (status, details) =>
      deps.buildTerminalEventPayload(status, details),
    getConversationHistory: () => deps.getConversationHistory(),
  });
}

export async function executeRunEngine(
  deps: OrchestrationDeps,
  history: AgentMessage[],
  engine: "langgraph" | "simple" | "none",
): Promise<void> {
  if (engine === "none") {
    await runWithoutLLM(
      {
        toolExecutor: deps.getToolExecutor(),
        emitEvent: (type, data) => deps.emitEvent(type, data),
        addMessage: (msg, meta) => deps.addMessage(msg, meta),
        updateRunStatus: (status, output, error) =>
          deps.updateRunStatus(status, output, error),
        buildTerminalEventPayload: (status, details) =>
          deps.buildTerminalEventPayload(status, details),
      },
      history,
    );
    return;
  }

  if (engine === "simple") {
    await deps.emitEvent("thinking", {
      message: "Using simple mode for selected model",
      engine: "simple",
    });
    await runSimpleLoop(deps);
    return;
  }

  await runWithLangGraph(deps, history);
}

// ── Cleanup ───────────────────────────────────────────────────────────

export async function cleanupAfterRun(deps: OrchestrationDeps): Promise<void> {
  try {
    const executor = deps.getToolExecutor();

    // Finalize memory runtime (flush overlay claims to DB)
    await finalizeMemory(deps.memoryState);

    deps.setToolExecutor(undefined);
    await executor?.cleanup();
    deps.toolExecutions.length = 0;

    const currentRunStatus = await deps.runIo.getRunStatus({
      runId: deps.context.runId,
    });

    if (normalizeRunStatus(currentRunStatus) === "running") {
      logWarn(
        `Run ${deps.context.runId} was left in running state - marking as failed`,
        { module: "agentrunner" },
      );
      await deps.updateRunStatus(
        "failed",
        undefined,
        "Run terminated unexpectedly during cleanup",
      );
    }
  } catch (cleanupError) {
    logError("Cleanup error", cleanupError, {
      module: "services/agent/runner",
    });
  }
}

// ── Lifecycle helpers ─────────────────────────────────────────────────

export function buildLifecycleDeps(deps: OrchestrationDeps): RunLifecycleDeps {
  return {
    updateRunStatus: deps.updateRunStatus,
    emitEvent: deps.emitEvent,
    buildTerminalEventPayload: deps.buildTerminalEventPayload,
    autoCloseSession: deps.autoCloseSession,
    enqueuePostRunJobs: () => enqueuePostRunJobs(deps),
    sanitizeErrorMessage: sanitizeErrorMessage,
  };
}

export async function handleRunSuccess(deps: OrchestrationDeps): Promise<void> {
  await handleSuccessfulRunCompletion(buildLifecycleDeps(deps));
}

export async function handleRunCancelled(
  deps: OrchestrationDeps,
): Promise<void> {
  await handleCancelledRun(buildLifecycleDeps(deps));
}

export async function handleRunFailed(
  deps: OrchestrationDeps,
  error: unknown,
): Promise<void> {
  await handleFailedRun(buildLifecycleDeps(deps), error);
}

// ── Main run loop ─────────────────────────────────────────────────────

export async function runOrchestration(deps: OrchestrationDeps): Promise<void> {
  try {
    const { engine, history } = await prepareRunExecution(deps);
    await executeRunEngine(deps, history, engine);
    await handleRunSuccess(deps);
  } catch (error) {
    if (error instanceof RunCancelledError) {
      await handleRunCancelled(deps);
      return;
    }
    await handleRunFailed(deps, error);
    throw error;
  } finally {
    await cleanupAfterRun(deps);
  }
}
