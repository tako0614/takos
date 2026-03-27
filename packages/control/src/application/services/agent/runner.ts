/**
 * Agent Runner - Executes agent runs with LangGraph
 *
 * Uses LangGraph.js for stateful agent execution with tool calling.
 *
 * This file contains the AgentRunner class and re-exports.
 * Implementation is split into:
 *   - runner-events.ts    : event emission helpers
 *   - runner-messages.ts  : run status, conversation history, message helpers
 *   - runner-types.ts     : constants, utility functions, shared types
 *   - session-closer.ts   : auto-close session (snapshot + file sync)
 *   - skills.ts           : skill loading, resolution, and context
 *   - simple-loop.ts      : simple LLM loop and no-LLM fallback
 *   - execute-run.ts      : queue consumer entry point
 */

import type { RunStatus, Env } from '../../../shared/types';
import { INDEX_QUEUE_MESSAGE_VERSION } from '../../../shared/types';
import type { ObjectStoreBinding, SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { AgentContext, AgentConfig, AgentEvent, AgentMessage, ToolCall } from './types';
import type { ToolExecutorLike } from '../../tools/executor';
import { LLMClient, createMultiModelClient, getProviderFromModel, type ModelProvider } from './llm';
import { RunCancelledError } from './run-lifecycle';
import { generateId, safeJsonParseOrDefault } from '../../../shared/utils';
import { runLangGraphRunner } from './langgraph-runner';
import type { SkillCatalogEntry, SkillSelection, SkillContext } from './skills';
import { getAgentConfig } from './runner-config';
import { DEFAULT_MODEL_ID } from './model-catalog';
import type { RunTerminalPayload } from '../run-notifier';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';
import { AppError, AuthenticationError, InternalError } from '@takos/common/errors';
import {
  handleSuccessfulRunCompletion,
  handleCancelledRun,
  handleFailedRun,
  type RunLifecycleDeps,
} from './run-lifecycle';
import { buildToolCatalogContent } from './prompts';
import { buildBudgetedSystemPrompt, LANE_PRIORITY, LANE_MAX_TOKENS, type PromptLane } from './prompt-budget';

// Extracted modules
import type { ToolExecution } from './runner-types';
import { sanitizeErrorMessage } from './runner-types';
import { autoCloseSession as autoCloseSessionImpl } from './session-closer';
import {
  emitSkillLoadOutcome,
  type SkillLoadResult,
} from './skills';
import { runWithSimpleLoop, runWithoutLLM } from './simple-loop';
import { AgentMemoryRuntime } from '../memory-graph/runtime';
import type { AgentMemoryBackend } from '../memory-graph/runtime';
import { RemoteToolExecutor } from './remote-tool-executor';
import {
  buildDelegationSystemMessage,
  buildDelegationUserMessage,
  getDelegationPacketFromRunInput,
} from './delegation';

// Re-export from split modules for backward compatibility
export {
  type EventEmitterState,
  createEventEmitterState,
  emitEventImpl,
  buildTerminalEventPayloadImpl,
} from './runner-events';

export {
  updateRunStatusImpl,
  isValidToolCallsArray,
  type ConversationHistoryDeps,
  normalizeRunStatus,
  buildConversationHistory,
} from './runner-messages';

// Re-export executeRun for backward compatibility (index.ts imports it from here)
export { executeRun } from './execute-run';

// Import what we need from split modules
import {
  type EventEmitterState,
  createEventEmitterState,
  emitEventImpl,
  buildTerminalEventPayloadImpl,
} from './runner-events';
import { normalizeRunStatus } from './runner-messages';

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
  }): Promise<SkillLoadResult>;
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
  private openAiKey: string | undefined;
  private anthropicKey: string | undefined;
  private googleKey: string | undefined;
  private llmClient: LLMClient | undefined;
  private context: AgentContext;
  private config: AgentConfig;
  private toolExecutor: ToolExecutorLike | undefined;
  private totalUsage = { inputTokens: 0, outputTokens: 0 };
  private availableSkills: SkillCatalogEntry[] = [];
  private selectedSkills: SkillSelection[] = [];
  private activatedSkills: SkillContext[] = [];
  private skillLocale: 'ja' | 'en' = 'en';
  private aiModel: string;
  private modelProvider: ModelProvider;
  private abortSignal?: AbortSignal;
  private toolCallCount = 0;
  private totalToolCalls = 0;
  private lastCancelCheck = 0;
  private isCancelled = false;
  private static readonly CANCEL_CHECK_INTERVAL_MS = 2000;

  private toolExecutions: ToolExecution[] = [];
  private eventState: EventEmitterState;
  private memoryRuntime?: AgentMemoryRuntime;
  private runIo: AgentRunnerIo;

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
    this.aiModel = aiModel;
    this.modelProvider = getProviderFromModel(aiModel);
    this.abortSignal = options.abortSignal;
    this.runIo = options.runIo;
    this.eventState = createEventEmitterState();

    this.openAiKey = apiKey || env.OPENAI_API_KEY;
    this.anthropicKey = env.ANTHROPIC_API_KEY;
    this.googleKey = env.GOOGLE_API_KEY;

    const providerKeyMap: Record<ModelProvider, string | undefined> = {
      openai: this.openAiKey,
      anthropic: this.anthropicKey,
      google: this.googleKey,
    };
    const providerKey = providerKeyMap[this.modelProvider];

    if (providerKey) {
      this.llmClient = createMultiModelClient({
        apiKey: providerKey,
        model: aiModel,
        anthropicApiKey: this.anthropicKey,
        googleApiKey: this.googleKey,
      });
    }
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
      aiModel: this.aiModel,
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

  private async resolveSkillPlan(history: AgentMessage[]): Promise<SkillLoadResult> {
    return this.runIo.resolveSkillPlan({
      runId: this.context.runId,
      threadId: this.context.threadId,
      spaceId: this.context.spaceId,
      agentType: this.config.type,
      history,
      availableToolNames: this.toolExecutor?.getAvailableTools().map((tool) => tool.name) ?? [],
    });
  }

  private createMemoryBackend(): AgentMemoryBackend | undefined {
    return {
      bootstrap: () => this.runIo.getMemoryActivation({ spaceId: this.context.spaceId }),
      finalize: ({ claims, evidence }) => this.runIo.finalizeMemoryOverlay({
        runId: this.context.runId,
        spaceId: this.context.spaceId,
        claims,
        evidence,
      }),
    };
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
    const canUseLangGraph = this.modelProvider === 'openai'
      && !!this.openAiKey;
    const engine = !this.llmClient
      ? 'none'
      : canUseLangGraph
        ? 'langgraph'
        : 'simple';

    await this.updateRunStatus('running');
    await this.emitEvent('started', {
      agent_type: this.config.type,
      engine,
    });

    if (!this.llmClient) {
      await this.emitEvent('thinking', {
        message: `Warning: No API key configured for ${this.modelProvider} (model: ${this.aiModel}). Running in limited mode without LLM.`,
        warning: true,
      });
    }

    await this.initToolExecutor();

    const history = await this.getConversationHistory();
    if (!this.llmClient) {
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
    const skillResult = await this.resolveSkillPlan(history);

    this.skillLocale = skillResult.skillLocale;
    this.availableSkills = skillResult.availableSkills;
    this.selectedSkills = skillResult.selectedSkills;
    this.activatedSkills = skillResult.activatedSkills;

    await emitSkillLoadOutcome(skillResult, this.emitEvent.bind(this));

    // Initialize memory runtime and wire observer + idempotency into tool executor
    try {
      this.memoryRuntime = new AgentMemoryRuntime(
        this.db,
        this.context,
        this.env,
        this.createMemoryBackend(),
      );
      await this.memoryRuntime.bootstrap();
      if (this.toolExecutor) {
        const observer = this.memoryRuntime.createToolObserver();
        this.toolExecutor.setObserver(observer);
      }
    } catch (err) {
      logWarn('Memory runtime initialization failed, continuing without memory', {
        module: 'services/agent/runner',
        detail: err,
      });
      this.memoryRuntime = undefined;
    }

    await this.throwIfCancelled('before-execution');

    return { engine, history };
  }

  // ── Engine execution ──────────────────────────────────────────────

  private async runWithLangGraph(history: AgentMessage[]): Promise<void> {
    if (!this.openAiKey) {
      throw new AuthenticationError('API key is required for LangGraph');
    }
    if (!this.toolExecutor) {
      throw new InternalError('Tool executor not initialized');
    }
    await runLangGraphRunner({
      apiKey: this.openAiKey,
      model: this.aiModel,
      systemPrompt: this.config.systemPrompt,
      skillPlan: {
        locale: this.skillLocale,
        availableSkills: this.availableSkills,
        selectableSkills: this.availableSkills.filter((skill) => skill.availability !== 'unavailable'),
        selectedSkills: this.selectedSkills,
        activatedSkills: this.activatedSkills,
      },
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
      memoryRuntime: this.memoryRuntime ?? undefined,
    });
  }

  private async runSimpleLoop(): Promise<void> {
    if (!this.llmClient) {
      throw new InternalError('No LLM client available');
    }
    await runWithSimpleLoop({
      env: this.env,
      config: this.config,
      llmClient: this.llmClient,
      toolExecutor: this.toolExecutor,
      skillLocale: this.skillLocale,
      availableSkills: this.availableSkills,
      selectedSkills: this.selectedSkills,
      activatedSkills: this.activatedSkills,
      spaceId: this.context.spaceId,
      abortSignal: this.abortSignal,
      toolExecutions: this.toolExecutions,
      totalUsage: this.totalUsage,
      toolCallCount: this.toolCallCount,
      totalToolCalls: this.totalToolCalls,
      memoryRuntime: this.memoryRuntime ?? undefined,
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
      if (this.memoryRuntime) {
        try {
          await this.memoryRuntime.finalize();
        } catch (err) {
          logWarn('Memory runtime finalize failed during cleanup', {
            module: 'services/agent/runner',
            detail: err,
          });
        }
        this.memoryRuntime = undefined;
      }

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
