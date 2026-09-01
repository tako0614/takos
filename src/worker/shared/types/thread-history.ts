import type { ArtifactType } from "./artifacts.ts";
import type { RunStatus, RunTerminalReason } from "./runs.ts";
import type { AgentTaskPriority, AgentTaskStatus } from "./agent-tasks.ts";

export interface ThreadHistoryArtifactSummary {
  id: string;
  run_id: string;
  type: ArtifactType;
  title: string | null;
  file_id: string | null;
  created_at: string;
}

export interface ThreadHistoryEvent {
  id: number;
  run_id: string;
  type: string;
  data: string;
  data_truncated: boolean;
  created_at: string;
}

export interface ThreadHistoryTruncation {
  message_data: boolean;
  runs: boolean;
  artifacts: boolean;
  events: boolean;
  event_data: boolean;
}

export interface ThreadHistoryRunSummary {
  id: string;
  thread_id: string;
  space_id: string;
  session_id: string | null;
  parent_run_id: string | null;
  child_thread_id: string | null;
  root_thread_id: string;
  root_run_id: string | null;
  agent_type: string;
  model: string | null;
  status: RunStatus;
  terminal_reason: RunTerminalReason | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ThreadHistoryChildRunSummary {
  run_id: string;
  thread_id: string;
  child_thread_id: string | null;
  status: RunStatus;
  agent_type: string;
  created_at: string;
  completed_at: string | null;
}

export interface ThreadHistoryRunNode {
  run: ThreadHistoryRunSummary;
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
  space_id: string;
  thread_id: string;
  title: string;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
}
