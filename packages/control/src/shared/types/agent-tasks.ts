import type { RunStatus } from './runs.ts';

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
  thread_title: string | null;
  latest_run: AgentTaskRunSummary | null;
  resume_target: AgentTaskResumeTarget | null;
}

export interface AgentTaskRunSummary {
  run_id: string;
  status: RunStatus;
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
