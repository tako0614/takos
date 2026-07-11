import type {
  ToolCall,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./tool-definitions.ts";
import {
  ToolExecutionTimeoutError,
  ToolExecutionUncertainError,
} from "./tool-definitions.ts";
import type { ToolResolver } from "./resolver.ts";
import { CircuitBreaker, type CircuitStats } from "./circuit-breaker.ts";
import {
  checkIdempotency,
  completeOperation,
  markOperationUncertain,
} from "./idempotency.ts";
import { logError, logInfo, logWarn } from "../../shared/utils/logger.ts";
import {
  MAX_PARALLEL_TOOL_EXECUTIONS,
  MAX_TOOL_ERROR_SIZE,
  MAX_TOOL_OUTPUT_SIZE,
} from "../../shared/config/limits.ts";
import { AGENT_TOOL_EXECUTION_TIMEOUT_MS } from "../../shared/config/timeouts.ts";
import type { SqlDatabaseBinding } from "../../shared/types/bindings.ts";

// Public error-classifier exports.
export { ErrorCodes, ToolError } from "./tool-error-classifier.ts";
export type { ErrorCode, ErrorSeverity } from "./tool-error-classifier.ts";

// Extracted modules
import { classifyError, SEVERITY_HINTS } from "./tool-error-classifier.ts";
import {
  assertToolPermission,
  filterAccessibleTools,
} from "./tool-permission.ts";
import { ToolCircuitBreaker } from "./tool-circuit-breaker.ts";
import { combineSignals } from "@takos/worker-platform-utils/abort";
import { assertValidToolArguments } from "./argument-validator.ts";

// Public executor setup exports.
export { createToolExecutor } from "./executor-setup.ts";
export {
  buildPerRunCapabilityRegistry,
  toOpenAIFunctions,
} from "./executor-utils.ts";

export interface ToolExecutorLike {
  execute(toolCall: ToolCall): Promise<ToolResult>;
  getAvailableTools(): ToolDefinition[];
  readonly mcpFailedServers: string[];
  cleanup(): void | Promise<void>;
}

// MAX_TOOL_OUTPUT_SIZE is also part of the atomic run-transcript budget. Keep
// it aligned with complete-run's total payload bound, not merely the isolate's
// instantaneous heap limit.
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
            error:
              timeoutErr instanceof Error
                ? timeoutErr.message
                : String(timeoutErr),
          });
        }
      }
      reject(new ToolExecutionTimeoutError(errorMessage));
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

function decodeUtf8Prefix(bytes: Uint8Array, maxBytes: number): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = Math.min(bytes.byteLength, maxBytes); end >= 0; end--) {
    try {
      return decoder.decode(bytes.subarray(0, end));
    } catch {
      // A UTF-8 code point is at most four bytes, so this normally retries no
      // more than three times. Keep the loop total for defensive correctness.
    }
  }
  return "";
}

function decodeUtf8Suffix(bytes: Uint8Array, maxBytes: number): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const initial = Math.max(0, bytes.byteLength - maxBytes);
  for (let start = initial; start <= bytes.byteLength; start++) {
    try {
      return decoder.decode(bytes.subarray(start));
    } catch {
      // Skip a partial leading code point.
    }
  }
  return "";
}

export function truncateToolOutput(output: string): {
  output: string;
  truncation: TruncationInfo;
} {
  if (typeof output !== "string") {
    output = String(output);
  }

  const encoder = new TextEncoder();
  const encoded = encoder.encode(output);
  if (encoded.byteLength <= MAX_TOOL_OUTPUT_SIZE) {
    return { output, truncation: { wasTruncated: false } };
  }

  const notice = `\n\n... [OUTPUT TRUNCATED: ${encoded.byteLength} UTF-8 bytes total; showing bounded prefix and suffix] ...\n\n`;
  const noticeBytes = encoder.encode(notice).byteLength;
  const halfSize = Math.max(
    0,
    Math.floor((MAX_TOOL_OUTPUT_SIZE - noticeBytes) / 2),
  );
  const truncated =
    decodeUtf8Prefix(encoded, halfSize) +
    notice +
    decodeUtf8Suffix(encoded, halfSize);
  const truncatedBytes = encoder.encode(truncated).byteLength;

  logWarn(
    `Tool output truncated from ${encoded.byteLength} to ${truncatedBytes} UTF-8 bytes`,
    { module: "tools/executor" },
  );

  return {
    output: truncated,
    truncation: {
      wasTruncated: true,
      originalLength: encoded.byteLength,
      truncatedLength: truncatedBytes,
    },
  };
}

export function truncateToolError(error: string): string {
  const value = typeof error === "string" ? error : String(error);
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= MAX_TOOL_ERROR_SIZE) return value;
  const notice = `\n... [ERROR TRUNCATED: ${encoded.byteLength} UTF-8 bytes total]`;
  const budget = Math.max(
    0,
    MAX_TOOL_ERROR_SIZE - new TextEncoder().encode(notice).byteLength,
  );
  return decodeUtf8Prefix(encoded, budget) + notice;
}

export class ToolExecutor implements ToolExecutorLike {
  private resolver: ToolResolver;
  private context: ToolContext;
  private circuitBreaker: ToolCircuitBreaker;
  private toolExecutionTimeoutMs: number;
  private parallelExecutionCount = 0;
  private sideEffectTools = new Set<string>();
  private db: SqlDatabaseBinding | null = null;
  private static readonly MAX_PARALLEL_EXECUTIONS =
    MAX_PARALLEL_TOOL_EXECUTIONS;

