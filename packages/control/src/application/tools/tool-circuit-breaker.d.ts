/**
 * Executor-level circuit-breaker facade.
 *
 * Wraps the low-level {@link CircuitBreaker} with the result-recording and
 * guard logic that the executor needs at call boundaries.
 */
import type { ToolResult } from './tool-definitions';
import { CircuitBreaker, type CircuitStats } from './circuit-breaker';
export type { CircuitStats } from './circuit-breaker';
/**
 * ToolCircuitBreaker bridges the generic CircuitBreaker with the
 * tool-execution lifecycle:
 *
 * 1. **guard** — check whether a tool is allowed to run.
 * 2. **recordSuccess** / **recordClassifiedFailure** — update state after
 *    execution completes or fails.
 */
export declare class ToolCircuitBreaker {
    private breaker;
    constructor(breaker?: CircuitBreaker);
    /**
     * Returns `null` when the tool is allowed to execute, or a pre-built
     * `ToolResult` when the circuit is open and the call should be short-circuited.
     */
    guard(toolCallId: string, toolName: string): ToolResult | null;
    recordSuccess(toolName: string): void;
    /**
     * Classify the error and — if it is retriable — record a failure against the
     * circuit breaker so that consecutive retriable errors eventually trip the
     * circuit.
     */
    recordClassifiedFailure(toolName: string, error: Error): void;
    getState(toolName: string): CircuitStats;
    reset(toolName?: string): void;
}
//# sourceMappingURL=tool-circuit-breaker.d.ts.map