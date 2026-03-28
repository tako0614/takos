// Re-export types from backend shared models to avoid duplication.
// Frontend-only types and narrowed variants are defined locally.
import type {
  Thread as BackendThread,
  Message as BackendMessage,
  Run as BackendRun,
  AgentTaskBase,
  AgentTaskRunSummary,
  AgentTaskResumeTarget,
} from '@takos/control-shared/types';

export type { ToolExecution } from '@takos/control-shared/types';
export type { AgentTaskStatus } from '@takos/control-shared/types';
export type { AgentTaskPriority } from '@takos/control-shared/types';
export type { AgentTaskBase } from '@takos/control-shared/types';
export type { AgentTaskRunSummary } from '@takos/control-shared/types';
export type { AgentTaskResumeTarget } from '@takos/control-shared/types';
export type { ThreadHistoryArtifactSummary } from '@takos/control-shared/types';
export type { ThreadHistoryEvent } from '@takos/control-shared/types';
export type { ThreadHistoryChildRunSummary } from '@takos/control-shared/types';
export type { ThreadHistoryRunNode } from '@takos/control-shared/types';
export type { ThreadHistoryFocus } from '@takos/control-shared/types';
export type { ThreadHistoryTaskContext } from '@takos/control-shared/types';

/**
 * Frontend Thread: narrows `title` to non-null string and `status` to exclude
 * the 'deleted' state (deleted threads are never shown in UI).
 */
export interface Thread extends Omit<BackendThread, 'title' | 'status'> {
  title: string;
  status: 'active' | 'archived';
}

/**
 * Frontend Message: makes `tool_calls` and `tool_call_id` optional since they
 * may be absent in the API response for non-tool messages.
 */
export interface Message extends Omit<BackendMessage, 'tool_calls' | 'tool_call_id'> {
  tool_calls?: string | null;
  tool_call_id?: string | null;
}

/**
 * Frontend Run: omits worker-internal fields (`worker_id`, `worker_heartbeat`)
 * not relevant to UI consumers.
 */
export type Run = Omit<BackendRun, 'worker_id' | 'worker_heartbeat'>;

/**
 * Frontend AgentTask: makes enriched fields optional since they may not always
 * be present in API responses (e.g. list vs detail).
 */
export interface AgentTask extends AgentTaskBase {
  thread_title?: string | null;
  latest_run?: AgentTaskRunSummary | null;
  resume_target?: AgentTaskResumeTarget | null;
}

/** Frontend-only: workspace session diff for merge preview. */
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
