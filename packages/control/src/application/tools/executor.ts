import type { ToolContext, ToolResult, ToolCall, ContainerStartFailure, ToolDefinition } from './types';
import type { Env } from '../../shared/types';
import type { WorkspaceRole } from '../../shared/types';
import type { ObjectStoreBinding, SqlDatabaseBinding } from '../../shared/types/bindings.ts';
import { ToolResolver, createToolResolver, type ToolResolverOptions } from './resolver';
import { CapabilityRegistry } from './capability-registry';
import { CircuitBreaker, type CircuitStats } from './circuit-breaker';
import { resolveAllowedCapabilities } from '../services/platform/capabilities';
import { getRequiredCapabilitiesForTool } from './capabilities';
import { canRoleAccessTool, filterToolsForRole } from './tool-policy';
import { buildToolDescriptor } from './descriptor-builder';
import type { ToolObserver } from '../services/memory-graph/types';
import { checkIdempotency, completeOperation } from './idempotency';
import { logError, logInfo, logWarn } from '../../shared/utils/logger';
import { MAX_TOOL_OUTPUT_SIZE, MAX_PARALLEL_TOOL_EXECUTIONS } from '../../shared/config/limits';
import { AGENT_TOOL_EXECUTION_TIMEOUT_MS } from '../../shared/config/timeouts';

export const ErrorCodes = {
  CONFIGURATION_ERROR: 'E_CONFIG',
  PERMISSION_DENIED: 'E_PERMISSION',
  UNAUTHORIZED: 'E_UNAUTHORIZED',
  NOT_FOUND: 'E_NOT_FOUND',
  INVALID_PATH: 'E_INVALID_PATH',
  VALIDATION_ERROR: 'E_VALIDATION',
  INVALID_INPUT: 'E_INVALID_INPUT',
  MISSING_REQUIRED: 'E_MISSING_REQUIRED',
  INVALID_ARGUMENT: 'E_INVALID_ARGUMENT',
  TIMEOUT: 'E_TIMEOUT',
  NETWORK_ERROR: 'E_NETWORK',
  SERVICE_UNAVAILABLE: 'E_SERVICE_UNAVAILABLE',
  RATE_LIMITED: 'E_RATE_LIMITED',
  INTERNAL_ERROR: 'E_INTERNAL',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

export type ErrorSeverity = 'fatal' | 'retriable' | 'user_error';

const ERROR_SEVERITY_MAP: Record<ErrorCode, ErrorSeverity> = {
  [ErrorCodes.CONFIGURATION_ERROR]: 'fatal',
  [ErrorCodes.PERMISSION_DENIED]: 'fatal',
  [ErrorCodes.UNAUTHORIZED]: 'fatal',
  [ErrorCodes.NOT_FOUND]: 'fatal',
  [ErrorCodes.INVALID_PATH]: 'fatal',
  [ErrorCodes.VALIDATION_ERROR]: 'fatal',
  [ErrorCodes.INVALID_INPUT]: 'user_error',
  [ErrorCodes.MISSING_REQUIRED]: 'user_error',
  [ErrorCodes.INVALID_ARGUMENT]: 'user_error',
  [ErrorCodes.TIMEOUT]: 'retriable',
  [ErrorCodes.NETWORK_ERROR]: 'retriable',
  [ErrorCodes.SERVICE_UNAVAILABLE]: 'retriable',
  [ErrorCodes.RATE_LIMITED]: 'retriable',
  [ErrorCodes.INTERNAL_ERROR]: 'retriable',
};

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ToolError';
  }

  get severity(): ErrorSeverity {
    return ERROR_SEVERITY_MAP[this.code] || 'retriable';
  }
}

export interface ToolExecutorLike {
  execute(toolCall: ToolCall): Promise<ToolResult>;
  getAvailableTools(): ToolDefinition[];
  readonly mcpFailedServers: string[];
  setObserver(observer: ToolObserver): void;
  cleanup(): void | Promise<void>;
}

