export interface Thread {
  id: string;
  space_id: string;
  title: string;
  locale?: 'ja' | 'en' | null;
  status: 'active' | 'archived';
  summary?: string | null;
  key_points?: string;
  retrieval_index?: number;
  context_window?: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata: string;
  tool_calls?: string | null;
  tool_call_id?: string | null;
  sequence: number;
  created_at: string;
}

export interface ToolExecution {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
  duration_ms?: number;
}

export interface Run {
  id: string;
  thread_id: string;
  space_id: string;
  session_id: string | null;
  parent_run_id: string | null;
  child_thread_id: string | null;
  root_thread_id: string;
  root_run_id: string | null;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  agent_type: string;
  input: string;
  output: string | null;
  usage: string;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type AgentTaskStatus = 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export type AgentTaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Core DB-mapped properties for an agent task. */
export interface AgentTaskBase {
  id: string;
  space_id: string;
  created_by: string | null;
  thread_id: string | null;
  last_run_id: string | null;
  title: string;
  description: string | null;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
  agent_type: string;
  model: string | null;
  plan: string | null;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Enriched agent task returned from list/detail API endpoints. */
export interface AgentTask extends AgentTaskBase {
  thread_title?: string | null;
  latest_run?: AgentTaskRunSummary | null;
  resume_target?: AgentTaskResumeTarget | null;
}

export interface AgentTaskRunSummary {
  run_id: string;
  status: Run['status'];
  agent_type: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  error: string | null;
  artifact_count: number;
}

export interface AgentTaskResumeTarget {
  thread_id: string;
  run_id: string | null;
  reason: 'active' | 'failed' | 'latest' | 'thread';
}

export interface SessionDiff {
  changes: Array<{
    path: string;
    type: 'add' | 'modify' | 'delete';
    old_entry?: { hash: string; size: number };
    new_entry?: { hash: string; size: number };
    diff?: string;
    content?: string;
  }>;
  conflicts: Array<{
    path: string;
    type: string;
  }>;
  can_merge: boolean;
  workspace_head: string;
}

export interface ThreadHistoryArtifactSummary {
  id: string;
  run_id: string;
  type: 'code' | 'config' | 'doc' | 'patch' | 'report' | 'other';
  title: string | null;
  file_id: string | null;
  created_at: string;
}

export interface ThreadHistoryEvent {
  id: number;
  run_id: string;
  type: string;
  data: string;
  created_at: string;
}

export interface ThreadHistoryChildRunSummary {
  run_id: string;
  thread_id: string;
  child_thread_id: string | null;
  status: Run['status'];
  agent_type: string;
  created_at: string;
  completed_at: string | null;
}

export interface ThreadHistoryRunNode {
  run: Run;
  artifact_count: number;
  latest_event_at: string;
  artifacts: ThreadHistoryArtifactSummary[];
  events: ThreadHistoryEvent[];
  child_thread_id: string | null;
  child_run_count: number;
  child_runs: ThreadHistoryChildRunSummary[];
}

export interface ThreadHistoryFocus {
  latest_run_id: string | null;
  latest_active_run_id: string | null;
  latest_failed_run_id: string | null;
  latest_completed_run_id: string | null;
  resume_run_id: string | null;
}

export interface ThreadHistoryTaskContext {
  id: string;
  title: string;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
}
