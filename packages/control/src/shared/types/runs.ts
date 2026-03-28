export interface ToolExecution {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
  duration_ms?: number;
}

/**
 * Canonical Agent RunStatus definition.
 * Intentionally duplicated in (cross-repo boundary prevents direct import):
 *   - takos-computer/packages/computer-core/src/shared/types.ts
 *
 * NOT the same as the GitHub Actions RunStatus in packages/actions-engine/src/types.ts
 * ('queued'|'in_progress'|'completed'|'cancelled') — different domain concept.
 */
export type RunStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Run {
  id: string;
  thread_id: string;
  space_id: string;
  session_id: string | null;
  parent_run_id: string | null;
  child_thread_id: string | null;
  root_thread_id: string;
  root_run_id: string | null;
  agent_type: string;
  status: RunStatus;
  input: string;
  output: string | null;
  error: string | null;
  usage: string;
  worker_id: string | null;
  worker_heartbeat: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}
