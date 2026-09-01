import {
  agentTasks,
  artifacts,
  getDb,
  runEvents,
  runs,
} from "../../../infra/db/index.ts";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  AgentTask,
  ArtifactType,
  Env,
  RunStatus,
  ThreadHistoryArtifactSummary,
  ThreadHistoryChildRunSummary,
  ThreadHistoryEvent,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryRunSummary,
  ThreadHistoryTaskContext,
  ThreadHistoryTruncation,
} from "../../../shared/types/index.ts";
import { textDate, textDateNullable } from "../../../shared/utils/db-guards.ts";
import { listThreadMessages } from "./thread-service.ts";
import { chunkForInClause } from "../../../shared/utils/in-clause.ts";
import {
  CHAT_HISTORY_TRUNCATED_EVENT_DATA,
  MAX_CHAT_HISTORY_ARTIFACTS,
  MAX_CHAT_HISTORY_EVENT_DATA_CHARACTERS,
  MAX_CHAT_HISTORY_EVENTS,
  MAX_CHAT_HISTORY_RUNS,
  MAX_CHAT_HISTORY_TELEMETRY_CHARACTERS,
} from "takos-api-contract/chat-history";
import { RUN_EVENT_TRUNCATED_DATA } from "../offload/run-events.ts";

/**
 * Defensive cap on how many runs a single thread-history read loads from the
 * root delegation tree. A busy thread/project accumulates one run per turn plus
 * child runs per sub-agent delegation with no retention, so an uncapped scan
 * would pull the whole tree (and all its artifacts/events) into the Worker on
 * every open. Newest-first ordering means the cap keeps the most recent runs,
 * which is what the history view surfaces.
 */
export const MAX_THREAD_HISTORY_RUNS = MAX_CHAT_HISTORY_RUNS;

type HistoryTaskRow = {
  id: string;
  spaceId: string;
  threadId: string | null;
  title: string;
  status: string;
  terminalReason: string | null;
  priority: string;
  updatedAt: string | Date;
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

const EVENT_QUERY_PAGE_ROWS = 128;

type HistoryRunSnapshot = {
  id: string;
  status: string;
  run: ThreadHistoryRunSummary;
};

type HistoryRunRow = {
  id: string;
  threadId: string;
  accountId: string;
  sessionId: string | null;
  parentRunId: string | null;
  childThreadId: string | null;
  rootThreadId: string | null;
  rootRunId: string | null;
  agentType: string;
  model: string | null;
  status: string;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  createdAt: string | Date;
};

const HISTORY_RUN_SELECTION = {
  id: runs.id,
  threadId: runs.threadId,
  accountId: runs.accountId,
  sessionId: runs.sessionId,
  parentRunId: runs.parentRunId,
  childThreadId: runs.childThreadId,
  rootThreadId: runs.rootThreadId,
  rootRunId: runs.rootRunId,
  agentType: runs.agentType,
  model: runs.model,
  status: runs.status,
  terminalReason: runs.terminalReason,
  startedAt: runs.startedAt,
  completedAt: runs.completedAt,
  createdAt: runs.createdAt,
} as const;

export const threadHistoryDeps = {
  getDb,
  listThreadMessages,
};

const AGENT_TASK_STATUSES = new Set<AgentTask["status"]>([
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
  "failed",
]);
const AGENT_TASK_PRIORITIES = new Set<AgentTask["priority"]>([
  "low",
  "medium",
  "high",
  "urgent",
]);

function isAgentTaskStatus(value: string): value is AgentTask["status"] {
  return AGENT_TASK_STATUSES.has(value as AgentTask["status"]);
}

function isAgentTaskPriority(value: string): value is AgentTask["priority"] {
  return AGENT_TASK_PRIORITIES.has(value as AgentTask["priority"]);
}

function toHistoryRunSnapshot(row: HistoryRunRow): HistoryRunSnapshot {
  const rootThreadId = row.rootThreadId ?? row.threadId;
  const rootRunId = row.rootRunId ?? row.id;
  return {
    id: row.id,
    status: row.status,
    run: {
      id: row.id,
      thread_id: row.threadId,
      space_id: row.accountId,
      session_id: row.sessionId ?? null,
      parent_run_id: row.parentRunId ?? null,
      child_thread_id: row.childThreadId ?? null,
      root_thread_id: rootThreadId,
      root_run_id: rootRunId,
      agent_type: row.agentType,
      model: row.model ?? null,
      status: row.status as RunStatus,
      terminal_reason: row.terminalReason as
        | "context_revoked"
        | "context_invalid"
        | null,
      started_at: row.startedAt ? textDateNullable(row.startedAt) : null,
      completed_at: row.completedAt ? textDateNullable(row.completedAt) : null,
      created_at: textDate(row.createdAt),
    },
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
    if (currentRunId === rootRunId) {
      return true;
    }
    if (visited.has(currentRunId)) {
      return false;
    }
    visited.add(currentRunId);
    currentRunId = runsById.get(currentRunId)?.parent_run_id ?? null;
  }

  return false;
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
    created_at: textDate(row.createdAt),
  };
}

