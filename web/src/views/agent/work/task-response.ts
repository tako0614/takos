import {
  MAX_AGENT_TASK_DESCRIPTION_CHARACTERS,
  MAX_AGENT_TASK_MODEL_CHARACTERS,
  MAX_AGENT_TASK_PLAN_BYTES,
  MAX_AGENT_TASK_REFERENCE_CHARACTERS,
  MAX_AGENT_TASK_TITLE_CHARACTERS,
} from "takos-api-contract/shared/types";
import type {
  AgentTask,
  AgentTaskPriority,
  AgentTaskStatus,
} from "../../../types/index.ts";

const MAX_TASKS_PER_PAGE = 200;
const MAX_AGENT_TYPE_CHARACTERS = 128;
const MAX_RUN_ERROR_CHARACTERS = 16_384;
const TASK_STATUSES = new Set<AgentTaskStatus>([
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
  "failed",
]);
const TASK_PRIORITIES = new Set<AgentTaskPriority>([
  "low",
  "medium",
  "high",
  "urgent",
]);
const RUN_STATUSES = new Set([
  "pending",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
const RESUME_REASONS = new Set(["active", "failed", "latest", "thread"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
): string {
  if (
    typeof value !== "string" || !value.trim() ||
    value.length > maxCharacters
  ) {
    throw new TypeError(`Invalid Agent Task ${field}`);
  }
  return value;
}

function nullableBoundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
  allowEmpty = false,
): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" || value.length > maxCharacters ||
    (!allowEmpty && !value.trim())
  ) {
    throw new TypeError(`Invalid Agent Task ${field}`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const text = boundedString(value, field, 64);
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`Invalid Agent Task ${field}`);
  }
  return text;
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

function parseLatestRun(value: unknown): AgentTask["latest_run"] {
  if (value === null) return null;
  const candidate = record(value);
  if (!candidate || !RUN_STATUSES.has(candidate.status as string)) {
    throw new TypeError("Invalid Agent Task latest_run");
  }
  if (
    !Number.isSafeInteger(candidate.artifact_count) ||
    (candidate.artifact_count as number) < 0
  ) {
    throw new TypeError("Invalid Agent Task artifact_count");
  }
  return {
    run_id: boundedString(
      candidate.run_id,
      "latest_run.run_id",
      MAX_AGENT_TASK_REFERENCE_CHARACTERS,
    ),
    status: candidate.status as NonNullable<AgentTask["latest_run"]>["status"],
    agent_type: boundedString(
      candidate.agent_type,
      "latest_run.agent_type",
      MAX_AGENT_TYPE_CHARACTERS,
    ),
    started_at: nullableTimestamp(
      candidate.started_at,
      "latest_run.started_at",
    ),
    completed_at: nullableTimestamp(
      candidate.completed_at,
      "latest_run.completed_at",
    ),
    created_at: timestamp(candidate.created_at, "latest_run.created_at"),
    error: nullableBoundedString(
      candidate.error,
      "latest_run.error",
      MAX_RUN_ERROR_CHARACTERS,
      true,
    ),
    artifact_count: candidate.artifact_count as number,
  };
}

function parseResumeTarget(value: unknown): AgentTask["resume_target"] {
  if (value === null) return null;
  const candidate = record(value);
  if (!candidate || !RESUME_REASONS.has(candidate.reason as string)) {
    throw new TypeError("Invalid Agent Task resume_target");
  }
  return {
    thread_id: boundedString(
      candidate.thread_id,
      "resume_target.thread_id",
      MAX_AGENT_TASK_REFERENCE_CHARACTERS,
    ),
    run_id: nullableBoundedString(
      candidate.run_id,
      "resume_target.run_id",
      MAX_AGENT_TASK_REFERENCE_CHARACTERS,
    ),
    reason: candidate.reason as NonNullable<AgentTask["resume_target"]>["reason"],
  };
}

function parseAgentTask(value: unknown): AgentTask {
  const candidate = record(value);
  if (
    !candidate || !TASK_STATUSES.has(candidate.status as AgentTaskStatus) ||
    !TASK_PRIORITIES.has(candidate.priority as AgentTaskPriority)
  ) {
    throw new TypeError("Invalid Agent Task response item");
  }

  const threadId = nullableBoundedString(
    candidate.thread_id,
    "thread_id",
    MAX_AGENT_TASK_REFERENCE_CHARACTERS,
  );
  const latestRun = parseLatestRun(candidate.latest_run);
  const resumeTarget = parseResumeTarget(candidate.resume_target);
  if (
    (!threadId && (latestRun || resumeTarget)) ||
    (resumeTarget && resumeTarget.thread_id !== threadId)
  ) {
    throw new TypeError("Agent Task execution target does not match its thread");
  }

  const plan = candidate.plan === null
    ? null
    : nullableBoundedString(
      candidate.plan,
      "plan",
      MAX_AGENT_TASK_PLAN_BYTES,
      true,
    );
  if (
    plan !== null && new TextEncoder().encode(plan).byteLength >
      MAX_AGENT_TASK_PLAN_BYTES
  ) {
    throw new TypeError("Invalid Agent Task plan");
  }

  return {
    id: boundedString(
      candidate.id,
      "id",
      MAX_AGENT_TASK_REFERENCE_CHARACTERS,
    ),
    space_id: boundedString(
      candidate.space_id,
      "space_id",
      MAX_AGENT_TASK_REFERENCE_CHARACTERS,
    ),
    created_by: nullableBoundedString(
      candidate.created_by,
      "created_by",
      MAX_AGENT_TASK_REFERENCE_CHARACTERS,
    ),
    thread_id: threadId,
    last_run_id: nullableBoundedString(
      candidate.last_run_id,
      "last_run_id",
      MAX_AGENT_TASK_REFERENCE_CHARACTERS,
    ),
    title: boundedString(
      candidate.title,
      "title",
      MAX_AGENT_TASK_TITLE_CHARACTERS,
    ),
    description: nullableBoundedString(
      candidate.description,
      "description",
      MAX_AGENT_TASK_DESCRIPTION_CHARACTERS,
      true,
    ),
    status: candidate.status as AgentTaskStatus,
    priority: candidate.priority as AgentTaskPriority,
    agent_type: boundedString(
      candidate.agent_type,
      "agent_type",
      MAX_AGENT_TYPE_CHARACTERS,
    ),
    model: nullableBoundedString(
      candidate.model,
      "model",
      MAX_AGENT_TASK_MODEL_CHARACTERS,
    ),
    plan,
    due_at: nullableTimestamp(candidate.due_at, "due_at"),
    started_at: nullableTimestamp(candidate.started_at, "started_at"),
    completed_at: nullableTimestamp(candidate.completed_at, "completed_at"),
    created_at: timestamp(candidate.created_at, "created_at"),
    updated_at: timestamp(candidate.updated_at, "updated_at"),
    thread_title: nullableBoundedString(
      candidate.thread_title,
      "thread_title",
      MAX_AGENT_TASK_TITLE_CHARACTERS,
      true,
    ),
    latest_run: latestRun,
    resume_target: resumeTarget,
  };
}

export function readAgentTaskListResponse(value: unknown): AgentTask[] {
  const candidate = record(value);
  if (
    !candidate || !Array.isArray(candidate.tasks) ||
    candidate.tasks.length > MAX_TASKS_PER_PAGE
  ) {
    throw new TypeError("Invalid Agent Task list response");
  }
  const tasks = candidate.tasks.map(parseAgentTask);
  const ids = new Set<string>();
  let spaceId: string | null = null;
  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw new TypeError("Agent Task response contains duplicate ids");
    }
    ids.add(task.id);
    spaceId ??= task.space_id;
    if (task.space_id !== spaceId) {
      throw new TypeError("Agent Task response mixes Workspaces");
    }
  }
  return tasks;
}