  constructor(
    resolver: ToolResolver,
    context: ToolContext,
    circuitBreaker?: CircuitBreaker,
    toolExecutionTimeoutMs?: number,
  ) {
    this.resolver = resolver;
    this.context = context;
    this.circuitBreaker = new ToolCircuitBreaker(
      circuitBreaker || new CircuitBreaker(),
    );
    this.toolExecutionTimeoutMs =
      toolExecutionTimeoutMs || AGENT_TOOL_EXECUTION_TIMEOUT_MS;
    // Wire the idempotency store from the run context so the side-effect-tool
    // de-duplication guard below is actually active. Without this `this.db`
    // stays null and side-effecting Takos or dynamically loaded MCP tools could
    // re-execute on every duplicate call within a run. The side-effect tool NAME set is populated separately
    // via setSideEffectTools() once the resolver's available tools are known.
    this.db = context.db ?? null;
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

    const abortController = new AbortController();

    const executionAbortSignal = this.context.abortSignal
      ? combineSignals(abortController.signal, this.context.abortSignal)
      : abortController.signal;

    const executionContext: ToolContext = {
      ...this.context,
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
      // Provider/MCP schemas are an execution contract, not merely model
      // guidance. Validate the untrusted call before deriving an idempotency
      // key or entering any handler.
      assertValidToolArguments(toolCall.arguments, tool.definition.parameters);

      // Idempotency guard for side-effect tools
      const db = this.db;
      if (this.sideEffectTools.has(toolCall.name) && db) {
        const idempotencyResult = await checkIdempotency(
          db,
          this.context.runId,
          toolCall.name,
          toolCall.arguments,
        );

        if (idempotencyResult.action === "cached") {
          return {
            tool_call_id: toolCall.id,
            output: idempotencyResult.cachedOutput ?? "",
            error: idempotencyResult.cachedError,
            ...(idempotencyResult.outcomeUncertain
              ? { outcome_uncertain: true }
              : {}),
          };
        }

        if (idempotencyResult.action === "in_progress") {
          return {
            tool_call_id: toolCall.id,
            output: "",
            error: `Tool "${toolCall.name}" is already executing with the same parameters. Please wait.`,
            outcome_uncertain: true,
          };
        }

        // action === 'execute' — proceed with recording
        const operationId = idempotencyResult.operationId;
        if (!operationId) {
          throw new Error(
            "tool executor invariant violated: operationId must be set when idempotency action is 'execute'",
          );
        }
        try {
          const rawOutput = await withTimeout(
            tool.handler(toolCall.arguments, executionContext),
            this.toolExecutionTimeoutMs,
            `Tool '${toolCall.name}' execution timed out after ${
              this.toolExecutionTimeoutMs / 1000
            } seconds`,
            () => abortController.abort(),
          );

          const { output } = truncateToolOutput(rawOutput);
          this.circuitBreaker.recordSuccess(toolCall.name);
          await completeOperation(db, operationId, output);

          return { tool_call_id: toolCall.id, output };
        } catch (sideEffectError) {
          const errMsg = truncateToolError(
            sideEffectError instanceof Error
              ? sideEffectError.message
              : String(sideEffectError),
          );
          const recordFailure =
            sideEffectError instanceof ToolExecutionUncertainError
              ? markOperationUncertain(db, operationId, errMsg)
              : completeOperation(db, operationId, "", errMsg);
          await recordFailure.catch((opErr) => {
            logWarn(
              "Failed to complete operation record after tool error (non-critical)",
              { module: "tools", error: opErr, operationId },
            );
          });
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

      const { output } = truncateToolOutput(rawOutput);
      this.circuitBreaker.recordSuccess(toolCall.name);

      const result: ToolResult = {
        tool_call_id: toolCall.id,
        output,
      };

      return result;
    } catch (error) {
      const errorInstance =
        error instanceof Error ? error : new Error(String(error));
      const errorMessage = truncateToolError(errorInstance.message);

      const classification = classifyError(errorInstance);
      const errorSeverity = classification.severity;

      // --- Circuit-breaker failure recording (delegated) ---
      this.circuitBreaker.recordClassifiedFailure(toolCall.name, errorInstance);

      const toolContext = JSON.stringify({
        tool: toolCall.name,
        id: toolCall.id,
        argKeys: Object.keys(toolCall.arguments || {}),
        spaceId: this.context.spaceId?.slice(0, 8),
      });

      const codePrefix = classification.code ? `[${classification.code}] ` : "";
      const severityHint =
        SEVERITY_HINTS[errorSeverity] ??
        " (This may be a temporary issue, consider retrying)";

      logError(
        `Tool execution error: ${errorMessage}`,
        {
          context: toolContext,
          stack: errorInstance.stack
            ? truncateToolError(errorInstance.stack)
            : undefined,
        },
        { module: "tools/executor" },
      );

      return {
        tool_call_id: toolCall.id,
        output: "",
        error: codePrefix + errorMessage + severityHint,
        ...(this.sideEffectTools.has(toolCall.name) &&
        errorInstance instanceof ToolExecutionUncertainError
          ? { outcome_uncertain: true }
          : {}),
      };
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
            error:
              result.reason instanceof Error
                ? truncateToolError(result.reason.message)
                : truncateToolError(String(result.reason)),
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
    // MCP transports are scoped and closed by each catalog probe/tool call;
    // the Worker keeps no container/session-local resource to tear down here.
  }
}
