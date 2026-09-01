import type { RunStatus } from "./runs.ts";

export const DEFAULT_AGENT_TYPE = "default";
export const MAX_AGENT_TASK_TITLE_CHARACTERS = 240;
export const MAX_AGENT_TASK_DESCRIPTION_CHARACTERS = 4_000;
export const MAX_AGENT_TASK_MODEL_CHARACTERS = 128;
export const MAX_AGENT_TASK_REFERENCE_CHARACTERS = 128;
export const MAX_AGENT_TASK_PLAN_BYTES = 64 * 1_024;
export const AGENT_TYPES = [
  DEFAULT_AGENT_TYPE,
  "assistant",
  "planner",
  "researcher",
  "implementer",
  "reviewer",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export function isAgentType(value: unknown): value is AgentType {
  return typeof value === "string" &&
    (AGENT_TYPES as readonly string[]).includes(value);
}

export type AgentTaskStatus =
  | "planned"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

/**
 * Narrow subset of {@link AgentTaskStatus} for the terminal states tracked
 * by the `completedAt` timestamp in the route handlers. Excludes
 * `"cancelled"` because cancellation goes through a separate accounting
 * path that does not stamp `completedAt`.
 */
export type TerminalAgentTaskStatus = Extract<
  AgentTaskStatus,
  "completed" | "failed"
>;

export type AgentTaskPriority = "low" | "medium" | "high" | "urgent";

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
  reason: "active" | "failed" | "latest" | "thread";
}
