/**
 * Agent Runner - Executes agent runs with LangGraph
 *
 * Uses LangGraph.js for stateful agent execution with tool calling.
 *
 * This file contains the AgentRunner class and re-exports.
 * Implementation is split into:
 *   - runner-events.ts    : event emission helpers
 *   - runner-history.ts   : run status, conversation history, message helpers
 *   - runner-types.ts     : constants, utility functions, shared types
 *   - session-closer.ts   : auto-close session (snapshot + file sync)
 *   - skills.ts           : skill loading, resolution, and context
 *   - simple-loop.ts      : simple LLM loop and no-LLM fallback
 *   - execute-run.ts      : queue consumer entry point
 *   - llm-manager.ts      : LLM client initialization, model selection, API key management
 *   - skill-manager.ts    : skill plan resolution, catalog management, locale processing
 *   - memory-manager.ts   : memory runtime integration, memory graph processing
 */

import type { RunStatus, Env } from '../../../shared/types';
import { INDEX_QUEUE_MESSAGE_VERSION } from '../../../shared/types';
import type { ObjectStoreBinding, SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { AgentContext, AgentConfig, AgentEvent, AgentMessage, ToolCall } from './agent-models';
import type { ToolExecutorLike } from '../../tools/executor';
import { RunCancelledError } from './run-lifecycle';
import { generateId, safeJsonParseOrDefault } from '../../../shared/utils';
import { runLangGraphRunner } from './langgraph-runner';
import { getAgentConfig } from './runner-config';
import { DEFAULT_MODEL_ID } from './model-catalog';
import type { RunTerminalPayload } from '../run-notifier';
import { logError, logWarn } from '../../../shared/utils/logger';
import { AppError, AuthenticationError, InternalError } from '@takos/common/errors';
import {
  handleSuccessfulRunCompletion,
  handleCancelledRun,
  handleFailedRun,
  type RunLifecycleDeps,
} from './run-lifecycle';
import { buildToolCatalogContent } from './prompt-builder';
import { buildBudgetedSystemPrompt, LANE_PRIORITY, LANE_MAX_TOKENS, type PromptLane } from './prompt-budget';

// Extracted modules
import type { ToolExecution } from './runner-types';
import { sanitizeErrorMessage } from './runner-types';
import { autoCloseSession as autoCloseSessionImpl } from './session-closer';
import { runWithSimpleLoop, runWithoutLLM } from './simple-loop';
import { RemoteToolExecutor } from './remote-tool-executor';
import {
  getDelegationPacketFromRunInput,
} from './delegation';

// Manager functions and state
import { createLLMState, type LLMState } from './llm-manager';
import { resolveAndApplySkills, buildSkillPlan, type SkillState, type SkillManagerDeps } from './skill-manager';
import { bootstrapMemory, finalizeMemory, type MemoryState, type MemoryManagerDeps } from './memory-manager';

// Re-export from split modules for backward compatibility
export {
  type EventEmitterState,
  emitEventImpl,
  buildTerminalEventPayloadImpl,
} from './runner-events';

export {
  updateRunStatusImpl,
  isValidToolCallsArray,
  type ConversationHistoryDeps,
  normalizeRunStatus,
  buildConversationHistory,
} from './runner-history';

// Re-export executeRun for backward compatibility (index.ts imports it from here)
export { executeRun } from './execute-run';

// Import what we need from split modules
import {
  type EventEmitterState,
  emitEventImpl,
  buildTerminalEventPayloadImpl,
} from './runner-events';
import { normalizeRunStatus } from './runner-history';

// ── AgentRunnerIo interface ──────────────────────────────────────────

export interface AgentRunnerIo {
  getRunBootstrap(input: {
    runId: string;
  }): Promise<{
    status: RunStatus | null;
    spaceId: string;
    sessionId: string | null;
    threadId: string;
    userId: string;
    agentType: string;
  }>;
  getRunRecord(input: {
    runId: string;
  }): Promise<{
    status: RunStatus | null;
    input: string | null;
    parentRunId: string | null;
  }>;
  getRunStatus(input: { runId: string }): Promise<RunStatus | null>;
  getConversationHistory(input: {
    runId: string;
    threadId: string;
    spaceId: string;
    aiModel: string;
  }): Promise<AgentMessage[]>;
  addMessage(input: {
    runId: string;
    threadId: string;
    message: AgentMessage;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  updateRunStatus(input: {
    runId: string;
    status: RunStatus;
    usage: { inputTokens: number; outputTokens: number };
    output?: string;
    error?: string;
  }): Promise<void>;
  getCurrentSessionId(input: { runId: string; spaceId: string }): Promise<string | null>;
  isCancelled(input: { runId: string }): Promise<boolean>;
  resolveSkillPlan(input: {
    runId: string;
    threadId: string;
    spaceId: string;
    agentType: string;
    history: AgentMessage[];
    availableToolNames: string[];
  }): Promise<import('./skills').SkillLoadResult>;
  getMemoryActivation(input: { spaceId: string }): Promise<import('../memory-graph/types').ActivationResult>;
  finalizeMemoryOverlay(input: {
    runId: string;
    spaceId: string;
    claims: import('../memory-graph/types').Claim[];
    evidence: import('../memory-graph/types').Evidence[];
  }): Promise<void>;
  getToolCatalog(input: { runId: string }): Promise<{
    tools: import('../../tools/types').ToolDefinition[];
    mcpFailedServers: string[];
  }>;
  executeTool(input: {
    runId: string;
    toolCall: import('../../tools/types').ToolCall;
  }): Promise<import('../../tools/types').ToolResult>;
  cleanupToolExecutor(input: { runId: string }): Promise<void>;
  emitRunEvent(input: {
    runId: string;
    type: AgentEvent['type'];
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
  }): Promise<void>;
}

// ── AgentRunner class ──────────────────────────────────────────────

export class AgentRunner {
  private db: SqlDatabaseBinding;
  private env: Env;
  private context: AgentContext;
  private config: AgentConfig;
  private toolExecutor: ToolExecutorLike | undefined;
  private totalUsage = { inputTokens: 0, outputTokens: 0 };
  private abortSignal?: AbortSignal;
  private toolCallCount = 0;
  private totalToolCalls = 0;
  private lastCancelCheck = 0;
  private isCancelled = false;
  private static readonly CANCEL_CHECK_INTERVAL_MS = 2000;

  private toolExecutions: ToolExecution[] = [];
  private eventState: EventEmitterState;
  private runIo: AgentRunnerIo;

  // Manager state
  private llm: LLMState;
  private skillState: SkillState;
  private skillDeps: SkillManagerDeps;
  private memoryState: MemoryState;
  private memoryDeps: MemoryManagerDeps;

  constructor(
    env: Env,
    db: SqlDatabaseBinding,
    _storage: ObjectStoreBinding | undefined,
    apiKey: string | undefined,
    context: AgentContext,
    agentType: string,
    aiModel: string = DEFAULT_MODEL_ID,
    options: {
      abortSignal?: AbortSignal;
      runIo: AgentRunnerIo;
    },
  ) {
    this.env = env;
    this.db = db;
    this.context = context;
    this.config = getAgentConfig(agentType, env);
    this.abortSignal = options.abortSignal;
    this.runIo = options.runIo;
    this.eventState = {
      eventSequence: 0,
      pendingEventEmissions: 0,
      eventEmissionErrors: [],
    };

    this.llm = createLLMState({ apiKey, env, aiModel });

    this.skillState = {
      locale: 'en',
      availableSkills: [],
      selectedSkills: [],
      activatedSkills: [],
    };
    this.skillDeps = {
      runIo: options.runIo,
      runId: context.runId,
      threadId: context.threadId,
      spaceId: context.spaceId,
      agentType,
    };

    this.memoryState = { runtime: undefined };
    this.memoryDeps = { db, env, context, runIo: options.runIo };
  }

  // ── Tool executor initialization ──────────────────────────────────

  private async initToolExecutor(): Promise<void> {
    this.toolExecutor = await RemoteToolExecutor.create(this.context.runId, {
      getToolCatalog: (input: { runId: string }) => this.runIo.getToolCatalog(input),
      executeTool: (input: { runId: string; toolCall: ToolCall }) => this.runIo.executeTool(input),
      cleanupToolExecutor: (input: { runId: string }) => this.runIo.cleanupToolExecutor(input),
    });

    const availableTools = this.toolExecutor.getAvailableTools();
    this.config.tools = availableTools.map((tool) => ({
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
        name: 'base',
        content: this.config.systemPrompt,
        maxTokens: LANE_MAX_TOKENS.BASE_PROMPT,
      },
      {
        priority: LANE_PRIORITY.TOOL_CATALOG,
        name: 'tools',
        content: toolCatalog,
        maxTokens: LANE_MAX_TOKENS.TOOL_CATALOG,
      },
    ];

    this.config.systemPrompt = buildBudgetedSystemPrompt(lanes);

    const failedMcp = this.toolExecutor.mcpFailedServers;
    if (failedMcp.length > 0) {
      await this.emitEvent('thinking', {
        message: `Warning: Failed to load MCP servers: ${failedMcp.join(', ')}`,
        warning: true,
        failed_mcp_servers: failedMcp,
      });
    }
  }

  // ── Bound delegates ────────────────────────────────────────────────

  private async emitEvent(
    type: AgentEvent['type'],
    data: Record<string, unknown>,
    options?: { skipDb?: boolean },
  ): Promise<void> {
    return emitEventImpl(
      this.eventState,
      this.env,
      this.db,
      this.context.runId,
      this.context.spaceId,
      () => this.getCurrentSessionId(),
      type,
      data,
      options,
      (input) => this.runIo.emitRunEvent(input),
    );
  }

  private async updateRunStatus(
    status: RunStatus,
    output?: string,
    error?: string,
  ): Promise<void> {
    return this.runIo.updateRunStatus({
      runId: this.context.runId,
      status,
      usage: this.totalUsage,
      output,
      error,
    });
  }

  private buildTerminalEventPayload(
    status: 'completed' | 'failed' | 'cancelled',
    details: Record<string, unknown> = {},
  ): RunTerminalPayload {
    return buildTerminalEventPayloadImpl(
      this.context.runId,
      status,
      details,
      this.context.sessionId ?? null,
    );
  }

  private async autoCloseSession(status: 'completed' | 'failed'): Promise<void> {
    return autoCloseSessionImpl(
      {
        env: this.env,
        db: this.db,
        context: this.context,
        checkCancellation: (force) => this.checkCancellation(force),
        emitEvent: (type, data) => this.emitEvent(type, data),
        getCurrentSessionId: () => this.getCurrentSessionId(),
      },
      status,
    );
  }

  // ── Cancellation checks ───────────────────────────────────────────

  private async checkCancellation(force = false): Promise<boolean> {
    if (this.abortSignal?.aborted) {
      return false;
    }

    const now = Date.now();
    if (!force && now - this.lastCancelCheck < AgentRunner.CANCEL_CHECK_INTERVAL_MS) {
      return this.isCancelled;
    }

    this.isCancelled = await this.runIo.isCancelled({ runId: this.context.runId });
    this.lastCancelCheck = now;
    return this.isCancelled;
  }

  private async throwIfCancelled(ctx: string): Promise<void> {
    if (this.abortSignal?.aborted) {
      const reason = this.abortSignal.reason;
      const message = reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Run aborted';
      throw new AppError(`${message} (${ctx})`);
    }

    if (await this.checkCancellation()) {
      throw new RunCancelledError(`Run cancelled (${ctx})`);
    }
  }

  // ── Queue jobs ────────────────────────────────────────────────────

  private async enqueueInfoUnitJob(): Promise<void> {
    if (!this.env.INDEX_QUEUE) return;
    try {
      await this.env.INDEX_QUEUE.send({
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: generateId(),
        spaceId: this.context.spaceId,
        type: 'info_unit',
        targetId: this.context.runId,
        timestamp: Date.now(),
      });
    } catch (err) {
      logWarn(`Failed to enqueue info unit job for run ${this.context.runId}`, { module: 'info_unit', detail: err });
    }
  }

  private async enqueueThreadContextJob(): Promise<void> {
    if (!this.env.INDEX_QUEUE) return;
    try {
      await this.env.INDEX_QUEUE.send({
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: generateId(),
        spaceId: this.context.spaceId,
        type: 'thread_context',
        targetId: this.context.threadId,
        timestamp: Date.now(),
      });
    } catch (err) {
      logWarn(`Failed to enqueue thread context job for thread ${this.context.threadId}`, { module: 'thread_context', detail: err });
    }
  }

  private async enqueuePostRunJobs(): Promise<void> {
    await Promise.all([this.enqueueInfoUnitJob(), this.enqueueThreadContextJob()]);
  }

  // ── Conversation / message helpers ────────────────────────────────

  private async getConversationHistory(): Promise<AgentMessage[]> {
    return this.runIo.getConversationHistory({
      runId: this.context.runId,
      threadId: this.context.threadId,
      spaceId: this.context.spaceId,
      aiModel: this.llm.aiModel,
    });
  }

  private async addMessage(message: AgentMessage, metadata?: Record<string, unknown>): Promise<void> {
    return this.runIo.addMessage({
      runId: this.context.runId,
      threadId: this.context.threadId,
      message,
      metadata,
    });
  }

  private async getCurrentSessionId(): Promise<string | null> {
    return this.runIo.getCurrentSessionId({
      runId: this.context.runId,
      spaceId: this.context.spaceId,
    });
  }

  private async getRunRecord(): Promise<{
    status: RunStatus | null;
    input: string | null;
    parentRunId: string | null;
  }> {
    return this.runIo.getRunRecord({ runId: this.context.runId });
  }

  // ── Lifecycle delegation ──────────────────────────────────────────

  private getLifecycleDeps(): RunLifecycleDeps {
    return {
      updateRunStatus: this.updateRunStatus.bind(this),
      emitEvent: this.emitEvent.bind(this),
      buildTerminalEventPayload: this.buildTerminalEventPayload.bind(this),
      autoCloseSession: this.autoCloseSession.bind(this),
      enqueuePostRunJobs: this.enqueuePostRunJobs.bind(this),
      sanitizeErrorMessage: sanitizeErrorMessage,
    };
  }

  private async handleSuccessfulRunCompletion(): Promise<void> {
    await handleSuccessfulRunCompletion(this.getLifecycleDeps());
  }

  private async handleCancelledRun(): Promise<void> {
    await handleCancelledRun(this.getLifecycleDeps());
  }

  private async handleFailedRun(error: unknown): Promise<void> {
    await handleFailedRun(this.getLifecycleDeps(), error);
  }

  // ── Run preparation ───────────────────────────────────────────────

  private async prepareRunExecution(): Promise<{
    engine: 'langgraph' | 'simple' | 'none';
    history: AgentMessage[];
  }> {
    await this.throwIfCancelled('before-start');
    const engine: 'langgraph' | 'simple' | 'none' = !this.llm.client
      ? 'none'
      : this.llm.modelProvider === 'openai' && !!this.llm.openAiKey
        ? 'langgraph'
        : 'simple';

    await this.updateRunStatus('running');
    await this.emitEvent('started', {
      agent_type: this.config.type,
      engine,
    });

    if (!this.llm.client) {
      await this.emitEvent('thinking', {
        message: `Warning: No API key configured for ${this.llm.modelProvider} (model: ${this.llm.aiModel}). Running in limited mode without LLM.`,
        warning: true,
      });
    }

    await this.initToolExecutor();

    const history = await this.getConversationHistory();
    if (!this.llm.client) {
      await this.throwIfCancelled('before-execution');
      return { engine, history };
    }

    const currentRun = await this.getRunRecord();
    const runInput = safeJsonParseOrDefault<Record<string, unknown> | unknown>(currentRun.input || '{}', {});
    const runInputObject = runInput && typeof runInput === 'object' && !Array.isArray(runInput)
      ? runInput as Record<string, unknown>
      : {};
    const delegationPacket = currentRun.parentRunId
      ? getDelegationPacketFromRunInput(runInputObject)
      : null;
    const delegationObservability = runInputObject.delegation_observability;
    const savedDelegationObservability = delegationObservability && typeof delegationObservability === 'object' && !Array.isArray(delegationObservability)
      ? delegationObservability as Record<string, unknown>
      : null;
    if (delegationPacket) {
      await this.emitEvent('thinking', {
        message: 'Loaded delegated execution context for sub-agent run',
        delegated_context: true,
        delegation_product_hint: delegationPacket.product_hint,
        delegation_locale: delegationPacket.locale,
        delegation_constraints_count: delegationPacket.constraints.length,
        delegation_context_count: delegationPacket.context.length,
        delegation_has_thread_summary: !!delegationPacket.thread_summary,
        delegation_explicit_fields_count: typeof savedDelegationObservability?.explicit_field_count === 'number'
          ? savedDelegationObservability.explicit_field_count
          : null,
        delegation_inferred_fields_count: typeof savedDelegationObservability?.inferred_field_count === 'number'
          ? savedDelegationObservability.inferred_field_count
          : null,
      });
    }

    await resolveAndApplySkills(this.skillDeps, this.skillState, history, this.toolExecutor, this.emitEvent.bind(this));

    // Initialize memory runtime and wire observer + idempotency into tool executor
    await bootstrapMemory(this.memoryDeps, this.memoryState, this.toolExecutor);

    await this.throwIfCancelled('before-execution');

    return { engine, history };
  }

  // ── Engine execution ──────────────────────────────────────────────

  private async runWithLangGraph(history: AgentMessage[]): Promise<void> {
    if (!this.llm.openAiKey) {
      throw new AuthenticationError('API key is required for LangGraph');
    }
    if (!this.toolExecutor) {
      throw new InternalError('Tool executor not initialized');
    }
    await runLangGraphRunner({
      apiKey: this.llm.openAiKey,
      model: this.llm.aiModel,
      systemPrompt: this.config.systemPrompt,
      skillPlan: buildSkillPlan(this.skillState),
      history,
      threadId: this.context.threadId,
      runId: this.context.runId,
      sessionId: this.context.sessionId,
      toolExecutor: this.toolExecutor as never,
      db: this.db,
      maxIterations: this.config.maxIterations || 10,
      temperature: this.config.temperature ?? 0.7,
      toolExecutions: this.toolExecutions,
      emitEvent: this.emitEvent.bind(this),
      addMessage: this.addMessage.bind(this),
      updateRunStatus: this.updateRunStatus.bind(this),
      env: this.env,
      spaceId: this.context.spaceId,
      shouldCancel: this.checkCancellation.bind(this),
      abortSignal: this.abortSignal,
      memoryRuntime: this.memoryState.runtime,
    });
  }

  private async runSimpleLoop(): Promise<void> {
    const llmClient = this.llm.client;
    if (!llmClient) {
      throw new InternalError('No LLM client available');
    }
    await runWithSimpleLoop({
      env: this.env,
      config: this.config,
      llmClient,
      toolExecutor: this.toolExecutor,
      skillLocale: this.skillState.locale,
      availableSkills: this.skillState.availableSkills,
      selectedSkills: this.skillState.selectedSkills,
      activatedSkills: this.skillState.activatedSkills,
      spaceId: this.context.spaceId,
      abortSignal: this.abortSignal,
      toolExecutions: this.toolExecutions,
      totalUsage: this.totalUsage,
      toolCallCount: this.toolCallCount,
      totalToolCalls: this.totalToolCalls,
      memoryRuntime: this.memoryState.runtime,
      throwIfCancelled: (ctx) => this.throwIfCancelled(ctx),
      emitEvent: (type, data) => this.emitEvent(type, data),
      addMessage: (msg, meta) => this.addMessage(msg, meta),
      updateRunStatus: (status, output, error) => this.updateRunStatus(status, output, error),
      buildTerminalEventPayload: (status, details) => this.buildTerminalEventPayload(status, details),
      getConversationHistory: () => this.getConversationHistory(),
    });
  }

  private async executeRunEngine(
    history: AgentMessage[],
    engine: 'langgraph' | 'simple' | 'none',
  ): Promise<void> {
    if (engine === 'none') {
      await runWithoutLLM(
        {
          toolExecutor: this.toolExecutor,
          emitEvent: (type, data) => this.emitEvent(type, data),
          addMessage: (msg, meta) => this.addMessage(msg, meta),
          updateRunStatus: (status, output, error) => this.updateRunStatus(status, output, error),
          buildTerminalEventPayload: (status, details) => this.buildTerminalEventPayload(status, details),
        },
        history,
      );
      return;
    }

    if (engine === 'simple') {
      await this.emitEvent('thinking', {
        message: 'Using simple mode for selected model',
        engine: 'simple',
      });
      await this.runSimpleLoop();
      return;
    }

    await this.runWithLangGraph(history);
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  private async cleanupAfterRun(): Promise<void> {
    try {
      const executor = this.toolExecutor;

      // Finalize memory runtime (flush overlay claims to DB)
      await finalizeMemory(this.memoryState);

      this.toolExecutor = undefined;
      await executor?.cleanup();
      this.toolExecutions.length = 0;

      const currentRunStatus = await this.runIo.getRunStatus({ runId: this.context.runId });

      if (normalizeRunStatus(currentRunStatus) === 'running') {
        logWarn(`Run ${this.context.runId} was left in running state - marking as failed`, { module: 'agentrunner' });
        await this.updateRunStatus('failed', undefined, 'Run terminated unexpectedly during cleanup');
      }
    } catch (cleanupError) {
      logError('Cleanup error', cleanupError, { module: 'services/agent/runner' });
    }
  }

  // ── Main entry point ──────────────────────────────────────────────

  async run(): Promise<void> {
    try {
      const { engine, history } = await this.prepareRunExecution();
      await this.executeRunEngine(history, engine);
      await this.handleSuccessfulRunCompletion();
    } catch (error) {
      if (error instanceof RunCancelledError) {
        await this.handleCancelledRun();
        return;
      }
      await this.handleFailedRun(error);
      throw error;
    } finally {
      await this.cleanupAfterRun();
    }
  }
}
