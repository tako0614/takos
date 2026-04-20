import type {
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./tool-definitions.ts";
import type { ToolResolver } from "./resolver.ts";
import { CircuitBreaker, type CircuitStats } from "./circuit-breaker.ts";
import type { ToolObserver } from "../services/memory-graph/graph-models.ts";
import { checkIdempotency, completeOperation } from "./idempotency.ts";
import { logError, logInfo, logWarn } from "../../shared/utils/logger.ts";
import {
  MAX_PARALLEL_TOOL_EXECUTIONS,
  MAX_TOOL_OUTPUT_SIZE,
} from "../../shared/config/limits.ts";
import { AGENT_TOOL_EXECUTION_TIMEOUT_MS } from "../../shared/config/timeouts.ts";
import type { SqlDatabaseBinding } from "../../shared/types/bindings.ts";

// Re-export error-classifier types so existing consumers keep working
export { ErrorCodes, ToolError } from "./tool-error-classifier.ts";
export type { ErrorCode, ErrorSeverity } from "./tool-error-classifier.ts";

// Extracted modules
import { classifyError, SEVERITY_HINTS } from "./tool-error-classifier.ts";
import {
  assertToolPermission,
  filterAccessibleTools,
} from "./tool-permission.ts";
import { ToolCircuitBreaker } from "./tool-circuit-breaker.ts";

// Re-export from split modules for backward compatibility
export { createToolExecutor, SessionState } from "./executor-setup.ts";
export {
  buildPerRunCapabilityRegistry,
  toOpenAIFunctions,
} from "./executor-utils.ts";

import type { SessionState } from "./executor-setup.ts";

export interface ToolExecutorLike {
  execute(toolCall: ToolCall): Promise<ToolResult>;
  getAvailableTools(): ToolDefinition[];
  readonly mcpFailedServers: string[];
  setObserver(observer: ToolObserver): void;
  cleanup(): void | Promise<void>;
}

// 10MB per tool output — with MAX_PARALLEL_EXECUTIONS=5, worst-case total is
// 50MB which stays within ~40% of the Workers 128MB heap limit.
// MAX_TOOL_OUTPUT_SIZE imported from shared/config/limits
// Keep this aligned with runner-config default (5 minutes) unless explicitly overridden.
// AGENT_TOOL_EXECUTION_TIMEOUT_MS imported from shared/config/timeouts

/**
 * Local withTimeout variant that supports an onTimeout callback, used to abort
 * the tool-execution AbortController on timeout. The shared
 * `shared/utils/with-timeout` does not support this callback, so we keep a
 * local copy here. If the shared version gains an onTimeout hook in the future,
 * this should be replaced.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (onTimeout) {
        try {
          onTimeout();
        } catch (timeoutErr) {
          logWarn("Failed to execute timeout handler", {
            module: "tools/executor",
            error: timeoutErr instanceof Error
              ? timeoutErr.message
              : String(timeoutErr),
          });
        }
      }
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

interface TruncationInfo {
  wasTruncated: boolean;
  originalLength?: number;
  truncatedLength?: number;
}

function truncateOutput(
  output: string,
): { output: string; truncation: TruncationInfo } {
  if (typeof output !== "string") {
    output = String(output);
  }

  if (output.length <= MAX_TOOL_OUTPUT_SIZE) {
    return { output, truncation: { wasTruncated: false } };
  }

  const halfSize = Math.floor((MAX_TOOL_OUTPUT_SIZE - 200) / 2);
  const truncated = output.slice(0, halfSize) +
    `\n\n... [OUTPUT TRUNCATED: ${output.length} chars total, showing first and last ${halfSize} chars] ...\n\n` +
    output.slice(-halfSize);

  logWarn(
    `Tool output truncated from ${output.length} to ${truncated.length} chars`,
    { module: "tools/executor" },
  );

  return {
    output: truncated,
    truncation: {
      wasTruncated: true,
      originalLength: output.length,
      truncatedLength: truncated.length,
    },
  };
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

export class ToolExecutor implements ToolExecutorLike {
  private resolver: ToolResolver;
  private context: ToolContext;
  private sessionState: SessionState;
  private circuitBreaker: ToolCircuitBreaker;
  private toolExecutionTimeoutMs: number;
  private parallelExecutionCount = 0;
  private observer: ToolObserver | null = null;
  private sideEffectTools = new Set<string>();
  private db: SqlDatabaseBinding | null = null;
  // 5 parallel executions × 10MB max output = 50MB worst case, safely under
  // the Workers 128MB heap limit with room for code, stack, and framework overhead.
  private static readonly MAX_PARALLEL_EXECUTIONS =
    MAX_PARALLEL_TOOL_EXECUTIONS;

  constructor(
    resolver: ToolResolver,
    context: ToolContext,
    sessionState: SessionState,
    circuitBreaker?: CircuitBreaker,
    toolExecutionTimeoutMs?: number,
  ) {
    this.resolver = resolver;
    this.context = context;
    this.sessionState = sessionState;
    this.circuitBreaker = new ToolCircuitBreaker(
      circuitBreaker || new CircuitBreaker(),
    );
    this.toolExecutionTimeoutMs = toolExecutionTimeoutMs ||
      AGENT_TOOL_EXECUTION_TIMEOUT_MS;
    this.observer = null;
  }

  setObserver(observer: ToolObserver): void {
    this.observer = observer;
  }

  setSideEffectTools(toolNames: string[]): void {
    this.sideEffectTools = new Set(toolNames);
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    // --- Circuit-breaker guard ---
    const blocked = this.circuitBreaker.guard(toolCall.id, toolCall.name);
    if (blocked) {
      return blocked;
    }

    const startTime = Date.now();
    let observedOutput = "";
    let observedError: string | undefined;

    // Freeze sessionId for this execution to prevent race conditions
    const frozenSessionId = this.sessionState.beginExecution();
    const abortController = new AbortController();

    const executionAbortSignal = this.context.abortSignal
      ? anySignal([abortController.signal, this.context.abortSignal])
      : abortController.signal;

    const executionContext: ToolContext = {
      ...this.context,
      get sessionId() {
        return frozenSessionId;
      },
      setSessionId: this.context.setSessionId,
      getLastContainerStartFailure: this.context.getLastContainerStartFailure,
      setLastContainerStartFailure: this.context.setLastContainerStartFailure,
      abortSignal: executionAbortSignal,
    };

    try {
      const tool = this.resolver.resolve(toolCall.name);

      if (!tool) {
        return {
          tool_call_id: toolCall.id,
          output: "",
          error: `Unknown tool: ${toolCall.name}`,
        };
      }

      // --- Permission checks (delegated) ---
      assertToolPermission(toolCall.name, tool.definition, executionContext);

      // Idempotency guard for side-effect tools
      if (this.sideEffectTools.has(toolCall.name) && this.db) {
        const idempotencyResult = await checkIdempotency(
          this.db,
          this.context.runId,
          toolCall.name,
          toolCall.arguments,
        );

        if (idempotencyResult.action === "cached") {
          observedOutput = idempotencyResult.cachedOutput ?? "";
          observedError = idempotencyResult.cachedError;
          return {
            tool_call_id: toolCall.id,
            output: observedOutput,
            error: observedError,
          };
        }

        if (idempotencyResult.action === "in_progress") {
          observedError =
            `Tool "${toolCall.name}" is already executing with the same parameters. Please wait.`;
          return {
            tool_call_id: toolCall.id,
            output: "",
            error: observedError,
          };
        }

        // action === 'execute' — proceed with recording
        const operationId = idempotencyResult.operationId!;
        try {
          const rawOutput = await withTimeout(
            tool.handler(toolCall.arguments, executionContext),
            this.toolExecutionTimeoutMs,
            `Tool '${toolCall.name}' execution timed out after ${
              this.toolExecutionTimeoutMs / 1000
            } seconds`,
            () => abortController.abort(),
          );

          const { output, truncation } = truncateOutput(rawOutput);
          this.circuitBreaker.recordSuccess(toolCall.name);
          await completeOperation(this.db!, operationId, output);

          observedOutput = output;
          const result: ToolResult = { tool_call_id: toolCall.id, output };
          if (truncation.wasTruncated) {
            result.error =
              `[NOTICE] Output was truncated from ${truncation.originalLength} to ${truncation.truncatedLength} chars.`;
          }
          return result;
        } catch (sideEffectError) {
          const errMsg = sideEffectError instanceof Error
            ? sideEffectError.message
            : String(sideEffectError);
          await completeOperation(this.db!, operationId, "", errMsg).catch(
            (opErr) => {
              logWarn(
                "Failed to complete operation record after tool error (non-critical)",
                { module: "tools", error: opErr, operationId },
              );
            },
          );
          throw sideEffectError;
        }
      }

      const rawOutput = await withTimeout(
        tool.handler(toolCall.arguments, executionContext),
        this.toolExecutionTimeoutMs,
        `Tool '${toolCall.name}' execution timed out after ${
          this.toolExecutionTimeoutMs / 1000
        } seconds`,
        () => abortController.abort(),
      );

      const { output, truncation } = truncateOutput(rawOutput);
      this.circuitBreaker.recordSuccess(toolCall.name);

      const result: ToolResult = {
        tool_call_id: toolCall.id,
        output,
      };

      if (truncation.wasTruncated) {
        result.error =
          `[NOTICE] Output was truncated from ${truncation.originalLength} to ${truncation.truncatedLength} chars. ` +
          `The full output may contain additional relevant information.`;
      }

      observedOutput = output;
      return result;
    } catch (error) {
      const errorInstance = error instanceof Error
        ? error
        : new Error(String(error));
      const errorMessage = errorInstance.message;

      const classification = classifyError(errorInstance);
      const errorSeverity = classification.severity;

      // --- Circuit-breaker failure recording (delegated) ---
      this.circuitBreaker.recordClassifiedFailure(toolCall.name, errorInstance);

      const toolContext = JSON.stringify({
        tool: toolCall.name,
        id: toolCall.id,
        argKeys: Object.keys(toolCall.arguments || {}),
        spaceId: this.context.spaceId?.slice(0, 8),
        sessionActive: !!frozenSessionId,
      });

      const codePrefix = classification.code ? `[${classification.code}] ` : "";
      const severityHint = SEVERITY_HINTS[errorSeverity] ??
        " (This may be a temporary issue, consider retrying)";

      logError(`Tool execution error: ${errorMessage}`, {
        context: toolContext,
        stack: errorInstance.stack,
      }, { module: "tools/executor" });

      observedError = errorMessage;
      return {
        tool_call_id: toolCall.id,
        output: "",
        error: codePrefix + errorMessage + severityHint,
      };
    } finally {
      this.sessionState.endExecution();

      if (this.observer) {
        try {
          this.observer.observe({
            toolName: toolCall.name,
            arguments: toolCall.arguments,
            result: observedOutput,
            error: observedError,
            timestamp: startTime,
            duration: Date.now() - startTime,
          });
        } catch {
          // best-effort observation
        }
      }
    }
  }

  getCircuitBreakerState(toolName: string): CircuitStats {
    return this.circuitBreaker.getState(toolName);
  }

  resetCircuitBreaker(toolName?: string): void {
    this.circuitBreaker.reset(toolName);
  }

  async executeAll(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      const result = await this.execute(toolCall);
      results.push(result);
    }

    return results;
  }

  async executeParallel(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    if (toolCalls.length > ToolExecutor.MAX_PARALLEL_EXECUTIONS) {
      logWarn(
        `Limiting parallel tool executions from ${toolCalls.length} to ${ToolExecutor.MAX_PARALLEL_EXECUTIONS}`,
        { module: "tools/executor" },
      );
    }

    const allResults: ToolResult[] = [];
    for (
      let i = 0;
      i < toolCalls.length;
      i += ToolExecutor.MAX_PARALLEL_EXECUTIONS
    ) {
      const batch = toolCalls.slice(
        i,
        i + ToolExecutor.MAX_PARALLEL_EXECUTIONS,
      );

      this.parallelExecutionCount++;
      const batchId = this.parallelExecutionCount;

      const batchStartTime = Date.now();
      const results = await Promise.allSettled(
        batch.map((tc) => this.execute(tc)),
      );
      const batchDuration = Date.now() - batchStartTime;

      const failures = results.filter((r) => r.status === "rejected").length;
      if (failures > 0 || batchDuration > 10000) {
        logInfo(
          `Parallel batch ${batchId}: ${batch.length} tools, ${failures} failures, ${batchDuration}ms`,
          { module: "tools/executor" },
        );
      }

      const batchResults = results.map((result, index) => {
        if (result.status === "fulfilled") {
          return result.value;
        } else {
          return {
            tool_call_id: batch[index].id,
            output: "",
            error: result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
          };
        }
      });

      allResults.push(...batchResults);
    }

    return allResults;
  }

  getAvailableTools() {
    return filterAccessibleTools(
      this.resolver.getAvailableTools(),
      this.context.role,
      this.context.capabilities || [],
    );
  }

  get mcpFailedServers(): string[] {
    return this.resolver.mcpFailedServers;
  }

  cleanup(): void {
    this.sessionState.cleanup();
  }
}
