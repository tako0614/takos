export interface ToolExecution {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
  duration_ms?: number;
}

/**
 * Canonical Agent RunStatus definition.
 * Shared by Takos control and agent runtime surfaces.
 *
 * NOT the same as the GitHub Actions RunStatus in src/worker/actions-engine/workflow-models.ts
 * ('queued'|'in_progress'|'completed'|'cancelled') — different domain concept.
 */
export type RunStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

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
  model: string | null;
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

export type RunRow = {
  id: string;
  threadId: string;
  spaceId: string;
  sessionId: string | null;
  parentRunId: string | null;
  childThreadId: string | null;
  rootThreadId: string | null;
  rootRunId: string | null;
  agentType: string;
  model?: string | null;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  usage: string;
  serviceId?: string | null;
  workerId?: string | null;
  serviceHeartbeat?: string | Date | null;
  workerHeartbeat?: string | Date | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  createdAt: string | Date;
};

function stringField(row: Record<string, unknown>, key: keyof RunRow): string {
  const value = row[key];
  if (typeof value === 'string') return value;
  throw new TypeError(`Run row field ${String(key)} must be a string`);
}

function nullableStringField(
  row: Record<string, unknown>,
  key: keyof RunRow,
): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === 'string') return value;
  throw new TypeError(`Run row field ${String(key)} must be a string or null`);
}

function nullableDateField(
  row: Record<string, unknown>,
  key: keyof RunRow,
): string | Date | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === 'string' || value instanceof Date) return value;
  throw new TypeError(`Run row field ${String(key)} must be a date or null`);
}

function dateField(
  row: Record<string, unknown>,
  key: keyof RunRow,
): string | Date {
  const value = row[key];
  if (typeof value === 'string' || value instanceof Date) return value;
  throw new TypeError(`Run row field ${String(key)} must be a date`);
}

function toIsoString(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

function toNullableIsoString(value: string | Date | null): string | null {
  return value == null ? null : toIsoString(value);
}

export function asRunRow(row: Record<string, unknown>): RunRow {
  return {
    id: stringField(row, 'id'),
    threadId: stringField(row, 'threadId'),
    spaceId: stringField(row, 'spaceId'),
    sessionId: nullableStringField(row, 'sessionId'),
    parentRunId: nullableStringField(row, 'parentRunId'),
    childThreadId: nullableStringField(row, 'childThreadId'),
    rootThreadId: nullableStringField(row, 'rootThreadId'),
    rootRunId: nullableStringField(row, 'rootRunId'),
    agentType: stringField(row, 'agentType'),
    model: nullableStringField(row, 'model'),
    status: stringField(row, 'status'),
    input: stringField(row, 'input'),
    output: nullableStringField(row, 'output'),
    error: nullableStringField(row, 'error'),
    usage: stringField(row, 'usage'),
    serviceId: nullableStringField(row, 'serviceId'),
    workerId: nullableStringField(row, 'workerId'),
    serviceHeartbeat: nullableDateField(row, 'serviceHeartbeat'),
    workerHeartbeat: nullableDateField(row, 'workerHeartbeat'),
    startedAt: nullableDateField(row, 'startedAt'),
    completedAt: nullableDateField(row, 'completedAt'),
    createdAt: dateField(row, 'createdAt'),
  };
}

export function runRowToApi(row: RunRow): Run {
  const rootThreadId = row.rootThreadId ?? row.threadId;
  const rootRunId = row.rootRunId ?? row.id;
  const serviceId = row.serviceId ?? row.workerId ?? null;
  const serviceHeartbeat = row.serviceHeartbeat ?? row.workerHeartbeat ?? null;
  return {
    id: row.id,
    thread_id: row.threadId,
    space_id: row.spaceId,
    session_id: row.sessionId,
    parent_run_id: row.parentRunId,
    child_thread_id: row.childThreadId,
    root_thread_id: rootThreadId,
    root_run_id: rootRunId,
    agent_type: row.agentType,
    model: row.model ?? null,
    status: row.status as RunStatus,
    input: row.input,
    output: row.output,
    error: row.error,
    usage: row.usage,
    worker_id: serviceId,
    worker_heartbeat: toNullableIsoString(serviceHeartbeat),
    started_at: toNullableIsoString(row.startedAt),
    completed_at: toNullableIsoString(row.completedAt),
    created_at: toIsoString(row.createdAt),
  };
}
