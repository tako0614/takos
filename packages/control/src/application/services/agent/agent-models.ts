import type {
  ToolCall,
  ToolContext,
  ToolResult,
} from "../../tools/tool-definitions.ts";

// Re-export canonical types so existing imports from this file keep working.
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
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
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
