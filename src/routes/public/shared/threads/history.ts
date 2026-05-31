import type {
  AgentTaskPriority,
  AgentTaskStatus,
  ArtifactType,
  Message,
  ObjectStoreBinding,
  Run,
  SqlDatabaseBinding,
  ThreadHistoryArtifactSummary,
  ThreadHistoryChildRunSummary,
  ThreadHistoryEvent,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryTaskContext,
} from "takos-api-contract/shared/types";
import { asRunRow, runRowToApi } from "takos-api-contract/shared/types/runs";
import { listThreadMessages } from "./messages.ts";
import { readThreadAccess } from "./read-model.ts";

export type ThreadHistoryEnv = {
  DB: SqlDatabaseBinding;
  TAKOS_OFFLOAD?: ObjectStoreBinding;
};

export type ThreadHistoryOptions = {
  limit: number;
  offset: number;
  includeMessages?: boolean;
  rootRunId?: string | null;
};

type ThreadHistoryResult = {
  messages: Message[];
  total: number;
  limit: number;
  offset: number;
  runs: ThreadHistoryRunNode[];
  focus: ThreadHistoryFocus;
  activeRun: Run | null;
  pendingSessionDiff: PendingSessionDiffSummary;
  taskContext: ThreadHistoryTaskContext | null;
};

type PendingSessionDiffSummary = {
  sessionId: string;
  sessionStatus: string;
  git_mode: boolean;
} | null;

type HistoryRunSnapshot = {
  id: string;
  status: string;
  run: Run;
};

type RunHistoryArtifactRow = {
  id: string;
  runId: string;
  type: string;
  title: string | null;
  fileId: string | null;
  createdAt: string | Date;
};

type RunHistoryEventRow = {
  id: number;
  runId: string;
  type: string;
  data: string;
  createdAt: string | Date;
};

type HistoryTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  updatedAt: string | Date;
};

const AGENT_TASK_STATUSES = new Set<AgentTaskStatus>([
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
]);
const AGENT_TASK_PRIORITIES = new Set<AgentTaskPriority>([
  "low",
  "medium",
  "high",
  "urgent",
]);

