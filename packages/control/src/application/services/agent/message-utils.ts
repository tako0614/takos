/**
 * Agent Message Utilities.
 *
 * Extracted from graph-agent.ts to provide reusable message
 * handling functions across agent execution engines.
 */

import type { BaseMessage } from "@langchain/core/messages";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { logWarn } from "../../../shared/utils/logger.ts";

// ── Message text extraction ─────────────────────────────────────────────

/**
 * Extract string content from a BaseMessage's content field.
 *
 * Handles plain strings, structured content parts (text blocks),
 * and arbitrary values by falling back to JSON serialization.
 */
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

// ── Tool result stringification ─────────────────────────────────────────

/**
 * Coerce an unknown tool invocation result into a string.
 *
 * Returns the value as-is when it is already a string, an empty string
 * for null/undefined, and a JSON representation for everything else.
 */
export function stringifyToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result === null || result === undefined) return "";
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

// ── DB ↔ LangChain message conversion ───────────────────────────────────

/** Shape of a persisted message row from the database. */
export interface DbMessageRow {
  role: string;
  content: string;
  tool_calls?: string | null;
  tool_call_id?: string | null;
}

/** Shape of a serialized tool call stored in the database. */
interface SerializedToolCall {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

/** Shape of a message row to be written back to the database. */
export interface DbMessageOutput {
  role: string;
  content: string;
  tool_calls?: string;
  tool_call_id?: string;
}

/**
 * Convert an array of persisted database message rows into LangChain
 * BaseMessage instances suitable for agent consumption.
 */
export function dbMessagesToLangChain(messages: DbMessageRow[]): BaseMessage[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case "system":
        return new SystemMessage(msg.content);
      case "user":
      default:
        return new HumanMessage(msg.content);
      case "assistant": {
        const aiMsg = new AIMessage(msg.content);
        if (msg.tool_calls) {
          try {
            const parsed = JSON.parse(msg.tool_calls);
            if (!Array.isArray(parsed)) {
              logWarn("tool_calls is not an array, skipping", {
                module: "services/agent/graph-agent",
              });
            } else {
              aiMsg.tool_calls = parsed.map((tc: SerializedToolCall) => ({
                id: tc.id || "",
                name: tc.name,
                args: tc.arguments || tc.args || {},
                type: "tool_call" as const,
              }));
            }
          } catch {
            logWarn("Failed to parse tool_calls JSON", {
              module: "services/agent/graph-agent",
            });
          }
        }
        return aiMsg;
      }
      case "tool":
        return new ToolMessage({
          content: msg.content,
          tool_call_id: msg.tool_call_id || "",
        });
    }
  });
}

/**
 * Convert a LangChain BaseMessage into a plain object suitable for
 * database persistence.
 */
export function langChainMessageToDb(msg: BaseMessage): DbMessageOutput {
  const content = extractMessageText(msg.content);

  if (msg instanceof SystemMessage) {
    return { role: "system", content };
  }

  if (msg instanceof HumanMessage) {
    return { role: "user", content };
  }

  if (msg instanceof AIMessage) {
    const result: DbMessageOutput = {
      role: "assistant",
      content,
    };
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const normalizedToolCalls = msg.tool_calls.map((tc) => ({
        id: tc.id || "",
        name: tc.name,
        arguments: tc.args || {},
      }));
      result.tool_calls = JSON.stringify(normalizedToolCalls);
    }
    return result;
  }

  if (msg instanceof ToolMessage) {
    return {
      role: "tool",
      content,
      tool_call_id: msg.tool_call_id,
    };
  }

  return { role: "user", content };
}
