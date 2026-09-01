import type { ThreadHistoryRunSummary } from "../types/index.ts";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const RUN_STATUSES = new Set<ThreadHistoryRunSummary["status"]>([
  "pending",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
const TERMINAL_RUN_STATUSES = new Set<ThreadHistoryRunSummary["status"]>([
  "completed",
  "failed",
  "cancelled",
]);
const RAW_RUN_FIELDS = new Set([
  "id",
  "thread_id",
  "space_id",
  "session_id",
  "parent_run_id",
  "child_thread_id",
  "root_thread_id",
  "root_run_id",
  "agent_type",
  "model",
  "status",
  "terminal_reason",
  "input",
  "output",
  "error",
  "usage",
  "worker_id",
  "worker_heartbeat",
  "started_at",
  "completed_at",
  "created_at",
]);

type ExpectedRun = {
  runId: string;
  threadId?: string;
  spaceId?: string;
  agentType?: string;
};

export interface ChatRunCreationSummary extends ThreadHistoryRunSummary {
  error: string | null;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Invalid Chat Run ${field}`);
  }
  return value as Record<string, unknown>;
}

function exactFields(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
): boolean {
  const fields = Object.keys(value);
  return fields.length === expected.size &&
    fields.every((field) => expected.has(field));
}

function opaqueId(value: unknown, field: string): string {
  if (typeof value !== "string" || !OPAQUE_ID_PATTERN.test(value)) {
    throw new TypeError(`Invalid Chat Run ${field}`);
  }
  return value;
}

function nullableOpaqueId(value: unknown, field: string): string | null {
  return value === null ? null : opaqueId(value, field);
}

function boundedText(
  value: unknown,
  field: string,
  maximum: number,
  allowEmpty = false,
  allowWhitespace = false,
): string {
  const invalidControlPattern = allowWhitespace
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
    : /[\u0000-\u001f\u007f]/u;
  if (
    typeof value !== "string" || value.length > maximum ||
    (!allowEmpty && value.length === 0) || invalidControlPattern.test(value)
  ) {
    throw new TypeError(`Invalid Chat Run ${field}`);
  }
  return value;
}

function nullableBoundedText(
  value: unknown,
  field: string,
  maximum: number,
  allowWhitespace = false,
): string | null {
  return value === null
    ? null
    : boundedText(value, field, maximum, true, allowWhitespace);
}

function timestamp(value: unknown, field: string): string {
  const result = boundedText(value, field, 64);
  if (!Number.isFinite(Date.parse(result))) {
    throw new TypeError(`Invalid Chat Run ${field}`);
  }
  return result;
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : timestamp(value, field);
}

function parseRunStatus(value: unknown): ThreadHistoryRunSummary["status"] {
  if (!RUN_STATUSES.has(value as ThreadHistoryRunSummary["status"])) {
    throw new TypeError("Invalid Chat Run status");
  }
  return value as ThreadHistoryRunSummary["status"];
}

function parseTerminalReason(
  value: unknown,
): ThreadHistoryRunSummary["terminal_reason"] {
  if (
    value !== null && value !== "context_revoked" &&
    value !== "context_invalid"
  ) {
    throw new TypeError("Invalid Chat Run terminal reason");
  }
  return value;
}

function requireRawExecutionShape(candidate: Record<string, unknown>): void {
  boundedText(candidate.input, "input", 64 * 1024, true, true);
  nullableBoundedText(candidate.output, "output", 8 * 1024 * 1024, true);
  nullableBoundedText(candidate.error, "error", 64 * 1024, true);
  boundedText(candidate.usage, "usage", 256 * 1024, true, true);
  nullableOpaqueId(candidate.worker_id, "worker id");
  nullableTimestamp(candidate.worker_heartbeat, "worker heartbeat");
}

function parseRawRun(
  value: unknown,
  expected: ExpectedRun,
): ThreadHistoryRunSummary {
  const candidate = record(value, "record");
  if (!exactFields(candidate, RAW_RUN_FIELDS)) {
    throw new TypeError("Invalid Chat Run response fields");
  }
  requireRawExecutionShape(candidate);

  const id = opaqueId(candidate.id, "id");
  const threadId = opaqueId(candidate.thread_id, "Thread id");
  const spaceId = opaqueId(candidate.space_id, "Workspace id");
  const agentType = boundedText(candidate.agent_type, "agent type", 128);
  if (
    id !== expected.runId ||
    (expected.threadId !== undefined && threadId !== expected.threadId) ||
    (expected.spaceId !== undefined && spaceId !== expected.spaceId) ||
    (expected.agentType !== undefined && agentType !== expected.agentType)
  ) {
    throw new TypeError("Mismatched Chat Run authority");
  }

  const status = parseRunStatus(candidate.status);
  const createdAt = timestamp(candidate.created_at, "created_at");
  const startedAt = nullableTimestamp(candidate.started_at, "started_at");
  const completedAt = nullableTimestamp(
    candidate.completed_at,
    "completed_at",
  );
  const createdAtMs = Date.parse(createdAt);
  const startedAtMs = startedAt === null ? null : Date.parse(startedAt);
  const completedAtMs = completedAt === null ? null : Date.parse(completedAt);
  if (
    (startedAtMs !== null && startedAtMs < createdAtMs) ||
    (completedAtMs !== null && completedAtMs < createdAtMs) ||
    (startedAtMs !== null && completedAtMs !== null &&
      completedAtMs < startedAtMs) ||
    (TERMINAL_RUN_STATUSES.has(status) !== (completedAt !== null))
  ) {
    throw new TypeError("Incoherent Chat Run lifecycle");
  }

  return {
    id,
    thread_id: threadId,
    space_id: spaceId,
    session_id: nullableOpaqueId(candidate.session_id, "session id"),
    parent_run_id: nullableOpaqueId(candidate.parent_run_id, "parent id"),
    child_thread_id: nullableOpaqueId(
      candidate.child_thread_id,
      "child Thread id",
    ),
    root_thread_id: opaqueId(candidate.root_thread_id, "root Thread id"),
    root_run_id: nullableOpaqueId(candidate.root_run_id, "root Run id"),
    agent_type: agentType,
    model: candidate.model === null
      ? null
      : boundedText(candidate.model, "model", 128),
    status,
    terminal_reason: parseTerminalReason(candidate.terminal_reason),
    started_at: startedAt,
    completed_at: completedAt,
    created_at: createdAt,
  };
}

export function parseChatRunCreateResponse(
  value: unknown,
  expected: ExpectedRun,
): { run: ChatRunCreationSummary; reused: boolean } {
  const candidate = record(value, "creation response");
  if (
    !exactFields(candidate, new Set(["run", "reused"])) ||
    typeof candidate.reused !== "boolean"
  ) {
    throw new TypeError("Invalid Chat Run creation response");
  }
  const run = parseRawRun(candidate.run, expected);
  if (
    run.parent_run_id !== null || run.child_thread_id !== null ||
    run.root_thread_id !== run.thread_id || run.root_run_id !== run.id
  ) {
    throw new TypeError("Mismatched Chat Run hierarchy");
  }
  const rawRun = record(candidate.run, "record");
  return {
    run: {
      ...run,
      error: nullableBoundedText(rawRun.error, "error", 64 * 1024, true),
    },
    reused: candidate.reused,
  };
}

export function parseChatRunDetailResponse(
  value: unknown,
  expected: ExpectedRun,
): ThreadHistoryRunSummary {
  const candidate = record(value, "detail response");
  if (!exactFields(candidate, new Set(["run"]))) {
    throw new TypeError("Invalid Chat Run detail response");
  }
  return parseRawRun(candidate.run, expected);
}