export async function getThreadHistory(
  env: ThreadHistoryEnv,
  threadId: string,
  actorAccountId: string,
  options: ThreadHistoryOptions,
): Promise<ThreadHistoryResult | null> {
  const access = await readThreadAccess(env.DB, threadId, actorAccountId);
  if (!access) return null;

  const includeMessages = options.includeMessages !== false;
  const messageResult = includeMessages
    ? await listThreadMessages(env.DB, threadId, actorAccountId, {
      limit: options.limit,
      offset: options.offset,
      offload: env.TAKOS_OFFLOAD,
    })
    : { messages: [], total: 0, runs: [] };
  if (!messageResult) return null;

  const threadRunsNewestFirst = (await readRunsForThread(env.DB, threadId))
    .map(toHistoryRunSnapshot);
  const effectiveRootThreadId = threadRunsNewestFirst[0]?.run.root_thread_id ??
    threadId;
  const allRunsNewestFirst = (await readRunsForRootThread(
    env.DB,
    effectiveRootThreadId,
  )).map(toHistoryRunSnapshot);

  const runsById = new Map(
    allRunsNewestFirst.map((candidate) => [candidate.id, {
      parent_run_id: candidate.run.parent_run_id,
      thread_id: candidate.run.thread_id,
    }]),
  );
  const requestedRootRunId = options.rootRunId?.trim() || null;
  const defaultScopedRootRunId = requestedRootRunId ||
    (threadId !== effectiveRootThreadId
      ? findThreadAnchorRunId(threadId, allRunsNewestFirst, runsById)
      : null);
  const runsNewestFirst = defaultScopedRootRunId
    ? allRunsNewestFirst.filter((row) =>
      isRunInRootTree(row.id, defaultScopedRootRunId, runsById)
    )
    : allRunsNewestFirst;

  const runIds = runsNewestFirst.map((row) => row.id);
  const [artifactRows, eventRows, taskContext, pendingSessionDiff] =
    await Promise.all([
      readArtifactsForRuns(env.DB, runIds),
      readEventsForRuns(env.DB, runIds),
      readThreadHistoryTaskContext(env.DB, threadId),
      readPendingSessionDiff(
        env.DB,
        runsNewestFirst.flatMap((row) =>
          row.run.status === "completed" && row.run.session_id
            ? [row.run.session_id]
            : []
        ),
      ),
    ]);

  const artifactsByRunId = new Map<string, ThreadHistoryArtifactSummary[]>();
  for (const row of artifactRows) {
    const artifact = toHistoryArtifact(row);
    const list = artifactsByRunId.get(artifact.run_id) ?? [];
    list.push(artifact);
    artifactsByRunId.set(artifact.run_id, list);
  }

  const eventsByRunId = new Map<string, ThreadHistoryEvent[]>();
  for (const row of eventRows) {
    const event = toHistoryEvent(row);
    const list = eventsByRunId.get(event.run_id) ?? [];
    list.push(event);
    eventsByRunId.set(event.run_id, list);
  }

  const childRunsByParentId = buildChildRunsByParentId(runsNewestFirst);
  const runNodes = runsNewestFirst
    .slice()
    .reverse()
    .map(({ run }) => {
      const runEvents = eventsByRunId.get(run.id) ?? [];
      const runArtifacts = artifactsByRunId.get(run.id) ?? [];
      const latestEventAt = runEvents[runEvents.length - 1]?.created_at ??
        run.completed_at ??
        run.started_at ??
        run.created_at;
      const childRuns = childRunsByParentId.get(run.id) ?? [];
      const uniqueChildThreadIds = Array.from(
        new Set(
          childRuns
            .map((child) => child.child_thread_id)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      return {
        run,
        artifact_count: runArtifacts.length,
        latest_event_at: latestEventAt,
        artifacts: runArtifacts,
        events: runEvents,
        child_thread_id: uniqueChildThreadIds.length === 1
          ? uniqueChildThreadIds[0]
          : null,
        child_run_count: childRuns.length,
        child_runs: childRuns,
      };
    });

  const activeRun =
    runsNewestFirst.find((row) =>
      row.run.status === "pending" || row.run.status === "queued" ||
      row.run.status === "running"
    )?.run ?? null;

  return {
    messages: messageResult.messages,
    total: messageResult.total,
    limit: options.limit,
    offset: options.offset,
    runs: runNodes,
    focus: buildThreadHistoryFocus(runsNewestFirst),
    activeRun,
    pendingSessionDiff,
    taskContext,
  };
}

async function readRunsForThread(
  db: SqlDatabaseBinding,
  threadId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await db.prepare(`${runSelectSql()} WHERE thread_id = ?
    ORDER BY created_at DESC, id DESC`).bind(threadId).all<
    Record<string, unknown>
  >();
  return rows.results;
}

async function readRunsForRootThread(
  db: SqlDatabaseBinding,
  rootThreadId: string,
): Promise<Record<string, unknown>[]> {
  const rows = await db.prepare(`${runSelectSql()} WHERE root_thread_id = ?
    ORDER BY created_at DESC, id DESC`).bind(rootThreadId).all<
    Record<string, unknown>
  >();
  return rows.results;
}

function runSelectSql(): string {
  return `
    SELECT
      id,
      thread_id AS threadId,
      account_id AS spaceId,
      session_id AS sessionId,
      parent_run_id AS parentRunId,
      child_thread_id AS childThreadId,
      root_thread_id AS rootThreadId,
      root_run_id AS rootRunId,
      agent_type AS agentType,
      status,
      input,
      output,
      error,
      usage,
      service_id AS serviceId,
      service_heartbeat AS serviceHeartbeat,
      started_at AS startedAt,
      completed_at AS completedAt,
      created_at AS createdAt
    FROM runs
  `;
}

async function readArtifactsForRuns(
  db: SqlDatabaseBinding,
  runIds: string[],
): Promise<RunHistoryArtifactRow[]> {
  if (runIds.length === 0) return [];
  const rows = await db.prepare(`
    SELECT
      id,
      run_id AS runId,
      type,
      title,
      file_id AS fileId,
      created_at AS createdAt
    FROM artifacts
    WHERE run_id IN (${placeholders(runIds)})
    ORDER BY created_at ASC, id ASC
  `).bind(...runIds).all<Record<string, unknown>>();
  return rows.results.map(asRunHistoryArtifactRow);
}

async function readEventsForRuns(
  db: SqlDatabaseBinding,
  runIds: string[],
): Promise<RunHistoryEventRow[]> {
  if (runIds.length === 0) return [];
  const rows = await db.prepare(`
    SELECT
      id,
      run_id AS runId,
      type,
      data,
      created_at AS createdAt
    FROM run_events
    WHERE run_id IN (${placeholders(runIds)})
    ORDER BY created_at ASC, id ASC
  `).bind(...runIds).all<Record<string, unknown>>();
  return rows.results.map(asRunHistoryEventRow);
}

async function readThreadHistoryTaskContext(
  db: SqlDatabaseBinding,
  threadId: string,
): Promise<ThreadHistoryTaskContext | null> {
  const rows = await db.prepare(`
    SELECT
      id,
      title,
      status,
      priority,
      updated_at AS updatedAt
    FROM agent_tasks
    WHERE thread_id = ?
    ORDER BY updated_at DESC
    LIMIT 5
  `).bind(threadId).all<Record<string, unknown>>();
  const taskRows = rows.results.map(asHistoryTaskRow);
  const preferred =
    taskRows.find((row) =>
      row.status !== "completed" && row.status !== "cancelled"
    ) ?? taskRows[0];
  if (!preferred) return null;
  if (
    !AGENT_TASK_STATUSES.has(preferred.status as AgentTaskStatus) ||
    !AGENT_TASK_PRIORITIES.has(preferred.priority as AgentTaskPriority)
  ) {
    return null;
  }
  return {
    id: preferred.id,
    title: preferred.title,
    status: preferred.status as AgentTaskStatus,
    priority: preferred.priority as AgentTaskPriority,
  };
}

async function readPendingSessionDiff(
  db: SqlDatabaseBinding,
  completedRunSessionIdsNewestFirst: string[],
): Promise<PendingSessionDiffSummary> {
  for (const sessionId of completedRunSessionIdsNewestFirst) {
    const session = await db.prepare(`
      SELECT id, status, repo_id AS repoId
      FROM sessions
      WHERE id = ?
      LIMIT 1
    `).bind(sessionId).first<Record<string, unknown>>();
    if (!session) continue;
    const status = stringField(session, "status");
    if (status === "discarded") continue;
    return {
      sessionId: stringField(session, "id"),
      sessionStatus: status,
      git_mode: Boolean(nullableStringField(session, "repoId")),
    };
  }
  return null;
}

function buildChildRunsByParentId(
  runsNewestFirst: HistoryRunSnapshot[],
): Map<string, ThreadHistoryChildRunSummary[]> {
  const childRunsByParentId = new Map<string, ThreadHistoryChildRunSummary[]>();
  const filteredRunsById = new Map(
    runsNewestFirst.map((candidate) => [candidate.id, candidate.run]),
  );
  for (const { run } of runsNewestFirst) {
    if (!run.parent_run_id) continue;
    const parent = filteredRunsById.get(run.parent_run_id);
    if (!parent) continue;
    if (run.thread_id === parent.thread_id && !run.child_thread_id) continue;
    const list = childRunsByParentId.get(parent.id) ?? [];
    list.push(toChildRunSummary(run));
    childRunsByParentId.set(parent.id, list);
  }
  return childRunsByParentId;
}

function toHistoryRunSnapshot(
  row: Record<string, unknown>,
): HistoryRunSnapshot {
  const run = runRowToApi(asRunRow(row));
  return { id: run.id, status: run.status, run };
}

function toHistoryArtifact(
  row: RunHistoryArtifactRow,
): ThreadHistoryArtifactSummary {
  return {
    id: row.id,
    run_id: row.runId,
    type: row.type as ArtifactType,
    title: row.title,
    file_id: row.fileId,
    created_at: toIsoString(row.createdAt),
  };
}

function toHistoryEvent(row: RunHistoryEventRow): ThreadHistoryEvent {
  return {
    id: row.id,
    run_id: row.runId,
    type: row.type,
    data: row.data,
    created_at: toIsoString(row.createdAt),
  };
}

function toChildRunSummary(run: Run): ThreadHistoryChildRunSummary {
  return {
    run_id: run.id,
    thread_id: run.thread_id,
    child_thread_id: run.child_thread_id,
    status: run.status,
    agent_type: run.agent_type,
    created_at: run.created_at,
    completed_at: run.completed_at,
  };
}

function buildThreadHistoryFocus(
  runsNewestFirst: Array<{ id: string; status: string }>,
): ThreadHistoryFocus {
  const latestRunId = runsNewestFirst[0]?.id ?? null;
  const latestActiveRunId =
    runsNewestFirst.find((run) =>
      run.status === "pending" || run.status === "queued" ||
      run.status === "running"
    )?.id ?? null;
  const latestFailedRunId =
    runsNewestFirst.find((run) => run.status === "failed")?.id ?? null;
  const latestCompletedRunId =
    runsNewestFirst.find((run) => run.status === "completed")?.id ?? null;
  return {
    latest_run_id: latestRunId,
    latest_active_run_id: latestActiveRunId,
    latest_failed_run_id: latestFailedRunId,
    latest_completed_run_id: latestCompletedRunId,
    resume_run_id: latestActiveRunId ?? latestFailedRunId ?? latestRunId,
  };
}

function isRunInRootTree(
  runId: string,
  rootRunId: string,
  runsById: Map<string, { parent_run_id: string | null }>,
): boolean {
  let currentRunId: string | null = runId;
  const visited = new Set<string>();
  while (currentRunId) {
    if (currentRunId === rootRunId) return true;
    if (visited.has(currentRunId)) return false;
    visited.add(currentRunId);
    currentRunId = runsById.get(currentRunId)?.parent_run_id ?? null;
  }
  return false;
}

function runHasAncestorInThread(
  run: Run,
  threadId: string,
  runsById: Map<string, { parent_run_id: string | null; thread_id: string }>,
): boolean {
  let currentRunId = run.parent_run_id;
  const visited = new Set<string>();
  while (currentRunId) {
    if (visited.has(currentRunId)) return false;
    visited.add(currentRunId);
    const current = runsById.get(currentRunId);
    if (!current) return false;
    if (current.thread_id === threadId) return true;
    currentRunId = current.parent_run_id;
  }
  return false;
}

function findThreadAnchorRunId(
  threadId: string,
  runsNewestFirst: HistoryRunSnapshot[],
  runsById: Map<string, { parent_run_id: string | null; thread_id: string }>,
): string | null {
  const threadRunsOldestFirst = runsNewestFirst
    .filter((candidate) => candidate.run.thread_id === threadId)
    .slice()
    .reverse();
  for (const candidate of threadRunsOldestFirst) {
    if (!runHasAncestorInThread(candidate.run, threadId, runsById)) {
      return candidate.id;
    }
  }
  return threadRunsOldestFirst[0]?.id ?? null;
}

function placeholders(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}

function asRunHistoryArtifactRow(
  row: Record<string, unknown>,
): RunHistoryArtifactRow {
  return {
    id: stringField(row, "id"),
    runId: stringField(row, "runId"),
    type: stringField(row, "type"),
    title: nullableStringField(row, "title"),
    fileId: nullableStringField(row, "fileId"),
    createdAt: dateField(row, "createdAt"),
  };
}

function asRunHistoryEventRow(
  row: Record<string, unknown>,
): RunHistoryEventRow {
  return {
    id: numberField(row, "id"),
    runId: stringField(row, "runId"),
    type: stringField(row, "type"),
    data: stringField(row, "data"),
    createdAt: dateField(row, "createdAt"),
  };
}

function asHistoryTaskRow(row: Record<string, unknown>): HistoryTaskRow {
  return {
    id: stringField(row, "id"),
    title: stringField(row, "title"),
    status: stringField(row, "status"),
    priority: stringField(row, "priority"),
    updatedAt: dateField(row, "updatedAt"),
  };
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Thread history row field ${key} must be a string`);
}

function nullableStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new TypeError(
    `Thread history row field ${key} must be a string or null`,
  );
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  throw new TypeError(`Thread history row field ${key} must be a number`);
}

function dateField(row: Record<string, unknown>, key: string): string | Date {
  const value = row[key];
  if (typeof value === "string" || value instanceof Date) return value;
  throw new TypeError(`Thread history row field ${key} must be a date`);
}

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}
