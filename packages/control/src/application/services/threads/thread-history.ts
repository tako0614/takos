import { getDb, sessions, runs, artifacts, runEvents, agentTasks } from '../../../infra/db';
import { eq, desc, asc, inArray } from 'drizzle-orm';
import type {
  AgentTask,
  ArtifactType,
  Env,
  Run,
  RunStatus,
  ThreadHistoryChildRunSummary,
  ThreadHistoryArtifactSummary,
  ThreadHistoryEvent,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryTaskContext,
} from '../../../shared/types';
import type { SelectOf } from '../../../shared/types/drizzle-utils';
import { isValidOpaqueId } from '../../../shared/utils/db-guards';
import { toIsoString } from '../../../shared/utils';
import { listThreadMessages } from './thread-service';
import { logError } from '../../../shared/utils/logger';

type PendingSessionDiffSummary = {
  sessionId: string;
  sessionStatus: string;
  git_mode: boolean;
} | null;

type HistoryTaskRow = {
  id: string;
  title: string;
  status: AgentTask['status'];
  priority: AgentTask['priority'];
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

type HistoryRunSnapshot = {
  id: string;
  status: string;
  run: Run;
};

function toHistoryRunSnapshot(row: SelectOf<typeof runs>): HistoryRunSnapshot {
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
      status: row.status as RunStatus,
      input: row.input,
      output: row.output ?? null,
      error: row.error ?? null,
      usage: row.usage,
      worker_id: row.serviceId ?? null,
      worker_heartbeat: row.serviceHeartbeat ? toIsoString(row.serviceHeartbeat) : null,
      started_at: row.startedAt ? toIsoString(row.startedAt) : null,
      completed_at: row.completedAt ? toIsoString(row.completedAt) : null,
      created_at: toIsoString(row.createdAt),
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

function toHistoryArtifact(row: RunHistoryArtifactRow): ThreadHistoryArtifactSummary {
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

function runHasAncestorInThread(
  run: Run,
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

function buildThreadHistoryFocus(runIdsNewestFirst: Array<{
  id: string;
  status: string;
}>): ThreadHistoryFocus {
  const latestRunId = runIdsNewestFirst[0]?.id ?? null;
  const latestActiveRunId = runIdsNewestFirst.find((run) => (
    run.status === 'pending' || run.status === 'queued' || run.status === 'running'
  ))?.id ?? null;
  const latestFailedRunId = runIdsNewestFirst.find((run) => run.status === 'failed')?.id ?? null;
  const latestCompletedRunId = runIdsNewestFirst.find((run) => run.status === 'completed')?.id ?? null;

  return {
    latest_run_id: latestRunId,
    latest_active_run_id: latestActiveRunId,
    latest_failed_run_id: latestFailedRunId,
    latest_completed_run_id: latestCompletedRunId,
    resume_run_id: latestActiveRunId ?? latestFailedRunId ?? latestRunId,
  };
}

async function getPendingSessionDiff(
  env: Env,
  completedRunSessionIdsNewestFirst: string[],
): Promise<PendingSessionDiffSummary> {
  for (const sessionId of completedRunSessionIdsNewestFirst) {
    if (!isValidOpaqueId(sessionId)) {
      continue;
    }

    try {
      const db = getDb(env.DB);
      const session = await db.select({ id: sessions.id, status: sessions.status, repoId: sessions.repoId }).from(sessions).where(eq(sessions.id, sessionId)).get();

      if (session && session.status !== 'discarded') {
        return {
          sessionId: session.id,
          sessionStatus: session.status,
          git_mode: !!session.repoId,
        };
      }
    } catch (err) {
      logError('Failed to get session info for thread history', err, { module: 'services/threads/threads/thread-history', extra: ['session_id:', sessionId] });
    }
  }

  return null;
}

async function getThreadHistoryTaskContext(env: Env, threadId: string): Promise<ThreadHistoryTaskContext | null> {
  const db = getDb(env.DB);
  const taskRows = await db.select({
    id: agentTasks.id,
    title: agentTasks.title,
    status: agentTasks.status,
    priority: agentTasks.priority,
    updatedAt: agentTasks.updatedAt,
  }).from(agentTasks).where(eq(agentTasks.threadId, threadId)).orderBy(desc(agentTasks.updatedAt)).limit(5).all() as unknown as HistoryTaskRow[];

  if (taskRows.length === 0) {
    return null;
  }

  const preferred = taskRows.find((row) => row.status !== 'completed' && row.status !== 'cancelled') ?? taskRows[0];
  return {
    id: preferred.id,
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
    includeMessages?: boolean;
    rootRunId?: string | null;
  },
): Promise<{
  messages: Awaited<ReturnType<typeof listThreadMessages>>['messages'];
  total: number;
  limit: number;
  offset: number;
  runs: ThreadHistoryRunNode[];
  focus: ThreadHistoryFocus;
  activeRun: ThreadHistoryRunNode['run'] | null;
  pendingSessionDiff: PendingSessionDiffSummary;
  taskContext: ThreadHistoryTaskContext | null;
}> {
  const includeMessages = options.includeMessages !== false;
  const rootRunId = options.rootRunId?.trim() || null;
  const { messages, total } = includeMessages
    ? await listThreadMessages(env, env.DB, threadId, options.limit, options.offset)
    : { messages: [], total: 0 };
  const db = getDb(env.DB);

  const threadRunRows = await db.select().from(runs)
    .where(eq(runs.threadId, threadId))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .all();
  const threadRunsNewestFirst = threadRunRows.map((row) => toHistoryRunSnapshot(row));
  const effectiveRootThreadId = threadRunsNewestFirst[0]?.run.root_thread_id ?? threadId;

  const allRootRunRows = await db.select().from(runs)
    .where(eq(runs.rootThreadId, effectiveRootThreadId))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .all();
  const allRunsNewestFirst = allRootRunRows.map((row) => toHistoryRunSnapshot(row));

  const runsById = new Map(allRunsNewestFirst.map((candidate) => [candidate.id, {
    parent_run_id: candidate.run.parent_run_id,
    thread_id: candidate.run.thread_id,
  }]));
  const defaultScopedRootRunId = rootRunId
    || (threadId !== effectiveRootThreadId
      ? findThreadAnchorRunId(threadId, allRunsNewestFirst, runsById)
      : null);
  const runsNewestFirst = defaultScopedRootRunId
    ? allRunsNewestFirst.filter((row) => isRunInRootTree(row.id, defaultScopedRootRunId, runsById))
    : allRunsNewestFirst;

  const runIds = runsNewestFirst.map((row) => row.id);
  const focus = buildThreadHistoryFocus(runsNewestFirst);

  const [artifactRows, eventRows, taskContext, pendingSessionDiff] = await Promise.all([
    runIds.length === 0
      ? Promise.resolve([] as RunHistoryArtifactRow[])
      : db.select({
        id: artifacts.id,
        runId: artifacts.runId,
        type: artifacts.type,
        title: artifacts.title,
        fileId: artifacts.fileId,
        createdAt: artifacts.createdAt,
      }).from(artifacts).where(inArray(artifacts.runId, runIds)).orderBy(asc(artifacts.createdAt), asc(artifacts.id)).all() as unknown as Promise<RunHistoryArtifactRow[]>,
    runIds.length === 0
      ? Promise.resolve([] as RunHistoryEventRow[])
      : db.select({
        id: runEvents.id,
        runId: runEvents.runId,
        type: runEvents.type,
        data: runEvents.data,
        createdAt: runEvents.createdAt,
      }).from(runEvents).where(inArray(runEvents.runId, runIds)).orderBy(asc(runEvents.createdAt), asc(runEvents.id)).all() as unknown as Promise<RunHistoryEventRow[]>,
    getThreadHistoryTaskContext(env, threadId),
    getPendingSessionDiff(
      env,
      runsNewestFirst
        .filter((row) => row.run.status === 'completed' && row.run.session_id)
        .map((row) => row.run.session_id!)
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

  const childRunsByParentId = new Map<string, ThreadHistoryChildRunSummary[]>();
  const filteredRunsById = new Map(runsNewestFirst.map((candidate) => [candidate.id, candidate.run]));
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
      const latestEventAt = runEvents[runEvents.length - 1]?.created_at
        ?? run.completed_at
        ?? run.started_at
        ?? run.created_at;
      const childRuns = childRunsByParentId.get(run.id) ?? [];
      const uniqueChildThreadIds = Array.from(new Set(
        childRuns
          .map((child) => child.child_thread_id)
          .filter((value): value is string => !!value),
      ));

      return {
        run,
        artifact_count: runArtifacts.length,
        latest_event_at: latestEventAt,
        artifacts: runArtifacts,
        events: runEvents,
        child_thread_id: uniqueChildThreadIds.length === 1 ? uniqueChildThreadIds[0] : null,
        child_run_count: childRuns.length,
        child_runs: childRuns,
      };
    });

  const activeRun = runsNewestFirst.find((row) => (
    row.run.status === 'pending' || row.run.status === 'queued' || row.run.status === 'running'
  ))?.run ?? null;

  return {
    messages,
    total,
    limit: options.limit,
    offset: options.offset,
    runs: runNodes,
    focus,
    activeRun,
    pendingSessionDiff,
    taskContext,
  };
}
