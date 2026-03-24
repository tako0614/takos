export interface AgentContext {
  spaceId: string;
  sessionId?: string;
  threadId: string;
  runId: string;
  userId: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  output: string;
  error?: string;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
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
  | 'started'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'message'
  | 'artifact'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'progress';

export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

