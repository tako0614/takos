/**
 * Internal types and constants for the Agent Runner module.
 */

import {
  MAX_TOOL_EXECUTIONS_HISTORY,
  MAX_TOTAL_TOOL_CALLS_PER_RUN,
} from "../../../shared/config/limits.ts";

export const MAX_TOTAL_TOOL_CALLS = MAX_TOTAL_TOOL_CALLS_PER_RUN;

export interface ToolExecution {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
  startedAt: number;
  duration_ms?: number;
}

const DISCOVERY_TOOL_NAMES = new Set([
  "toolbox",
  "capability_search",
  "capability_families",
  "capability_describe",
  "capability_invoke",
]);

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
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

/** Truncate error message to prevent excessive output */
export function sanitizeErrorMessage(error: string): string {
  return error.length > 10000 ? error.slice(0, 10000) + "..." : error;
}

/** Truncate very large argument values for practical output size */
export function redactSensitiveArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const processed: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > 10000) {
      processed[key] = value.slice(0, 1000) +
        `... [truncated:${value.length} chars]`;
    } else {
      processed[key] = value;
    }
  }

  return processed;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function buildToolTelemetry(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (!DISCOVERY_TOOL_NAMES.has(toolName)) {
    return { tool_kind: "direct" };
  }

  if (toolName === "toolbox") {
    const action = optionalString(args.action) ?? "unknown";
    const telemetry: Record<string, unknown> = {
      tool_kind: "discovery",
      discovery_tool: "toolbox",
      toolbox_action: action,
    };
    const query = optionalString(args.query);
    if (query) telemetry.toolbox_query = query;
    const target = optionalString(args.tool_name);
    if (target) telemetry.toolbox_target = target;
    if (Array.isArray(args.tool_names)) {
      telemetry.toolbox_targets = args.tool_names
        .filter((value): value is string => typeof value === "string")
        .slice(0, 10);
    }
    return telemetry;
  }

  const action = toolName.replace(/^capability_/, "");
  const telemetry: Record<string, unknown> = {
    tool_kind: "discovery",
    discovery_tool: toolName,
    discovery_action: action,
  };
  const query = optionalString(args.query);
  if (query) telemetry.discovery_query = query;
  const target = optionalString(args.tool_name);
  if (target) telemetry.discovery_target = target;
  if (Array.isArray(args.tool_names)) {
    telemetry.discovery_targets = args.tool_names
      .filter((value): value is string => typeof value === "string")
      .slice(0, 10);
  }
  return telemetry;
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
