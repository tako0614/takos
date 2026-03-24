/**
 * Tool Execution Worker — Multi-agent wrapper for ToolExecutor.
 *
 * Exposes the existing {@link ToolExecutorLike} interface as an
 * {@link AbstractAgentWorker} so the AgentCoordinator can dispatch
 * tool execution requests to it via the standard message protocol.
 *
 * Supported execution modes:
 *   - **sequential** — tool calls are executed one after another,
 *     preserving ordering guarantees required by stateful tools.
 *   - **parallel** — independent tool calls run concurrently with a
 *     configurable concurrency cap.
 *
 * The worker also handles three message types:
 *   - `execute-tool`       — run a single tool call
 *   - `execute-batch`      — run multiple tool calls (seq or parallel)
 *   - `get-available-tools` — return the current tool catalog
 */

import type { ToolExecutorLike } from '../../tools/executor';
import type { ToolCall, ToolResult, ToolDefinition } from '../../tools/types';
import { AbstractAgentWorker } from '../multi-agent/base-worker';
import type { AgentWorkerConfig, AgentMessage } from '../multi-agent/types';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';

// ── Input / Output contracts ────────────────────────────────────────

/** Input payload accepted by {@link ToolExecutionWorker.execute}. */
export interface ToolExecutionInput {
  toolCalls: ToolCall[];
  mode: 'sequential' | 'parallel';
}

/** Result returned once all tool calls have completed. */
export interface ToolExecutionOutput {
  results: ToolResult[];
  executionTime: number;
}

// ── Message payload types ───────────────────────────────────────────

/** Payload for an `execute-tool` message. */
interface ExecuteToolPayload {
  toolCall: ToolCall;
}

/** Payload for an `execute-batch` message. */
interface ExecuteBatchPayload {
  toolCalls: ToolCall[];
  mode: 'sequential' | 'parallel';
}

/** Recognised inbound message types. */
type ToolWorkerMessageType =
  | 'execute-tool'
  | 'execute-batch'
  | 'get-available-tools';

// ── Worker implementation ───────────────────────────────────────────

/**
 * Multi-agent worker that delegates tool execution to a
 * {@link ToolExecutorLike} instance.
 *
 * Usage:
 * ```ts
 * const worker = new ToolExecutionWorker(executor);
 * await worker.initialize(config);
 *
 * // Via execute()
 * const output = await worker.execute({
 *   toolCalls: [{ id: '1', name: 'file_read', arguments: { path: '/foo' } }],
 *   mode: 'sequential',
 * });
 *
 * // Via message
 * const response = await worker.handleMessage(message);
 * ```
 */
export class ToolExecutionWorker extends AbstractAgentWorker<
  ToolExecutionInput,
  ToolExecutionOutput
