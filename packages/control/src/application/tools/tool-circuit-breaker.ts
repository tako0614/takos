/**
 * Executor-level circuit-breaker facade.
 *
 * Wraps the low-level {@link CircuitBreaker} with the result-recording and
 * guard logic that the executor needs at call boundaries.
 */

import type { ToolResult } from './types';
import { CircuitBreaker, type CircuitStats } from './circuit-breaker';
import { classifyError } from './tool-error-classifier';

export type { CircuitStats } from './circuit-breaker';

/**
 * ToolCircuitBreaker bridges the generic CircuitBreaker with the
 * tool-execution lifecycle:
 *
 * 1. **guard** — check whether a tool is allowed to run.
 * 2. **recordSuccess** / **recordClassifiedFailure** — update state after
 *    execution completes or fails.
 */
export class ToolCircuitBreaker {
  private breaker: CircuitBreaker;

  constructor(breaker?: CircuitBreaker) {
    this.breaker = breaker || new CircuitBreaker();
  }

  // ---------------------------------------------------------------------------
  // Pre-execution guard
  // ---------------------------------------------------------------------------

  /**
   * Returns `null` when the tool is allowed to execute, or a pre-built
   * `ToolResult` when the circuit is open and the call should be short-circuited.
   */
  guard(toolCallId: string, toolName: string): ToolResult | null {
    const canExecute = this.breaker.canExecute(toolName);
    if (!canExecute.allowed) {
      return {
        tool_call_id: toolCallId,
        output: '',
        error: canExecute.reason || `Tool "${toolName}" is temporarily unavailable`,
      };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Post-execution recording
  // ---------------------------------------------------------------------------

  recordSuccess(toolName: string): void {
    this.breaker.recordSuccess(toolName);
  }

  /**
   * Classify the error and — if it is retriable — record a failure against the
   * circuit breaker so that consecutive retriable errors eventually trip the
   * circuit.
   */
  recordClassifiedFailure(toolName: string, error: Error): void {
    const classification = classifyError(error);
    if (classification.severity === 'retriable') {
      this.breaker.recordFailure(toolName, error.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Inspection / management
  // ---------------------------------------------------------------------------

  getState(toolName: string): CircuitStats {
    return this.breaker.getState(toolName);
  }

  reset(toolName?: string): void {
    if (toolName) {
      this.breaker.reset(toolName);
    } else {
      this.breaker.resetAll();
    }
  }
}
