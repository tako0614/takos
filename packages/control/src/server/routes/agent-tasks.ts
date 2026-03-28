import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, AgentTask, AgentTaskBase, AgentTaskPriority, AgentTaskStatus, RunStatus } from '../../shared/types';
import { parseLimit, parseOffset, type BaseVariables } from './shared/route-auth';
import { BadRequestError, NotFoundError, InternalError } from '@takoserver/common/errors';
import { zValidator } from './zod-validator';
import { checkSpaceAccess, generateId, now, toIsoString } from '../../shared/utils';
import { createThread } from '../../application/services/threads/thread-service';
import { analyzeTask } from '../../application/services/agent/workflow';
import { getProviderFromModel, DEFAULT_MODEL_ID, normalizeModelId, filterAgentAllowedToolNames } from '../../application/services/agent';
import { BUILTIN_TOOLS } from '../../application/tools/builtin';
import { getDb } from '../../infra/db';
import { agentTasks, threads, runs, artifacts } from '../../infra/db/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { logError } from '../../shared/utils/logger';

const VALID_STATUSES = ['planned', 'in_progress', 'blocked', 'completed', 'cancelled'] as const;
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

const DEFAULT_STATUS: AgentTaskStatus = 'planned';
const DEFAULT_PRIORITY: AgentTaskPriority = 'medium';

const BUILTIN_TOOL_NAMES = filterAgentAllowedToolNames(BUILTIN_TOOLS.map((tool) => tool.name));

type AgentTaskRow = typeof agentTasks.$inferSelect;

