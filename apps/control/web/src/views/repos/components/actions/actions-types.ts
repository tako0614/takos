import type {
  TranslationKey,
  TranslationParams,
} from "../../../../store/i18n.ts";

/**
 * GitHub Actions workflow RunStatus for the web UI.
 *
 * This is the *Actions* domain status — intentionally different from the *Agent* RunStatus
 * ('pending'|'queued'|'running'|'completed'|'failed'|'cancelled') in packages/control/src/shared/types/models.ts.
 *
 * Extends the engine definition (packages/actions-engine/src/workflow-models.ts) with 'waiting',
 * which represents jobs blocked on concurrency groups or approval gates in the UI.
 * The engine itself does not emit 'waiting' — it is derived by the web frontend when a
 * queued run has not yet started any job execution.
 */
export type RunStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "waiting";
export type RunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | null;

export type WorkflowStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "skipped";

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
    status: WorkflowStepStatus;
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

type Translate = (
  key: TranslationKey,
  params?: TranslationParams,
) => string;

export function workflowRunStatusLabel(
  status: RunStatus,
  conclusion: RunConclusion | undefined,
  t: Translate,
): string {
  if (status === "completed" && conclusion) {
    return t(`workflowRunConclusion_${conclusion}` as TranslationKey);
  }
  return t(`workflowRunStatus_${status}` as TranslationKey);
}

export function workflowStepStatusLabel(
  status: WorkflowStepStatus,
  conclusion: RunConclusion | undefined,
  t: Translate,
): string {
  if (status === "completed" && conclusion) {
    return t(`workflowRunConclusion_${conclusion}` as TranslationKey);
  }
  return t(`workflowStepStatus_${status}` as TranslationKey);
}

export function statusBadge(
  status: RunStatus,
  conclusion?: RunConclusion,
): string {
  if (status === "completed") {
    if (conclusion === "success") {
      return "bg-zinc-100 text-zinc-700 border-zinc-300";
    }
    if (conclusion === "cancelled") {
      return "bg-zinc-50 text-zinc-400 border-zinc-300";
    }
    if (conclusion === "skipped") {
      return "bg-zinc-50 text-zinc-400 border-zinc-200";
    }
    return "bg-zinc-50 text-zinc-500 border-zinc-400";
  }
  if (status === "in_progress") return "bg-zinc-900 text-white border-zinc-900";
  if (status === "cancelled") return "bg-zinc-50 text-zinc-400 border-zinc-300";
  return "bg-zinc-100 text-zinc-600 border-zinc-200";
}
