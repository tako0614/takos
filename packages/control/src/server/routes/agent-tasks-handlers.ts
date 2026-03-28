import type { Env, AgentTask, AgentTaskBase, AgentTaskPriority, AgentTaskStatus, RunStatus } from '../../shared/types';
import type { SelectOf } from '../../shared/types/drizzle-utils';
import { toIsoString } from '../../shared/utils';
import { normalizeModelId } from '../../application/services/agent';
import { getDb } from '../../infra/db';
import { agentTasks, threads, runs, artifacts } from '../../infra/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VALID_STATUSES = ['planned', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
export const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export const DEFAULT_STATUS: AgentTaskStatus = 'planned';
export const DEFAULT_PRIORITY: AgentTaskPriority = 'medium';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentTaskRow = SelectOf<typeof agentTasks>;

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/** Convert DB camelCase result to snake_case API shape (base fields only) */
export function toApiTask(row: AgentTaskRow): AgentTaskBase {
  return {
    id: row.id,
    space_id: row.accountId,
    created_by: row.createdByAccountId ?? null,
    thread_id: row.threadId ?? null,
    last_run_id: row.lastRunId ?? null,
    title: row.title,
    description: row.description ?? null,
    status: row.status as AgentTaskStatus,
    priority: row.priority as AgentTaskPriority,
    agent_type: row.agentType,
    model: normalizeModelId(row.model) ?? null,
    plan: row.plan ?? null,
    due_at: toIsoString(row.dueAt),
    started_at: toIsoString(row.startedAt),
    completed_at: toIsoString(row.completedAt),
    created_at: toIsoString(row.createdAt) || '',
    updated_at: toIsoString(row.updatedAt) || '',
  };
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

export async function fetchTask(d1: Env['DB'], taskId: string): Promise<AgentTaskBase | null> {
  const db = getDb(d1);
  const result = await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).get();
  return result ? toApiTask(result) : null;
}

// ---------------------------------------------------------------------------
// Enrichment logic
// ---------------------------------------------------------------------------

function buildThreadRunFocus(runList: Array<{
  id: string;
  status: RunStatus;
}>): {
  latestRunId: string | null;
  resumeRunId: string | null;
  resumeReason: 'active' | 'failed' | 'latest' | 'thread';
} {
  const latestRunId = runList[0]?.id ?? null;
  const latestActiveRunId = runList.find((run) => (
    run.status === 'pending' || run.status === 'queued' || run.status === 'running'
  ))?.id ?? null;
  const latestFailedRunId = runList.find((run) => run.status === 'failed')?.id ?? null;
  const resumeRunId = latestActiveRunId ?? latestFailedRunId ?? latestRunId;

  return {
    latestRunId,
    resumeRunId,
    resumeReason: latestActiveRunId
      ? 'active'
      : latestFailedRunId
        ? 'failed'
        : latestRunId
          ? 'latest'
          : 'thread',
  };
}

export async function enrichTasks(env: Env, tasks: AgentTaskBase[]): Promise<AgentTask[]> {
  if (tasks.length === 0) {
    return tasks.map((task) => ({
      ...task,
      thread_title: null,
      latest_run: null,
      resume_target: task.thread_id ? {
        thread_id: task.thread_id,
        run_id: task.last_run_id,
        reason: task.last_run_id ? 'latest' as const : 'thread' as const,
      } : null,
    }));
  }

  const db = getDb(env.DB);
  const threadIds = Array.from(new Set(tasks.map((task) => task.thread_id).filter((value): value is string => !!value)));

  if (threadIds.length === 0) {
    return tasks.map((task) => ({
      ...task,
      thread_title: null,
      latest_run: null,
      resume_target: null,
    }));
  }

  const [threadRows, runRows] = await Promise.all([
    db.select({
      id: threads.id,
      title: threads.title,
    }).from(threads).where(inArray(threads.id, threadIds)).all(),
    db.select({
      id: runs.id,
      threadId: runs.threadId,
      rootThreadId: runs.rootThreadId,
      status: runs.status,
      agentType: runs.agentType,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
      createdAt: runs.createdAt,
      error: runs.error,
    }).from(runs).where(inArray(runs.threadId, threadIds)).orderBy(desc(runs.createdAt), desc(runs.id)).all(),
  ]);

  const threadTitleById = new Map(threadRows.map((row) => [row.id, row.title]));
  const runsByRootThreadId = new Map<string, typeof runRows>();
  const runById = new Map<string, typeof runRows[number]>();

  for (const row of runRows) {
    runById.set(row.id, row);
    const groupingThreadId = row.rootThreadId ?? row.threadId;
    const list = runsByRootThreadId.get(groupingThreadId) ?? [];
    list.push(row);
    runsByRootThreadId.set(groupingThreadId, list);
  }

  const summaryRunIds = new Set<string>();
  const focusByThreadId = new Map<string, ReturnType<typeof buildThreadRunFocus>>();

  for (const [threadId, threadRuns] of runsByRootThreadId.entries()) {
    const focus = buildThreadRunFocus(threadRuns.map((run) => ({
      id: run.id,
      status: run.status as RunStatus,
    })));
    focusByThreadId.set(threadId, focus);
    if (focus.latestRunId) {
      summaryRunIds.add(focus.latestRunId);
    }
  }

  const artifactRows = summaryRunIds.size === 0
    ? []
    : await db.select({ runId: artifacts.runId }).from(artifacts).where(inArray(artifacts.runId, Array.from(summaryRunIds))).all();
  const artifactCountByRunId = new Map<string, number>();
  for (const row of artifactRows) {
    artifactCountByRunId.set(row.runId, (artifactCountByRunId.get(row.runId) ?? 0) + 1);
  }

  return tasks.map((task): AgentTask => {
    if (!task.thread_id) {
      return {
        ...task,
        thread_title: null,
        latest_run: null,
        resume_target: null,
      };
    }

    const focus = focusByThreadId.get(task.thread_id);
    const latestRunId = focus?.latestRunId ?? task.last_run_id;
    const latestRun = latestRunId ? runById.get(latestRunId) : null;

    return {
      ...task,
      thread_title: threadTitleById.get(task.thread_id) ?? null,
      latest_run: latestRun ? {
        run_id: latestRun.id,
        status: latestRun.status as RunStatus,
        agent_type: latestRun.agentType,
        started_at: toIsoString(latestRun.startedAt),
        completed_at: toIsoString(latestRun.completedAt),
        created_at: toIsoString(latestRun.createdAt) || '',
        error: latestRun.error ?? null,
        artifact_count: artifactCountByRunId.get(latestRun.id) ?? 0,
      } : null,
      resume_target: {
        thread_id: task.thread_id,
        run_id: focus?.resumeRunId ?? null,
        reason: focus?.resumeReason ?? 'thread',
      },
    };
  });
}

export async function enrichTask(env: Env, task: AgentTaskBase): Promise<AgentTask> {
  const [enriched] = await enrichTasks(env, [task]);
  return enriched ?? { ...task, thread_title: null, latest_run: null, resume_target: null };
}
