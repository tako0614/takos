export type RunStatus = 'queued' | 'in_progress' | 'completed' | 'cancelled' | 'waiting';
export type RunConclusion = 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | null;

export interface WorkflowRunSummary {
  id: string;
  workflow_path: string;
  event: string;
  ref: string | null;
  sha: string | null;
  status: RunStatus;
  conclusion: RunConclusion;
  run_number: number | null;
  run_attempt: number;
  queued_at: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  actor?: {
    id: string;
    name: string;
    avatar_url?: string | null;
  } | null;
}

export interface WorkflowJob {
  id: string;
  name: string;
  status: RunStatus;
  conclusion: RunConclusion;
  runner_name?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  steps?: Array<{
    number: number;
    name: string;
    status: 'pending' | 'in_progress' | 'completed' | 'skipped';
    conclusion: RunConclusion;
    started_at?: string | null;
    completed_at?: string | null;
  }>;
}

export interface WorkflowRunDetail {
  id: string;
  workflow_path: string;
  event: string;
  ref: string | null;
  sha: string | null;
  status: RunStatus;
  conclusion: RunConclusion;
  run_number: number | null;
  run_attempt: number;
  queued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  jobs: WorkflowJob[];
}

export interface JobLogState {
  text: string;
  nextOffset: number;
  hasMore: boolean;
  totalSize?: number | null;
}

export const LOG_CHUNK_BYTES = 128 * 1024;

export function statusBadge(status: RunStatus, conclusion?: RunConclusion): string {
  if (status === 'completed') {
    if (conclusion === 'success') return 'bg-zinc-100 text-zinc-700 border-zinc-300';
    if (conclusion === 'cancelled') return 'bg-zinc-50 text-zinc-400 border-zinc-300';
    if (conclusion === 'skipped') return 'bg-zinc-50 text-zinc-400 border-zinc-200';
    return 'bg-zinc-50 text-zinc-500 border-zinc-400';
  }
  if (status === 'in_progress') return 'bg-zinc-900 text-white border-zinc-900';
  if (status === 'cancelled') return 'bg-zinc-50 text-zinc-400 border-zinc-300';
  return 'bg-zinc-100 text-zinc-600 border-zinc-200';
}