function toHistoryEvent(row: RunHistoryEventRow): ThreadHistoryEvent {
  const dataTruncated = row.data === RUN_EVENT_TRUNCATED_DATA ||
    row.data.length > MAX_CHAT_HISTORY_EVENT_DATA_CHARACTERS;
  return {
    id: row.id,
    run_id: row.runId,
    type: row.type,
    data: dataTruncated ? CHAT_HISTORY_TRUNCATED_EVENT_DATA : row.data,
    data_truncated: dataTruncated,
    created_at: textDate(row.createdAt),
  };
}

function runHasAncestorInThread(
  run: ThreadHistoryRunSummary,
  threadId: string,
  runsById: Map<string, { parent_run_id: string | null; thread_id: string }>,
): boolean {
  let currentRunId = run.parent_run_id;
  const visited = new Set<string>();

  while (currentRunId) {
    if (visited.has(currentRunId)) {
      return false;
    }
    visited.add(currentRunId);
    const current = runsById.get(currentRunId);
    if (!current) {
      return false;
    }
    if (current.thread_id === threadId) {
      return true;
    }
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

function toChildRunSummary(
  run: ThreadHistoryRunSummary,
): ThreadHistoryChildRunSummary {
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
  runIdsNewestFirst: Array<{
    id: string;
    status: string;
  }>,
): ThreadHistoryFocus {
  const latestRunId = runIdsNewestFirst[0]?.id ?? null;
  const latestActiveRunId = runIdsNewestFirst.find((run) => (
    run.status === "pending" || run.status === "queued" ||
    run.status === "running"
  ))?.id ?? null;
  const latestFailedRunId =
    runIdsNewestFirst.find((run) => run.status === "failed")?.id ?? null;
  const latestCompletedRunId =
    runIdsNewestFirst.find((run) => run.status === "completed")?.id ?? null;

  return {
    latest_run_id: latestRunId,
    latest_active_run_id: latestActiveRunId,
    latest_failed_run_id: latestFailedRunId,
    latest_completed_run_id: latestCompletedRunId,
    resume_run_id: latestActiveRunId ?? latestFailedRunId ?? latestRunId,
  };
}

async function getThreadHistoryTaskContext(
  env: Env,
  threadId: string,
  spaceId: string,
): Promise<ThreadHistoryTaskContext | null> {
  const db = threadHistoryDeps.getDb(env.DB);
  const taskRows: HistoryTaskRow[] = await db.select({
    id: agentTasks.id,
    spaceId: agentTasks.accountId,
    threadId: agentTasks.threadId,
    title: agentTasks.title,
    status: agentTasks.status,
    priority: agentTasks.priority,
    updatedAt: agentTasks.updatedAt,
  }).from(agentTasks).where(and(
    eq(agentTasks.threadId, threadId),
    eq(agentTasks.accountId, spaceId),
  )).orderBy(desc(agentTasks.updatedAt)).limit(5).all();

  if (taskRows.length === 0) {
    return null;
  }

  const preferred =
    taskRows.find((row) =>
      row.status !== "completed" && row.status !== "cancelled"
    ) ?? taskRows[0];
  if (
    !isAgentTaskStatus(preferred.status) ||
    !isAgentTaskPriority(preferred.priority)
  ) {
    return null;
  }
  return {
    id: preferred.id,
    space_id: preferred.spaceId,
    thread_id: preferred.threadId ?? threadId,
    title: preferred.title,
    status: preferred.status,
    priority: preferred.priority,
  };
}

export async function getThreadHistory(
  env: Env,
  threadId: string,
  options: {
    limit: number;
    offset: number;
    spaceId: string;
    includeMessages?: boolean;
    rootRunId?: string | null;
    latest?: boolean;
  },
): Promise<{
  messages: Awaited<ReturnType<typeof listThreadMessages>>["messages"];
  total: number;
  limit: number;
  offset: number;
  runs: ThreadHistoryRunNode[];
  focus: ThreadHistoryFocus;
  activeRun: ThreadHistoryRunNode["run"] | null;
  taskContext: ThreadHistoryTaskContext | null;
  truncation: ThreadHistoryTruncation;
}> {
  const includeMessages = options.includeMessages !== false;
  const rootRunId = options.rootRunId?.trim() || null;
  const messagePage = includeMessages
    ? await threadHistoryDeps.listThreadMessages(
      env,
      env.DB,
      threadId,
      options.limit,
      options.offset,
      { latest: options.latest },
    )
    : {
      messages: [],
      total: 0,
      offset: options.offset,
      messageDataTruncated: false,
    };
  const db = threadHistoryDeps.getDb(env.DB);

  const rawThreadRunRows = await db.select(HISTORY_RUN_SELECTION).from(runs)
    .where(and(
      eq(runs.threadId, threadId),
      eq(runs.accountId, options.spaceId),
    ))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(MAX_THREAD_HISTORY_RUNS + 1)
    .all();
  const threadRunsTruncated = rawThreadRunRows.length > MAX_THREAD_HISTORY_RUNS;
  const threadRunRows = rawThreadRunRows.slice(0, MAX_THREAD_HISTORY_RUNS);
  const threadRunsNewestFirst = threadRunRows.map((row) =>
    toHistoryRunSnapshot(row)
  );
  const effectiveRootThreadId = threadRunsNewestFirst[0]?.run.root_thread_id ??
    threadId;

  const rawRootRunRows = await db.select(HISTORY_RUN_SELECTION).from(runs)
    .where(and(
      eq(runs.rootThreadId, effectiveRootThreadId),
      eq(runs.accountId, options.spaceId),
    ))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(MAX_THREAD_HISTORY_RUNS + 1)
    .all();
  const rootRunsTruncated = rawRootRunRows.length > MAX_THREAD_HISTORY_RUNS;
  const allRootRunRows = rawRootRunRows.slice(0, MAX_THREAD_HISTORY_RUNS);
  const allRunsNewestFirst = allRootRunRows.map((row) =>
    toHistoryRunSnapshot(row)
  );

  const runsById = new Map(
    allRunsNewestFirst.map((candidate) => [candidate.id, {
      parent_run_id: candidate.run.parent_run_id,
      thread_id: candidate.run.thread_id,
    }]),
  );
  const defaultScopedRootRunId = rootRunId ||
    (threadId !== effectiveRootThreadId
      ? findThreadAnchorRunId(threadId, allRunsNewestFirst, runsById)
      : null);
  const runsNewestFirst = defaultScopedRootRunId
    ? allRunsNewestFirst.filter((row) =>
      isRunInRootTree(row.id, defaultScopedRootRunId, runsById)
    )
    : allRunsNewestFirst;

  const runIds = runsNewestFirst.map((row) => row.id);
  const focus = buildThreadHistoryFocus(runsNewestFirst);

  // D1 caps bound params at 100/query and drizzle does not chunk inArray, so the
  // runId set (one per turn + per delegated child run, unbounded in a long-lived
  // tree) must be split into ≤90-id batches or a normal history read 500s. Each
  // runId falls entirely within one batch, so per-run event/artifact ordering is
  // preserved when the batches are concatenated and grouped by run_id below.
  const loadArtifactRows = async (): Promise<{
    rows: RunHistoryArtifactRow[];
    truncated: boolean;
  }> => {
    const rows: RunHistoryArtifactRow[] = [];
    for (const chunk of chunkForInClause(runIds)) {
      const remaining = MAX_CHAT_HISTORY_ARTIFACTS + 1 - rows.length;
      if (remaining <= 0) {
        return {
          rows: rows.slice(0, MAX_CHAT_HISTORY_ARTIFACTS),
          truncated: true,
        };
      }
      const batch = await db.select({
          id: artifacts.id,
          runId: artifacts.runId,
          type: artifacts.type,
          title: artifacts.title,
          fileId: artifacts.fileId,
          createdAt: artifacts.createdAt,
        }).from(artifacts).where(inArray(artifacts.runId, chunk)).orderBy(
          desc(artifacts.createdAt),
          desc(artifacts.id),
        ).limit(remaining).all();
      rows.push(...batch);
      if (rows.length > MAX_CHAT_HISTORY_ARTIFACTS) {
        return {
          rows: rows.slice(0, MAX_CHAT_HISTORY_ARTIFACTS),
          truncated: true,
        };
      }
    }
    return { rows, truncated: false };
  };

  const loadEvents = async (): Promise<{
    events: ThreadHistoryEvent[];
    truncated: boolean;
    dataTruncated: boolean;
  }> => {
    const events: ThreadHistoryEvent[] = [];
    let eventCharacters = 0;
    let dataTruncated = false;

    for (const chunk of chunkForInClause(runIds)) {
      let offset = 0;
      if (events.length === MAX_CHAT_HISTORY_EVENTS) {
        const overflow = await db.select({ id: runEvents.id })
          .from(runEvents)
          .where(inArray(runEvents.runId, chunk))
          .limit(1)
          .all();
        if (overflow.length > 0) {
          return { events, truncated: true, dataTruncated };
        }
        continue;
      }
      while (events.length < MAX_CHAT_HISTORY_EVENTS) {
        const remaining = MAX_CHAT_HISTORY_EVENTS + 1 - events.length;
        const pageLimit = Math.min(EVENT_QUERY_PAGE_ROWS, remaining);
        const batch: RunHistoryEventRow[] = await db.select({
          id: runEvents.id,
          runId: runEvents.runId,
          type: runEvents.type,
          data: sql<string>`substr(${runEvents.data}, 1, ${
            MAX_CHAT_HISTORY_EVENT_DATA_CHARACTERS + 1
          })`,
          createdAt: runEvents.createdAt,
        }).from(runEvents).where(inArray(runEvents.runId, chunk)).orderBy(
          desc(runEvents.createdAt),
          desc(runEvents.id),
        ).limit(pageLimit).offset(offset).all();
        if (batch.length === 0) break;

        for (const row of batch) {
          if (events.length === MAX_CHAT_HISTORY_EVENTS) {
            return { events, truncated: true, dataTruncated };
          }
          const event = toHistoryEvent(row);
          const nextCharacters = eventCharacters + event.type.length +
            event.data.length;
          if (nextCharacters > MAX_CHAT_HISTORY_TELEMETRY_CHARACTERS) {
            return { events, truncated: true, dataTruncated };
          }
          dataTruncated ||= event.data_truncated;
          eventCharacters = nextCharacters;
          events.push(event);
        }

        offset += batch.length;
        if (batch.length < pageLimit) break;
        if (events.length === MAX_CHAT_HISTORY_EVENTS) {
          const overflow = await db.select({ id: runEvents.id })
            .from(runEvents)
            .where(inArray(runEvents.runId, chunk))
            .limit(1)
            .offset(offset)
            .all();
          if (overflow.length > 0) {
            return { events, truncated: true, dataTruncated };
          }
          break;
        }
      }
    }
    return { events, truncated: false, dataTruncated };
  };

  const [artifactResult, eventResult, taskContext] = await Promise.all([
      loadArtifactRows(),
      loadEvents(),
      getThreadHistoryTaskContext(env, threadId, options.spaceId),
    ]);

  const artifactsByRunId = new Map<string, ThreadHistoryArtifactSummary[]>();
  for (const row of artifactResult.rows) {
    const artifact = toHistoryArtifact(row);
    const list = artifactsByRunId.get(artifact.run_id) ?? [];
    list.push(artifact);
    artifactsByRunId.set(artifact.run_id, list);
  }
  for (const list of artifactsByRunId.values()) {
    list.sort((left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id)
    );
  }

  const eventsByRunId = new Map<string, ThreadHistoryEvent[]>();
  for (const event of eventResult.events) {
    const list = eventsByRunId.get(event.run_id) ?? [];
    list.push(event);
    eventsByRunId.set(event.run_id, list);
  }
  for (const list of eventsByRunId.values()) {
    list.sort((left, right) => left.id - right.id);
  }

  const childRunsByParentId = new Map<string, ThreadHistoryChildRunSummary[]>();
  const filteredRunsById = new Map(
    runsNewestFirst.map((candidate) => [candidate.id, candidate.run]),
  );
  for (const { run } of runsNewestFirst) {
    if (!run.parent_run_id) {
      continue;
    }
    const parent = filteredRunsById.get(run.parent_run_id);
    if (!parent) {
      continue;
    }
    if (run.thread_id === parent.thread_id && !run.child_thread_id) {
      continue;
    }
    const list = childRunsByParentId.get(parent.id) ?? [];
    list.push(toChildRunSummary(run));
    childRunsByParentId.set(parent.id, list);
  }

  const runNodes: ThreadHistoryRunNode[] = runsNewestFirst
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
            .filter((value): value is string => !!value),
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

  const activeRun = runsNewestFirst.find((row) => (
    row.run.status === "pending" || row.run.status === "queued" ||
    row.run.status === "running"
  ))?.run ?? null;
  const truncation: ThreadHistoryTruncation = {
    message_data: messagePage.messageDataTruncated,
    runs: threadRunsTruncated || rootRunsTruncated,
    artifacts: artifactResult.truncated,
    events: eventResult.truncated,
    event_data: eventResult.dataTruncated,
  };

  return {
    messages: messagePage.messages,
    total: messagePage.total,
    limit: options.limit,
    offset: messagePage.offset,
    runs: runNodes,
    focus,
    activeRun,
    taskContext,
    truncation,
  };
}
