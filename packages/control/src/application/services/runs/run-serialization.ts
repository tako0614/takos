import type { Run, RunStatus } from '../../../shared/types';
import { textDate } from '../../../shared/utils/db-guards';

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

export type RunHierarchyNode = {
  id: string;
  threadId: string;
  accountId: string;
  parentRunId: string | null;
  rootThreadId: string | null;
  rootRunId: string | null;
};

export type SpaceModelLookup = {
  aiModel: string | null;
};


export type D1CountRow = {
  count: number | string;
};

function toNullableIsoString(value: string | Date | null): string | null {
  return value == null ? null : typeof value === 'string' ? value : value.toISOString();
}

export const runSelect = {
  id: true,
  threadId: true,
  spaceId: true,
  sessionId: true,
  parentRunId: true,
  childThreadId: true,
  rootThreadId: true,
  rootRunId: true,
  agentType: true,
  status: true,
  input: true,
  output: true,
  error: true,
  usage: true,
  serviceId: true,
  serviceHeartbeat: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} as const;

export function asRunRow(row: Record<string, unknown>): RunRow {
  return row as unknown as RunRow;
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
    status: row.status as RunStatus,
    input: row.input,
    output: row.output,
    error: row.error,
    usage: row.usage,
    worker_id: serviceId,
    worker_heartbeat: toNullableIsoString(serviceHeartbeat),
    started_at: toNullableIsoString(row.startedAt),
    completed_at: toNullableIsoString(row.completedAt),
    created_at: textDate(row.createdAt),
  };
}