function classifyError(error: Error): { severity: ErrorSeverity; code?: ErrorCode } {
  if (error instanceof ToolError) {
    return { severity: error.severity, code: error.code };
  }

  const codeMatch = error.message.match(/\[(E_[A-Z_]+)\]/);
  if (codeMatch) {
    const code = codeMatch[1] as ErrorCode;
    if (code in ERROR_SEVERITY_MAP) {
      return { severity: ERROR_SEVERITY_MAP[code], code };
    }
  }

  // Fallback: pattern matching on error message for legacy support
  const lowerError = error.message.toLowerCase();

  const fatalPatterns = [
    'not configured',
    'permission denied',
    'unauthorized',
    'not found',
    'invalid path',
    'does not exist',
    'access denied',
  ];

  for (const pattern of fatalPatterns) {
    if (lowerError.includes(pattern)) {
      return { severity: 'fatal' };
    }
  }

  const userErrorPatterns = [
    'invalid',
    'required',
    'missing',
    'malformed',
    'expected',
    'must be',
    'cannot be empty',
  ];

  for (const pattern of userErrorPatterns) {
    if (lowerError.includes(pattern)) {
      return { severity: 'user_error' };
    }
  }

  return { severity: 'retriable' };
}

// 10MB per tool output — with MAX_PARALLEL_EXECUTIONS=5, worst-case total is
// 50MB which stays within ~40% of the Workers 128MB heap limit.
// MAX_TOOL_OUTPUT_SIZE imported from shared/config/limits
// Keep this aligned with runner-config default (5 minutes) unless explicitly overridden.
// AGENT_TOOL_EXECUTION_TIMEOUT_MS imported from shared/config/timeouts

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
  onTimeout?: () => void
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      if (onTimeout) {
        try {
          onTimeout();
        } catch (timeoutErr) {
          logWarn('Failed to execute timeout handler', { module: 'tools/executor', error: timeoutErr instanceof Error ? timeoutErr.message : String(timeoutErr) });
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

function truncateOutput(output: string): { output: string; truncation: TruncationInfo } {
  if (typeof output !== 'string') {
    output = String(output);
  }

  if (output.length <= MAX_TOOL_OUTPUT_SIZE) {
    return { output, truncation: { wasTruncated: false } };
  }

  const halfSize = Math.floor((MAX_TOOL_OUTPUT_SIZE - 200) / 2);
  const truncated = output.slice(0, halfSize) +
    `\n\n... [OUTPUT TRUNCATED: ${output.length} chars total, showing first and last ${halfSize} chars] ...\n\n` +
    output.slice(-halfSize);

  logWarn(`Tool output truncated from ${output.length} to ${truncated.length} chars`, { module: 'tools/executor' });

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
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function getAllRequiredCapabilities(tool: { name: string; required_capabilities?: string[] }): string[] {
  return Array.from(new Set([
    ...getRequiredCapabilitiesForTool(tool.name),
    ...(tool.required_capabilities || []),
  ]));
}

function canRoleAccessExposedTool(
  role: ToolContext['role'],
  tool: { required_roles?: string[] },
): boolean {
  if (!tool.required_roles || tool.required_roles.length === 0) {
    return true;
  }
  if (!role) {
    return false;
  }
  return tool.required_roles.includes(role);
}

function canUseToolCapabilities(
  capabilities: readonly string[],
  tool: { name: string; required_capabilities?: string[] },
): boolean {
  const granted = new Set(capabilities);
  return getAllRequiredCapabilities(tool).every((cap) => granted.has(cap));
}

export class ToolExecutor implements ToolExecutorLike {
  private resolver: ToolResolver;
  private context: ToolContext;
  private sessionState: SessionState;
  private circuitBreaker: CircuitBreaker;
  private toolExecutionTimeoutMs: number;
  private parallelExecutionCount = 0;
  private observer: ToolObserver | null = null;
  private sideEffectTools = new Set<string>();
  private db: SqlDatabaseBinding | null = null;
  // 5 parallel executions × 10MB max output = 50MB worst case, safely under
  // the Workers 128MB heap limit with room for code, stack, and framework overhead.
  private static readonly MAX_PARALLEL_EXECUTIONS = MAX_PARALLEL_TOOL_EXECUTIONS;

  constructor(
    resolver: ToolResolver,
    context: ToolContext,
    sessionState: SessionState,
    circuitBreaker?: CircuitBreaker,
    toolExecutionTimeoutMs?: number
  ) {
    this.resolver = resolver;
    this.context = context;
    this.sessionState = sessionState;
    this.circuitBreaker = circuitBreaker || new CircuitBreaker();
    this.toolExecutionTimeoutMs = toolExecutionTimeoutMs || AGENT_TOOL_EXECUTION_TIMEOUT_MS;
    this.observer = null;
  }

  setObserver(observer: ToolObserver): void {
    this.observer = observer;
  }

  setSideEffectTools(toolNames: string[]): void {
    this.sideEffectTools = new Set(toolNames);
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const canExecute = this.circuitBreaker.canExecute(toolCall.name);
    if (!canExecute.allowed) {
      return {
        tool_call_id: toolCall.id,
        output: '',
        error: canExecute.reason || `Tool "${toolCall.name}" is temporarily unavailable`,
      };
    }

    const startTime = Date.now();
    let observedOutput = '';
    let observedError: string | undefined;

    // Freeze sessionId for this execution to prevent race conditions
    const frozenSessionId = this.sessionState.beginExecution();
    const abortController = new AbortController();

    const executionAbortSignal = this.context.abortSignal
      ? anySignal([abortController.signal, this.context.abortSignal])
      : abortController.signal;

    const executionContext: ToolContext = {
      ...this.context,
      get sessionId() { return frozenSessionId; },
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
          output: '',
          error: `Unknown tool: ${toolCall.name}`,
        };
      }

      if (executionContext.role && !canRoleAccessTool(executionContext.role, tool.definition)) {
        throw new ToolError(
          `Permission denied for tool "${toolCall.name}": workspace role "${executionContext.role}" cannot use this workspace operation`,
          ErrorCodes.PERMISSION_DENIED
        );
      }

      if (!canRoleAccessExposedTool(executionContext.role, tool.definition)) {
        throw new ToolError(
          `Permission denied for tool "${toolCall.name}": workspace role "${executionContext.role}" is not allowed`,
          ErrorCodes.PERMISSION_DENIED
        );
      }

      const requiredCapabilities = getAllRequiredCapabilities(tool.definition);
      if (requiredCapabilities.length > 0) {
        const granted = new Set(executionContext.capabilities || []);
        const missing = requiredCapabilities.filter((cap) => !granted.has(cap));
        if (missing.length > 0) {
          throw new ToolError(
            `Permission denied for tool "${toolCall.name}": missing capabilities: ${missing.join(', ')}`,
            ErrorCodes.PERMISSION_DENIED
          );
        }
      }

      // Idempotency guard for side-effect tools
      if (this.sideEffectTools.has(toolCall.name) && this.db) {
        const idempotencyResult = await checkIdempotency(
          this.db,
          this.context.runId,
          toolCall.name,
          toolCall.arguments,
        );

        if (idempotencyResult.action === 'cached') {
          observedOutput = idempotencyResult.cachedOutput ?? '';
          observedError = idempotencyResult.cachedError;
          return {
            tool_call_id: toolCall.id,
            output: observedOutput,
            error: observedError,
          };
        }

        if (idempotencyResult.action === 'in_progress') {
          observedError = `Tool "${toolCall.name}" is already executing with the same parameters. Please wait.`;
          return {
            tool_call_id: toolCall.id,
            output: '',
            error: observedError,
          };
        }

        // action === 'execute' — proceed with recording
        const operationId = idempotencyResult.operationId!;
        try {
          const rawOutput = await withTimeout(
            tool.handler(toolCall.arguments, executionContext),
            this.toolExecutionTimeoutMs,
            `Tool '${toolCall.name}' execution timed out after ${this.toolExecutionTimeoutMs / 1000} seconds`,
            () => abortController.abort()
          );

          const { output, truncation } = truncateOutput(rawOutput);
          this.circuitBreaker.recordSuccess(toolCall.name);
          await completeOperation(this.db!, operationId, output);

          observedOutput = output;
          const result: ToolResult = { tool_call_id: toolCall.id, output };
          if (truncation.wasTruncated) {
            result.error = `[NOTICE] Output was truncated from ${truncation.originalLength} to ${truncation.truncatedLength} chars.`;
          }
          return result;
        } catch (sideEffectError) {
          const errMsg = sideEffectError instanceof Error ? sideEffectError.message : String(sideEffectError);
          await completeOperation(this.db!, operationId, '', errMsg).catch(() => {});
          throw sideEffectError;
        }
      }

      const rawOutput = await withTimeout(
        tool.handler(toolCall.arguments, executionContext),
        this.toolExecutionTimeoutMs,
        `Tool '${toolCall.name}' execution timed out after ${this.toolExecutionTimeoutMs / 1000} seconds`,
        () => abortController.abort()
      );

      const { output, truncation } = truncateOutput(rawOutput);
      this.circuitBreaker.recordSuccess(toolCall.name);

      const result: ToolResult = {
        tool_call_id: toolCall.id,
        output,
      };

      if (truncation.wasTruncated) {
        result.error = `[NOTICE] Output was truncated from ${truncation.originalLength} to ${truncation.truncatedLength} chars. ` +
          `The full output may contain additional relevant information.`;
      }

      observedOutput = output;
      return result;
    } catch (error) {
      const errorInstance = error instanceof Error ? error : new Error(String(error));
      const errorMessage = errorInstance.message;

      const classification = classifyError(errorInstance);
      const errorSeverity = classification.severity;

      if (errorSeverity === 'retriable') {
        this.circuitBreaker.recordFailure(toolCall.name, errorMessage);
      }

      const toolContext = JSON.stringify({
        tool: toolCall.name,
        id: toolCall.id,
        argKeys: Object.keys(toolCall.arguments || {}),
        spaceId: this.context.spaceId?.slice(0, 8),
        sessionActive: !!frozenSessionId,
      });

      const codePrefix = classification.code ? `[${classification.code}] ` : '';
      const SEVERITY_HINTS: Record<string, string> = {
        fatal: ' (This error cannot be resolved by retrying)',
        user_error: ' (Please check your input parameters)',
      };
      const severityHint = SEVERITY_HINTS[errorSeverity] ?? ' (This may be a temporary issue, consider retrying)';

      logError(`Tool execution error: ${errorMessage}`, { context: toolContext, stack: errorInstance.stack }, { module: 'tools/executor' });

      observedError = errorMessage;
      return {
        tool_call_id: toolCall.id,
        output: '',
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
    if (toolName) {
      this.circuitBreaker.reset(toolName);
    } else {
      this.circuitBreaker.resetAll();
    }
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
      logWarn(`Limiting parallel tool executions from ${toolCalls.length} to ${ToolExecutor.MAX_PARALLEL_EXECUTIONS}`, { module: 'tools/executor' });
    }

    const allResults: ToolResult[] = [];
    for (let i = 0; i < toolCalls.length; i += ToolExecutor.MAX_PARALLEL_EXECUTIONS) {
      const batch = toolCalls.slice(i, i + ToolExecutor.MAX_PARALLEL_EXECUTIONS);

      this.parallelExecutionCount++;
      const batchId = this.parallelExecutionCount;

      const batchStartTime = Date.now();
      const results = await Promise.allSettled(batch.map(tc => this.execute(tc)));
      const batchDuration = Date.now() - batchStartTime;

      const failures = results.filter(r => r.status === 'rejected').length;
      if (failures > 0 || batchDuration > 10000) {
        logInfo(`Parallel batch ${batchId}: ${batch.length} tools, ${failures} failures, ${batchDuration}ms`, { module: 'tools/executor' });
      }

      const batchResults = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          return {
            tool_call_id: batch[index].id,
            output: '',
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          };
        }
      });

      allResults.push(...batchResults);
    }

    return allResults;
  }

  getAvailableTools() {
    return filterToolsForRole(this.resolver.getAvailableTools(), this.context.role)
      .filter((tool) => canRoleAccessExposedTool(this.context.role, tool))
      .filter((tool) => canUseToolCapabilities(this.context.capabilities || [], tool));
  }

  get mcpFailedServers(): string[] {
    return this.resolver.mcpFailedServers;
  }

  cleanup(): void {
    this.sessionState.cleanup();
  }
}

