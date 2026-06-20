import type {
  ToolCall,
  ToolContext,
  ToolResult,
} from "../../tools/tool-definitions.ts";

// Public agent-domain exports for tool call/result shapes.
export type { ToolCall, ToolResult };

export type AgentContext = Pick<
  ToolContext,
  "spaceId" | "sessionId" | "threadId" | "runId" | "userId"
>;

export interface AgentMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  /**
   * Marks this message as a stable prompt-cache boundary. The LLM backend places
   * a provider cache breakpoint here (Anthropic `cache_control:{type:ephemeral}`);
   * OpenAI / Gemini ignore it and rely on automatic prefix caching. Set it on the
   * stable system block (base prompt + tools + skills) and optionally on the last
   * completed conversation turn so the growing history is cached incrementally.
   * Everything AFTER a boundary (e.g. activated memory, thread context) is treated
   * as the dynamic, uncached tail.
   */
  cacheControl?: "ephemeral";
}

/**
 * Token accounting for an agent run. `inputTokens` is the TOTAL prompt tokens
 * (cached + uncached); `cacheReadTokens` / `cacheWriteTokens` break out the
 * cached portion so billing can price reads/writes at the provider's cache rate.
 */
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required?: string[];
  };
}

export interface AgentConfig {
  type: string;
  systemPrompt: string;
  tools: AgentTool[];
  maxIterations?: number;
  temperature?: number;
  rateLimit?: number;
}

export type AgentEventType =
  | "started"
  | "thinking"
  | "tool_call"
  | "tool_result"
  | "message"
  | "completed"
  | "error"
  | "cancelled"
  | "progress";

export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, unknown>;
  timestamp: string;
}
