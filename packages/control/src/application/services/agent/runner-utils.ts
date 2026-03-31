/**
 * Internal types and constants for the Agent Runner module.
 */

import { MAX_TOTAL_TOOL_CALLS_PER_RUN, MAX_TOOL_EXECUTIONS_HISTORY } from '../../../shared/config/limits.ts';

export const MAX_TOTAL_TOOL_CALLS = MAX_TOTAL_TOOL_CALLS_PER_RUN;

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
export function anySignal(signals: AbortSignal[]): AbortSignal {
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

/** Truncate error message to prevent excessive output */
export function sanitizeErrorMessage(error: string): string {
  return error.length > 10000 ? error.slice(0, 10000) + '...' : error;
}

/** Truncate very large argument values for practical output size */
export function redactSensitiveArgs(args: Record<string, unknown>): Record<string, unknown> {
  const processed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > 10000) {
      processed[key] = value.slice(0, 1000) + `... [truncated:${value.length} chars]`;
    } else {
      processed[key] = value;
    }
  }

  return processed;
}

/** Max tool execution history entries */
export const MAX_TOOL_EXECUTIONS = MAX_TOOL_EXECUTIONS_HISTORY;

/** Add a tool execution, evicting oldest 50% when at capacity */
export function addToolExecution(
  toolExecutions: ToolExecution[],
  execution: ToolExecution,
): void {
  if (toolExecutions.length >= MAX_TOOL_EXECUTIONS) {
    const removeCount = Math.max(1, Math.floor(MAX_TOOL_EXECUTIONS * 0.5));
    toolExecutions.splice(0, removeCount);
  }
  toolExecutions.push(execution);
}