function buildPerRunCapabilityRegistry(executor: ToolExecutor): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.registerAll(executor.getAvailableTools().map((tool) => buildToolDescriptor(tool)));
  return registry;
}

/** Session state with reference counting to prevent sessionId changes during execution. */
class SessionState {
  private _sessionId: string | undefined;
  private _lastContainerStartFailure: ContainerStartFailure | undefined;
  private _activeExecutions = 0;
  private _pendingClear: (() => void) | null = null;
  private _pendingClearTimeout: ReturnType<typeof setTimeout> | null = null;

  private static readonly MAX_PENDING_CLEAR_WAIT_MS = 5 * 60 * 1000;
  private static readonly EXECUTION_COUNT_WARNING_THRESHOLD = 50;

  constructor(initialSessionId: string | undefined) {
    this._sessionId = initialSessionId;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  get lastContainerStartFailure(): ContainerStartFailure | undefined {
    return this._lastContainerStartFailure;
  }

  beginExecution(): string | undefined {
    this._activeExecutions++;

    if (this._activeExecutions > SessionState.EXECUTION_COUNT_WARNING_THRESHOLD) {
      logWarn(`High active execution count: ${this._activeExecutions}. ` +
        `This may indicate endExecution() is not being called properly.`, { module: 'sessionstate' });
    }

    return this._sessionId;
  }

  endExecution(): void {
    if (this._activeExecutions > 0) {
      this._activeExecutions--;
    } else {
      logWarn('Warning: endExecution called with no active executions', { module: 'tools/executor' });
    }

    if (this._activeExecutions === 0 && this._pendingClear) {
      this._clearPendingTimeout();
      this._pendingClear();
      this._pendingClear = null;
    }
  }

  private _clearPendingTimeout(): void {
    if (this._pendingClearTimeout) {
      clearTimeout(this._pendingClearTimeout);
      this._pendingClearTimeout = null;
    }
  }

  setSessionId(newSessionId: string | undefined): void {
    if (newSessionId !== undefined) {
      this._sessionId = newSessionId;
      this._lastContainerStartFailure = undefined;
      this._clearPendingTimeout();
      this._pendingClear = null;
    } else {
      if (this._activeExecutions > 0) {
        logWarn(`Warning: Deferring sessionId clear - ${this._activeExecutions} executions active`, { module: 'tools/executor' });
        this._pendingClear = () => {
          this._sessionId = undefined;
        };

        this._clearPendingTimeout();
        this._pendingClearTimeout = setTimeout(() => {
          if (this._pendingClear && this._activeExecutions > 0) {
            logError(`Session clear still pending after ${SessionState.MAX_PENDING_CLEAR_WAIT_MS / 1000}s - ` +
              `${this._activeExecutions} executions still active. NOT force-clearing to prevent data corruption.`, undefined, { module: 'tools/executor' });
          } else if (this._pendingClear) {
            this._pendingClear();
            this._pendingClear = null;
          }
          this._pendingClearTimeout = null;
        }, SessionState.MAX_PENDING_CLEAR_WAIT_MS);
      } else {
        this._sessionId = undefined;
      }
    }
  }

  setLastContainerStartFailure(failure: ContainerStartFailure | undefined): void {
    this._lastContainerStartFailure = failure;
  }

  async waitForPendingClear(timeoutMs: number = 30000): Promise<boolean> {
    if (!this._pendingClear && this._activeExecutions === 0) {
      return true;
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (!this._pendingClear && this._activeExecutions === 0) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return false;
  }

  get activeExecutions(): number {
    return this._activeExecutions;
  }

  get hasPendingClear(): boolean {
    return this._pendingClear !== null;
  }

  cleanup(): void {
    this._clearPendingTimeout();
    this._sessionId = undefined;
    this._lastContainerStartFailure = undefined;
    this._activeExecutions = 0;
    this._pendingClear = null;
  }
}

export async function createToolExecutor(
  env: Env,
  db: SqlDatabaseBinding,
  storage: ObjectStoreBinding | undefined,
  spaceId: string,
  sessionId: string | undefined,
  threadId: string,
  runId: string,
  userId: string,
  options?: ToolResolverOptions,
  toolExecutionTimeoutMs?: number,
  runAbortSignal?: AbortSignal,
  accessPolicy?: {
    minimumRole?: WorkspaceRole;
  },
): Promise<ToolExecutor> {
  const { ctx, allowed } = await resolveAllowedCapabilities({
    db,
    spaceId,
    userId,
    minimumRole: accessPolicy?.minimumRole,
  });

  const resolver = await createToolResolver(db, spaceId, env, {
    ...options,
    mcpExposureContext: {
      role: ctx.role,
      capabilities: Array.from(allowed),
    },
  });

  const sessionState = new SessionState(sessionId);

  const context: ToolContext = {
    spaceId,
    get sessionId() { return sessionState.sessionId; },
    threadId,
    runId,
    userId,
    role: ctx.role,
    capabilities: Array.from(allowed),
    env,
    db,
    storage,
    setSessionId: (newSessionId: string | undefined) => {
      sessionState.setSessionId(newSessionId);
    },
    getLastContainerStartFailure: () => sessionState.lastContainerStartFailure,
    setLastContainerStartFailure: (failure: ContainerStartFailure | undefined) => {
      sessionState.setLastContainerStartFailure(failure);
    },
    abortSignal: runAbortSignal,
  };

  const executor = new ToolExecutor(resolver, context, sessionState, undefined, toolExecutionTimeoutMs);
  const internalContext = context as ToolContext & {
    _toolExecutor?: Pick<ToolExecutor, 'execute'>;
  };
  internalContext.capabilityRegistry = buildPerRunCapabilityRegistry(executor);
  internalContext._toolExecutor = executor;

  return executor;
}

export function toOpenAIFunctions(tools: ReturnType<ToolResolver['getAvailableTools']>) {
  return tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}
