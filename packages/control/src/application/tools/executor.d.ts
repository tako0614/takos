import type { ToolContext, ToolResult, ToolCall, ToolDefinition } from './tool-definitions';
import { ToolResolver } from './resolver';
import { CircuitBreaker, type CircuitStats } from './circuit-breaker';
import type { ToolObserver } from '../services/memory-graph/graph-models';
export { ErrorCodes, ToolError } from './tool-error-classifier';
export type { ErrorCode, ErrorSeverity } from './tool-error-classifier';
export { createToolExecutor, SessionState } from './executor-setup';
export { toOpenAIFunctions, buildPerRunCapabilityRegistry } from './executor-utils';
import type { SessionState } from './executor-setup';
export interface ToolExecutorLike {
    execute(toolCall: ToolCall): Promise<ToolResult>;
    getAvailableTools(): ToolDefinition[];
    readonly mcpFailedServers: string[];
    setObserver(observer: ToolObserver): void;
    cleanup(): void | Promise<void>;
}
export declare class ToolExecutor implements ToolExecutorLike {
    private resolver;
    private context;
    private sessionState;
    private circuitBreaker;
    private toolExecutionTimeoutMs;
    private parallelExecutionCount;
    private observer;
    private sideEffectTools;
    private db;
    private static readonly MAX_PARALLEL_EXECUTIONS;
    constructor(resolver: ToolResolver, context: ToolContext, sessionState: SessionState, circuitBreaker?: CircuitBreaker, toolExecutionTimeoutMs?: number);
    setObserver(observer: ToolObserver): void;
    setSideEffectTools(toolNames: string[]): void;
    execute(toolCall: ToolCall): Promise<ToolResult>;
    getCircuitBreakerState(toolName: string): CircuitStats;
    resetCircuitBreaker(toolName?: string): void;
    executeAll(toolCalls: ToolCall[]): Promise<ToolResult[]>;
    executeParallel(toolCalls: ToolCall[]): Promise<ToolResult[]>;
    getAvailableTools(): ToolDefinition[];
    get mcpFailedServers(): string[];
    cleanup(): void;
}
//# sourceMappingURL=executor.d.ts.map