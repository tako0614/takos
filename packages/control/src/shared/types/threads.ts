export type ThreadStatus = "active" | "archived" | "deleted";

export interface Thread {
  id: string;
  space_id: string;
  title: string | null;
  locale?: "ja" | "en" | null;
  status: ThreadStatus;
  summary?: string | null;
  key_points?: string;
  retrieval_index?: number;
  context_window?: number;
  created_at: string;
  updated_at: string;
}

/**
 * Canonical MessageRole definition.
 * Shared by Takos control and agent runtime surfaces.
 */
export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  metadata: string;
  sequence: number;
  created_at: string;
}
