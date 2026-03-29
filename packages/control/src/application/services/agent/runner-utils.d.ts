/**
 * Internal types and constants for the Agent Runner module.
 */
export declare const MAX_TOTAL_TOOL_CALLS = 1000;
export interface ToolExecution {
    name: string;
    arguments: Record<string, unknown>;
    result?: string;
    error?: string;
    startedAt: number;
    duration_ms?: number;
}
export interface EventEmissionError {
    type: string;
    error: string;
    timestamp: string;
}
/**
 * Combine multiple AbortSignals into a single one that aborts
 * when any of the input signals abort.
 */
export declare function anySignal(signals: AbortSignal[]): AbortSignal;
/** Truncate error message to prevent excessive output */
export declare function sanitizeErrorMessage(error: string): string;
/** Truncate very large argument values for practical output size */
export declare function redactSensitiveArgs(args: Record<string, unknown>): Record<string, unknown>;
/** Max tool execution history entries */
export declare const MAX_TOOL_EXECUTIONS = 50;
/** Add a tool execution, evicting oldest 50% when at capacity */
export declare function addToolExecution(toolExecutions: ToolExecution[], execution: ToolExecution): void;
//# sourceMappingURL=runner-utils.d.ts.map