/**
 * LangGraph Tool Helpers
 *
 * Shared utility functions, tool creation, and public types for the
 * LangGraph agent subsystem.
 */

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { BaseMessage } from "@langchain/core/messages";
import type { ToolExecutorLike } from "../../tools/executor.ts";
import type {
  ToolDefinition,
  ToolParameter,
} from "../../tools/tool-definitions.ts";
import type { ToolExecution } from "./runner-utils.ts";

// ── Shared helpers ──────────────────────────────────────────────────────

/** Extract string content from a BaseMessage's content field (string or structured parts). */
export function extractMessageText(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content !== null && content !== undefined) {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return "";
}

/** Convert a ToolParameter definition to a Zod schema type. */
export function toolParameterToZod(param: ToolParameter): z.ZodType {
  let zodType: z.ZodType;

  switch (param.type) {
    case "string":
      zodType = param.enum
        ? z.enum(param.enum as [string, ...string[]])
        : z.string();
      break;
    case "number":
      zodType = z.number();
      break;
    case "boolean":
      zodType = z.boolean();
      break;
    case "array": {
      const itemType = param.items
        ? toolParameterToZod(param.items)
        : z.string();
      zodType = z.array(itemType);
      break;
    }
    case "object":
      zodType = z.record(z.string(), z.unknown());
      break;
    default:
      zodType = z.unknown();
  }

  if (param.description) {
    zodType = zodType.describe(param.description);
  }

  return zodType;
}

/** Coerce an unknown tool invocation result into a string. */
export function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "";
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

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

export { throwIfAborted } from "takos-common/abort";

// ── Public types ────────────────────────────────────────────────────────

export interface LangGraphEvent {
  type:
    | "thinking"
    | "tool_call"
    | "tool_result"
    | "message"
    | "completed"
    | "error"
    | "progress";
  data: Record<string, unknown>;
}

export interface CreateAgentOptions {
  apiKey: string;
  model?: string;
  temperature?: number;
  systemPrompt: string;
  tools: ToolDefinition[];
  toolExecutor: ToolExecutorLike;
  db?: import("../../../shared/types/bindings.ts").SqlDatabaseBinding;
  maxIterations?: number;
  abortSignal?: AbortSignal;
  onEvent?: (event: LangGraphEvent) => Promise<void> | void;
  onToolExecution?: (execution: ToolExecution) => void;
}

/** Generate a unique tool-call ID using crypto random bytes. */
export function generateToolCallId(counter: number): string {
  const idBytes = new Uint8Array(8);
  crypto.getRandomValues(idBytes);
  return `call_${Date.now()}_${counter}_${
    Array.from(idBytes, (b) => b.toString(16).padStart(2, "0")).join("")
  }`;
}

// ── ToolParameter → LangChain DynamicStructuredTool conversion ──────────

export function createLangChainTool(
  toolDef: ToolDefinition,
  executor: ToolExecutorLike,
): DynamicStructuredTool {
  const schemaProps: Record<string, z.ZodTypeAny> = {};
  const required = toolDef.parameters.required || [];

  for (const [key, param] of Object.entries(toolDef.parameters.properties)) {
    let zodType = toolParameterToZod(param);

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    schemaProps[key] = zodType;
  }

  const schema = z.object(schemaProps);
  return new DynamicStructuredTool({
    name: toolDef.name,
    description: toolDef.description,

    schema: schema as z.ZodObject<Record<string, z.ZodTypeAny>>,
    func: async (args: Record<string, unknown>) => {
      const result = await executor.execute({
        id: generateToolCallId(0),
        name: toolDef.name,
        arguments: args,
      });

      if (result.error) {
        return `Error: ${result.error}`;
      }
      return result.output;
    },
  });
}
