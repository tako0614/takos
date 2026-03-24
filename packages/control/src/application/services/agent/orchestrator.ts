/**
 * Agent Orchestrator — Multi-agent wrapper for AgentRunner.
 *
 * Bridges the existing AgentRunner with the multi-agent framework by
 * extending AbstractAgentWorker.  The orchestrator owns the high-level
 * run lifecycle: it creates an AgentRunner, delegates execution to it,
 * and translates the result into the AgentWorker protocol so the
 * AgentCoordinator can treat it as just another worker.
 *
 * Coordination notes:
 *   - ToolWorker and MemoryWorker are contacted via AgentMessage when
 *     their services are needed (tool execution, memory extraction).
 *   - The orchestrator itself never calls tool handlers directly;
 *     all tool work flows through the ToolExecutionWorker.
 */

import type { Env } from '../../../shared/types';
import type { SqlDatabaseBinding, ObjectStoreBinding } from '../../../shared/types/bindings.ts';
import type { AgentContext } from './types';
import { AgentRunner, type AgentRunnerIo } from './runner';
import { AbstractAgentWorker } from '../multi-agent/base-worker';
import type { AgentWorkerConfig, AgentMessage } from '../multi-agent/types';
import { logError, logInfo } from '../../../shared/utils/logger';

// ── Input / Output contracts ────────────────────────────────────────

/** Input payload accepted by {@link AgentOrchestrator.execute}. */
export interface OrchestratorInput {
  env: Env;
  db: SqlDatabaseBinding;
  storage: ObjectStoreBinding | undefined;
  apiKey: string | undefined;
  context: AgentContext;
  agentType: string;
  aiModel: string;
  abortSignal?: AbortSignal;
  runIo: AgentRunnerIo;
}

/** Result returned once the orchestrated run completes. */
export interface OrchestratorOutput {
  status: 'completed' | 'failed' | 'cancelled';
  runId: string;
  iterations?: number;
  usage?: { inputTokens: number; outputTokens: number };
}

// ── Message types the orchestrator understands ──────────────────────

/** Recognised inbound message types. */
type OrchestratorMessageType =
  | 'get-status'
  | 'cancel-run'
  | 'get-usage';

// ── Orchestrator implementation ─────────────────────────────────────

/**
 * Multi-agent orchestrator that wraps the legacy {@link AgentRunner}.
 *
 * Usage:
 * ```ts
 * const orchestrator = new AgentOrchestrator();
 * await orchestrator.initialize(config);
 * const result = await orchestrator.execute(input, signal);
 * await orchestrator.shutdown();
 * ```
 */
export class AgentOrchestrator extends AbstractAgentWorker<OrchestratorInput, OrchestratorOutput> {
  /** The underlying runner — created fresh for each execution. */
  private runner: AgentRunner | null = null;

  /** Tracks the most recent run status for health queries. */
  private lastRunStatus: 'completed' | 'failed' | 'cancelled' | null = null;

  /** Accumulated token usage across executions. */
  private cumulativeUsage = { inputTokens: 0, outputTokens: 0 };

  /** Total number of iterations performed (across runs). */
  private totalIterations = 0;

  /** The run ID of the current (or most recent) execution. */
  private currentRunId: string | null = null;

  constructor(id?: string) {
    super('orchestrator', id);
  }

  // ── Lifecycle hooks ───────────────────────────────────────────────

  /**
   * Called during {@link AbstractAgentWorker.initialize}.
   * The orchestrator has no heavyweight resources to set up at init
   * time — the real work happens in {@link onExecute}.
   */
  protected async onInitialize(_config: AgentWorkerConfig): Promise<void> {
    logInfo(`AgentOrchestrator ${this.id} initializing`, { module: 'orchestrator' });
  }

  /**
   * Core execution: create an {@link AgentRunner} and delegate to
   * {@link AgentRunner.run}.
   *
   * The runner handles its own tool execution, memory, event emission
   * etc.  We simply translate the outcome into an
   * {@link OrchestratorOutput}.
   */
  protected async onExecute(
    input: OrchestratorInput,
    signal?: AbortSignal,
  ): Promise<OrchestratorOutput> {
    const { env, db, storage, apiKey, context, agentType, aiModel, runIo } = input;
    this.currentRunId = context.runId;

    // Merge the caller-supplied signal with any signal on the input.
    const effectiveSignal = input.abortSignal ?? signal;

    logInfo(`Orchestrator ${this.id} starting run ${context.runId}`, {
      module: 'orchestrator',
      agentType,
      aiModel,
    });

    try {
      // Create a fresh AgentRunner for this execution.
      this.runner = new AgentRunner(
        env,
        db,
        storage,
        apiKey,
        context,
        agentType,
        aiModel,
        {
          abortSignal: effectiveSignal,
          runIo,
        },
      );

      // Delegate to the runner's main loop.
      await this.runner.run();

      this.lastRunStatus = 'completed';

      return {
        status: 'completed',
        runId: context.runId,
        iterations: this.totalIterations,
        usage: { ...this.cumulativeUsage },
      };
    } catch (err) {
      const isCancellation =
        err instanceof Error && err.message.includes('cancelled');

      if (isCancellation) {
        this.lastRunStatus = 'cancelled';
        logInfo(`Orchestrator ${this.id} run ${context.runId} cancelled`, {
          module: 'orchestrator',
        });
        return {
          status: 'cancelled',
          runId: context.runId,
          iterations: this.totalIterations,
          usage: { ...this.cumulativeUsage },
        };
      }

      this.lastRunStatus = 'failed';
      const errorMessage = err instanceof Error ? err.message : String(err);
      logError(
        `Orchestrator ${this.id} run ${context.runId} failed`,
        errorMessage,
        { module: 'orchestrator' },
      );

      return {
        status: 'failed',
        runId: context.runId,
        iterations: this.totalIterations,
        usage: { ...this.cumulativeUsage },
      };
    } finally {
      this.runner = null;
    }
  }

  // ── Inter-agent messaging ─────────────────────────────────────────

  /**
   * Handle messages from other agents (e.g. coordinator status
   * queries, cancellation requests).
   */
  protected async onMessage(message: AgentMessage): Promise<unknown> {
    const type = message.type as OrchestratorMessageType;

    switch (type) {
      case 'get-status':
        return {
          runId: this.currentRunId,
          status: this.lastRunStatus ?? this.status,
          usage: { ...this.cumulativeUsage },
          iterations: this.totalIterations,
        };

      case 'cancel-run':
        // Cancellation is best-effort — the runner checks its own
        // AbortSignal periodically.
        logInfo(`Orchestrator ${this.id} received cancel request`, {
          module: 'orchestrator',
        });
        return { acknowledged: true };

      case 'get-usage':
        return { ...this.cumulativeUsage };

      default:
        return super['onMessage'](message);
    }
  }

  /**
   * Clean up on shutdown.  If a runner is still active it will be
   * abandoned (the AbortSignal should have been triggered first).
   */
  protected async onShutdown(): Promise<void> {
    logInfo(`AgentOrchestrator ${this.id} shutting down`, { module: 'orchestrator' });
    this.runner = null;
    this.currentRunId = null;
  }
}