/** Convert DB camelCase result to snake_case API shape (base fields only) */
function toApiTask(row: AgentTaskRow): AgentTaskBase {
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

async function fetchTask(d1: Env['DB'], taskId: string): Promise<AgentTaskBase | null> {
  const db = getDb(d1);
  const result = await db.select().from(agentTasks).where(eq(agentTasks.id, taskId)).get();
  return result ? toApiTask(result) : null;
}

function buildThreadRunFocus(runs: Array<{
  id: string;
  status: RunStatus;
}>): {
  latestRunId: string | null;
  resumeRunId: string | null;
  resumeReason: 'active' | 'failed' | 'latest' | 'thread';
} {
  const latestRunId = runs[0]?.id ?? null;
  const latestActiveRunId = runs.find((run) => (
    run.status === 'pending' || run.status === 'queued' || run.status === 'running'
  ))?.id ?? null;
  const latestFailedRunId = runs.find((run) => run.status === 'failed')?.id ?? null;
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

async function enrichTasks(env: Env, tasks: AgentTaskBase[]): Promise<AgentTask[]> {
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

async function enrichTask(env: Env, task: AgentTaskBase): Promise<AgentTask> {
  const [enriched] = await enrichTasks(env, [task]);
  return enriched ?? { ...task, thread_title: null, latest_run: null, resume_target: null };
}

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()

  .get('/spaces/:spaceId/agent-tasks', async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const status = c.req.query('status') as AgentTaskStatus | undefined;
    const limit = parseLimit(c.req.query('limit'), 50, 200);
    const offset = parseOffset(c.req.query('offset'), 0);

    const access = await checkSpaceAccess(c.env.DB, spaceId, user.id);
    if (!access) {
      throw new NotFoundError('Workspace');
    }

    if (status && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      throw new BadRequestError('Invalid status');
    }

    const db = getDb(c.env.DB);
    const conditions = [eq(agentTasks.accountId, spaceId)];
    if (status) {
      conditions.push(eq(agentTasks.status, status));
    }
    const results = await db.select().from(agentTasks)
      .where(and(...conditions))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(limit)
      .offset(offset)
      .all();

    const tasks = await enrichTasks(c.env, results.map(toApiTask));

    return c.json({ tasks });
  })

  .post('/spaces/:spaceId/agent-tasks',
    zValidator('json', z.object({
      title: z.string(),
      description: z.string().optional(),
      status: z.enum(VALID_STATUSES).optional(),
      priority: z.enum(VALID_PRIORITIES).optional(),
      agent_type: z.string().optional(),
      model: z.string().optional(),
      plan: z.union([z.record(z.unknown()), z.string()]).optional(),
      due_at: z.string().optional(),
      thread_id: z.string().optional(),
      create_thread: z.boolean().optional(),
    })),
    async (c) => {
    const user = c.get('user');
    const spaceId = c.req.param('spaceId');
    const body = c.req.valid('json');

    const access = await checkSpaceAccess(c.env.DB, spaceId, user.id, ['owner', 'admin', 'editor']);
    if (!access) {
      throw new NotFoundError('Workspace');
    }

    if (!body.title?.trim()) {
      throw new BadRequestError('title is required');
    }

    const status = body.status || DEFAULT_STATUS;
    const priority = body.priority || DEFAULT_PRIORITY;

    let threadId = body.thread_id ?? null;
    if (!threadId && body.create_thread !== false) {
      const thread = await createThread(c.env.DB, spaceId, { title: body.title.trim() });
      threadId = thread?.id || null;
    }

    const planValue = body.plan
      ? (typeof body.plan === 'string' ? body.plan : JSON.stringify(body.plan))
      : null;

    const normalizedModel = normalizeModelId(body.model);
    const taskId = generateId();
    const timestamp = now();

    const db = getDb(c.env.DB);
    const created = await db.insert(agentTasks).values({
      id: taskId,
      accountId: spaceId,
      createdByAccountId: user.id,
      threadId,
      title: body.title.trim(),
      description: body.description?.trim() || null,
      status,
      priority,
      agentType: body.agent_type || 'default',
      model: normalizedModel,
      plan: planValue,
      dueAt: body.due_at || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).returning().get();

    const task = await enrichTask(c.env, toApiTask(created));

    return c.json({ task }, 201);
  })

  .get('/agent-tasks/:id', async (c) => {
    const user = c.get('user');
    const taskId = c.req.param('id');

    const task = await fetchTask(c.env.DB, taskId);
    if (!task) {
      throw new NotFoundError('Task');
    }

    const access = await checkSpaceAccess(c.env.DB, task.space_id, user.id);
    if (!access) {
      throw new NotFoundError('Task');
    }

    return c.json({ task: await enrichTask(c.env, task) });
  })

  .patch('/agent-tasks/:id',
    zValidator('json', z.object({
      title: z.string().optional(),
      description: z.string().nullish(),
      status: z.enum(VALID_STATUSES).optional(),
      priority: z.enum(VALID_PRIORITIES).optional(),
      agent_type: z.string().optional(),
      model: z.string().nullish(),
      plan: z.union([z.record(z.unknown()), z.string()]).nullish(),
      due_at: z.string().nullish(),
      thread_id: z.string().nullish(),
      last_run_id: z.string().nullish(),
      started_at: z.string().nullish(),
      completed_at: z.string().nullish(),
    })),
    async (c) => {
    const user = c.get('user');
    const taskId = c.req.param('id');
    const body = c.req.valid('json');

    const task = await fetchTask(c.env.DB, taskId);
    if (!task) {
      throw new NotFoundError('Task');
    }

    const access = await checkSpaceAccess(c.env.DB, task.space_id, user.id, ['owner', 'admin', 'editor']);
    if (!access) {
      throw new NotFoundError('Task');
    }

    const updates: Record<string, unknown> = {};

    if (body.title !== undefined) {
      if (!body.title?.trim()) {
        throw new BadRequestError('title is required');
      }
      updates.title = body.title.trim();
    }

    if (body.description !== undefined) {
      updates.description = body.description?.trim() || null;
    }

    if (body.status !== undefined) {
      updates.status = body.status;
    }

    if (body.priority !== undefined) {
      updates.priority = body.priority;
    }

    if (body.agent_type !== undefined) {
      updates.agentType = body.agent_type || 'default';
    }

    if (body.model !== undefined) {
      updates.model = normalizeModelId(body.model);
    }

    if (body.plan !== undefined) {
      updates.plan = body.plan
        ? (typeof body.plan === 'string' ? body.plan : JSON.stringify(body.plan))
        : null;
    }

    if (body.due_at !== undefined) {
      updates.dueAt = body.due_at || null;
    }

    const db = getDb(c.env.DB);

    if (body.thread_id !== undefined) {
      if (body.thread_id) {
        const thread = await db.select({ id: threads.id }).from(threads).where(
          and(eq(threads.id, body.thread_id), eq(threads.accountId, task.space_id))
        ).get();
        if (!thread) {
          throw new NotFoundError('Thread');
        }
      }
      updates.threadId = body.thread_id || null;
    }

    if (body.last_run_id !== undefined) {
      if (body.last_run_id) {
        const run = await db.select({ id: runs.id }).from(runs).where(
          and(eq(runs.id, body.last_run_id), eq(runs.accountId, task.space_id))
        ).get();
        if (!run) {
          throw new NotFoundError('Run');
        }
      }
      updates.lastRunId = body.last_run_id || null;
    }

    if (body.started_at !== undefined) {
      updates.startedAt = body.started_at || null;
    }

    if (body.completed_at !== undefined) {
      updates.completedAt = body.completed_at || null;
    }

    if (!updates.completedAt && body.status === 'completed') {
      updates.completedAt = now();
    }

    if (!updates.startedAt && body.status === 'in_progress') {
      updates.startedAt = now();
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestError('No valid updates provided');
    }

    updates.updatedAt = now();
    const updated = await db.update(agentTasks).set(updates).where(eq(agentTasks.id, taskId)).returning().get();
    if (!updated) {
      throw new InternalError('Failed to update task');
    }

    return c.json({ task: await enrichTask(c.env, toApiTask(updated)) });
  })

  .delete('/agent-tasks/:id', async (c) => {
    const user = c.get('user');
    const taskId = c.req.param('id');

    const task = await fetchTask(c.env.DB, taskId);
    if (!task) {
      throw new NotFoundError('Task');
    }

    const access = await checkSpaceAccess(c.env.DB, task.space_id, user.id, ['owner', 'admin']);
    if (!access) {
      throw new NotFoundError('Task');
    }

    const db = getDb(c.env.DB);
    await db.delete(agentTasks).where(eq(agentTasks.id, taskId));

    return c.json({ success: true });
  })

  .post('/agent-tasks/:id/plan', async (c) => {
    const user = c.get('user');
    const taskId = c.req.param('id');

    const task = await fetchTask(c.env.DB, taskId);
    if (!task) {
      throw new NotFoundError('Task');
    }

    const access = await checkSpaceAccess(c.env.DB, task.space_id, user.id, ['owner', 'admin', 'editor']);
    if (!access) {
      throw new NotFoundError('Task');
    }

    const model = normalizeModelId(task.model)
      || normalizeModelId(access.space.ai_model)
      || DEFAULT_MODEL_ID;
    const provider = getProviderFromModel(model);

    let apiKey: string | undefined;
    if (provider === 'anthropic') {
      apiKey = c.env.ANTHROPIC_API_KEY;
    } else if (provider === 'google') {
      apiKey = c.env.GOOGLE_API_KEY;
    } else {
      apiKey = c.env.OPENAI_API_KEY;
    }

    if (!apiKey) {
      throw new BadRequestError(`API key for provider "${provider}" is not configured`);
    }

    const taskText = task.description?.trim() || task.title;

    try {
      const plan = await analyzeTask(taskText, {
        spaceId: task.space_id,
        userId: user.id,
        tools: BUILTIN_TOOL_NAMES,
        apiKey,
        model,
      });

      const planJson = JSON.stringify(plan);
      const timestamp = now();

      const db = getDb(c.env.DB);
      const updated = await db.update(agentTasks).set({
        plan: planJson,
        updatedAt: timestamp,
      }).where(eq(agentTasks.id, taskId)).returning().get();
      if (!updated) {
        throw new InternalError('Failed to update task plan');
      }

      return c.json({ task: await enrichTask(c.env, toApiTask(updated)), plan });
    } catch (err) {
      logError('Failed to generate task plan', err, { module: 'routes/agent-tasks' });
      throw new InternalError('Failed to generate task plan');
    }
  });
