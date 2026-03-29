/**
 * Agent Runner - Public API entry point.
 *
 * Contains the AgentRunner class (thin shell) and re-exports for backward
 * compatibility.
 *
 * Implementation is split into:
 *   - runner-io.ts          : AgentRunnerIo interface
 *   - runner-orchestration.ts : preparation, engine dispatch, cleanup, queue jobs
 *   - runner-events.ts      : event emission helpers
 *   - runner-history.ts     : run status, conversation history, message helpers
 *   - runner-utils.ts       : constants, utility functions, shared types
 *   - session-closer.ts     : auto-close session (snapshot + file sync)
 *   - skills.ts             : skill loading, resolution, and context
 *   - simple-loop.ts        : simple LLM loop and no-LLM fallback
 *   - execute-run.ts        : queue consumer entry point
 *   - llm-manager.ts        : LLM client initialization, model selection, API key management
 *   - skill-plan.ts         : skill plan resolution, catalog management, locale processing
 *   - memory-manager.ts     : memory runtime integration, memory graph processing
 */

import type { RunStatus, Env } from '../../../shared/types';
import type { ObjectStoreBinding, SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { AgentContext, AgentConfig, AgentEvent, AgentMessage } from './agent-models';
import type { ToolExecutorLike } from '../../tools/executor';
import { RunCancelledError } from './run-lifecycle';
import { getAgentConfig } from './runner-config';
import { DEFAULT_MODEL_ID } from './model-catalog';
import type { RunTerminalPayload } from '../run-notifier';
import { AppError } from 'takos-common/errors';
import { autoCloseSession as autoCloseSessionImpl } from './session-closer';

// IO interface (canonical source: runner-io.ts)
import type { AgentRunnerIo } from './runner-io';
export type { AgentRunnerIo } from './runner-io';

// Event helpers
import {
  type EventEmitterState,
  emitEventImpl,
  buildTerminalEventPayloadImpl,
} from './runner-events';

// Status helpers
import { normalizeRunStatus } from './runner-history';

// Manager state
import { createLLMState, type LLMState } from './llm-manager';
import type { SkillState, SkillPlanDeps } from './skill-plan';
import type { MemoryState, MemoryManagerDeps } from './memory-manager';

// Orchestration
import { runOrchestration, type OrchestrationDeps } from './runner-orchestration';

// Extracted modules used for type only
import type { ToolExecution } from './runner-utils';

// ── Re-exports for backward compatibility ────────────────────────────

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

export { executeRun } from './execute-run';

// ── AgentRunner class ────────────────────────────────────────────────

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
  private skillDeps: SkillPlanDeps;
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

  // ── Build orchestration deps ──────────────────────────────────────

  private buildOrchestrationDeps(): OrchestrationDeps {
    return {
      env: this.env,
      db: this.db,
      context: this.context,
      config: this.config,
      runIo: this.runIo,
      abortSignal: this.abortSignal,
      llm: this.llm,
      skillState: this.skillState,
      skillDeps: this.skillDeps,
      memoryState: this.memoryState,
      memoryDeps: this.memoryDeps,
      eventState: this.eventState,
      toolExecutions: this.toolExecutions,
      totalUsage: this.totalUsage,
      toolCallCount: this.toolCallCount,
      totalToolCalls: this.totalToolCalls,
      emitEvent: this.emitEvent.bind(this),
      updateRunStatus: this.updateRunStatus.bind(this),
      buildTerminalEventPayload: this.buildTerminalEventPayload.bind(this),
      autoCloseSession: this.autoCloseSession.bind(this),
      throwIfCancelled: this.throwIfCancelled.bind(this),
      checkCancellation: this.checkCancellation.bind(this),
      getConversationHistory: this.getConversationHistory.bind(this),
      addMessage: this.addMessage.bind(this),
      getCurrentSessionId: this.getCurrentSessionId.bind(this),
      getRunRecord: this.getRunRecord.bind(this),
      getToolExecutor: () => this.toolExecutor,
      setToolExecutor: (te) => { this.toolExecutor = te; },
    };
  }

  // ── Main entry point ──────────────────────────────────────────────

  async run(): Promise<void> {
    await runOrchestration(this.buildOrchestrationDeps());
  }
}