> {
  /** The underlying tool executor provided at construction time. */
  private executor: ToolExecutorLike;

  /** Whether the circuit breaker has tripped. */
  private circuitOpen = false;

  /** Running count of consecutive failures (used for circuit breaker heuristics). */
  private consecutiveFailures = 0;

  /** Threshold after which the worker will mark its circuit as open. */
  private static readonly CIRCUIT_OPEN_THRESHOLD = 10;

  /** How many failures to recover before re-closing the circuit. */
  private static readonly CIRCUIT_CLOSE_AFTER_SUCCESS = 3;

  /** Counter for successful executions after the circuit opened. */
  private successAfterOpen = 0;

  constructor(executor: ToolExecutorLike, id?: string) {
    super('tool-executor', id);
    this.executor = executor;
  }

  // ── Lifecycle hooks ───────────────────────────────────────────────

  /**
   * Called during {@link AbstractAgentWorker.initialize}.
   * Validates that the executor is ready.
   */
  protected async onInitialize(_config: AgentWorkerConfig): Promise<void> {
    logInfo(`ToolExecutionWorker ${this.id} initializing`, { module: 'tool-worker' });

    // Verify the executor can enumerate tools (basic health check).
    const tools = this.executor.getAvailableTools();
    logInfo(`ToolExecutionWorker ${this.id} ready with ${tools.length} tools`, {
      module: 'tool-worker',
    });
  }

  /**
   * Execute a batch of tool calls in the requested mode.
   *
   * This is the primary entry point used by the coordinator's
   * workflow engine.
   */
  protected async onExecute(
    input: ToolExecutionInput,
    signal?: AbortSignal,
  ): Promise<ToolExecutionOutput> {
    const startTime = Date.now();
    const { toolCalls, mode } = input;

    if (toolCalls.length === 0) {
      return { results: [], executionTime: 0 };
    }

    this.throwIfAborted(signal);

    let results: ToolResult[];

    if (mode === 'parallel') {
      results = await this.executeParallel(toolCalls, signal);
    } else {
      results = await this.executeSequential(toolCalls, signal);
    }

    const executionTime = Date.now() - startTime;

    return { results, executionTime };
  }

  // ── Inter-agent messaging ─────────────────────────────────────────

  /**
   * Handle messages from other agents.
   *
   * Supported message types:
   *   - `execute-tool`        — execute a single tool call
   *   - `execute-batch`       — execute multiple tool calls
   *   - `get-available-tools` — return the tool catalog
   */
  protected async onMessage(message: AgentMessage): Promise<unknown> {
    const type = message.type as ToolWorkerMessageType;

    switch (type) {
      case 'execute-tool': {
        const payload = message.payload as ExecuteToolPayload;
        return this.executeSingleTool(payload.toolCall);
      }

      case 'execute-batch': {
        const payload = message.payload as ExecuteBatchPayload;
        const startTime = Date.now();
        const results =
          payload.mode === 'parallel'
            ? await this.executeParallel(payload.toolCalls)
            : await this.executeSequential(payload.toolCalls);
        return {
          results,
          executionTime: Date.now() - startTime,
        } satisfies ToolExecutionOutput;
      }

      case 'get-available-tools': {
        const tools = this.executor.getAvailableTools();
        return {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            category: t.category,
            parameters: t.parameters,
          })),
          count: tools.length,
        };
      }

      default:
        return super['onMessage'](message);
    }
  }

  /**
   * Clean up the underlying executor on shutdown.
   */
  protected async onShutdown(): Promise<void> {
    logInfo(`ToolExecutionWorker ${this.id} shutting down`, { module: 'tool-worker' });
    try {
      await this.executor.cleanup();
    } catch (err) {
      logWarn(`ToolExecutionWorker ${this.id} cleanup error`, {
        module: 'tool-worker',
        detail: err,
      });
    }
  }

  // ── Execution strategies ──────────────────────────────────────────

  /**
   * Execute tool calls one at a time, in order.
   *
   * If the circuit breaker is open, calls are short-circuited with an
   * error result.
   */
  private async executeSequential(
    toolCalls: ToolCall[],
    signal?: AbortSignal,
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      this.throwIfAborted(signal);

      if (this.circuitOpen) {
        results.push({
          tool_call_id: toolCall.id,
          output: '',
          error: 'Tool execution circuit breaker is open — too many consecutive failures',
        });
        continue;
      }

      const result = await this.executeSingleTool(toolCall);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute tool calls concurrently using {@link Promise.allSettled}.
   *
   * Each call is wrapped individually so a single failure does not
   * prevent others from completing.
   */
  private async executeParallel(
    toolCalls: ToolCall[],
    signal?: AbortSignal,
  ): Promise<ToolResult[]> {
    this.throwIfAborted(signal);

    if (this.circuitOpen) {
      return toolCalls.map((tc) => ({
        tool_call_id: tc.id,
        output: '',
        error: 'Tool execution circuit breaker is open — too many consecutive failures',
      }));
    }

    const settled = await Promise.allSettled(
      toolCalls.map((tc) => this.executeSingleTool(tc)),
    );

    return settled.map((result, idx) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      return {
        tool_call_id: toolCalls[idx].id,
        output: '',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      };
    });
  }

  /**
   * Execute a single tool call through the underlying executor,
   * updating circuit breaker state on success/failure.
   */
  private async executeSingleTool(toolCall: ToolCall): Promise<ToolResult> {
    try {
      const result = await this.executor.execute(toolCall);

      // Track circuit breaker state.
      if (result.error) {
        this.recordFailure();
      } else {
        this.recordSuccess();
      }

      return result;
    } catch (err) {
      this.recordFailure();
      const errorMessage = err instanceof Error ? err.message : String(err);
      logError(
        `ToolExecutionWorker ${this.id} tool ${toolCall.name} failed`,
        errorMessage,
        { module: 'tool-worker' },
      );
      return {
        tool_call_id: toolCall.id,
        output: '',
        error: errorMessage,
      };
    }
  }

  // ── Circuit breaker helpers ───────────────────────────────────────

  /**
   * Record a failed execution and potentially open the circuit.
   */
  private recordFailure(): void {
    this.consecutiveFailures++;
    this.successAfterOpen = 0;

    if (
      !this.circuitOpen &&
      this.consecutiveFailures >= ToolExecutionWorker.CIRCUIT_OPEN_THRESHOLD
    ) {
      this.circuitOpen = true;
      logWarn(
        `ToolExecutionWorker ${this.id} circuit breaker OPEN after ${this.consecutiveFailures} consecutive failures`,
        { module: 'tool-worker' },
      );
    }
  }

  /**
   * Record a successful execution and potentially re-close the circuit.
   */
  private recordSuccess(): void {
    this.consecutiveFailures = 0;

    if (this.circuitOpen) {
      this.successAfterOpen++;
      if (this.successAfterOpen >= ToolExecutionWorker.CIRCUIT_CLOSE_AFTER_SUCCESS) {
        this.circuitOpen = false;
        this.successAfterOpen = 0;
        logInfo(`ToolExecutionWorker ${this.id} circuit breaker CLOSED`, {
          module: 'tool-worker',
        });
      }
    }
  }

  // ── Public helpers ────────────────────────────────────────────────

  /** Whether the circuit breaker is currently open. */
  get isCircuitOpen(): boolean {
    return this.circuitOpen;
  }

  /** Return the full list of tools exposed by the underlying executor. */
  getAvailableTools(): ToolDefinition[] {
    return this.executor.getAvailableTools();
  }
}
