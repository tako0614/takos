import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  AgentTaskStatus,
  Env,
  TerminalAgentTaskStatus,
} from "../../../shared/types/index.ts";
import {
  AGENT_TYPES,
  DEFAULT_AGENT_TYPE,
  MAX_AGENT_TASK_DESCRIPTION_CHARACTERS,
  MAX_AGENT_TASK_MODEL_CHARACTERS,
  MAX_AGENT_TASK_PLAN_BYTES,
  MAX_AGENT_TASK_REFERENCE_CHARACTERS,
  MAX_AGENT_TASK_TITLE_CHARACTERS,
} from "../../../shared/types/agent-tasks.ts";
import {
  parseAgentTaskPlan,
  type AgentTaskPlan,
} from "../../../shared/types/agent-task-plan.ts";
import type { BaseVariables } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { InMemoryRateLimiter } from "../../../shared/utils/rate-limiter.ts";
import {
  AppError,
  BadRequestError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import { zValidator } from "../zod-validator.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { checkSpaceAccess } from "../../../application/services/identity/space-access.ts";
import {
  checkThreadAccess,
  createMessage,
  createThread,
} from "../../../application/services/threads/thread-service.ts";
import { createThreadRun } from "../../../application/services/execution/run-creation.ts";
import { analyzeTask } from "../../../application/services/agent/task-analysis.ts";
import { deriveAgentTaskStartOperationIds } from "../../../application/services/agent/task-start-operation.ts";
import {
  DEFAULT_MODEL_ID,
  filterAgentAllowedToolNames,
  getBackendFromModel,
  normalizeModelId,
} from "../../../application/services/agent/index.ts";
import { CUSTOM_TOOLS } from "../../../application/tools/custom/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import { agentTasks, threads } from "../../../infra/db/schema.ts";
import { and, desc, eq } from "drizzle-orm";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import {
  DEFAULT_PRIORITY,
  DEFAULT_STATUS,
  claimAgentTaskStart,
  enrichTask,
  enrichTasks,
  fetchTask,
  toApiTask,
  VALID_PRIORITIES,
  VALID_STATUSES,
} from "./handlers.ts";

const CUSTOM_TOOL_NAMES = filterAgentAllowedToolNames(
  CUSTOM_TOOLS.map((tool) => tool.name),
);

export const AGENT_TASK_CREATE_RATE_LIMIT = 30;
export const AGENT_TASK_PLAN_RATE_LIMIT = 10;

function rateLimitUserId(c: Context): string {
  const user = (c.get as (key: "user") => { id?: string } | undefined)(
    "user",
  );
  return user?.id || "unknown";
}

export const agentTaskCreateLimiter = new InMemoryRateLimiter({
  maxRequests: AGENT_TASK_CREATE_RATE_LIMIT,
  windowMs: 60_000,
  keyGenerator: (c) =>
    `${rateLimitUserId(c)}:${c.req.param("spaceId") || "unknown"}`,
  message: "Too many Agent Task creation attempts.",
});

export const agentTaskPlanLimiter = new InMemoryRateLimiter({
  maxRequests: AGENT_TASK_PLAN_RATE_LIMIT,
  windowMs: 60_000,
  keyGenerator: rateLimitUserId,
  message: "Too many Agent Task planning attempts.",
});

export type AgentTaskRouteStatus = (typeof VALID_STATUSES)[number];

type AgentTaskPlanInput = Record<string, unknown> | string;

function parseAgentTaskPlanValue(
  value: AgentTaskPlanInput,
): AgentTaskPlan | null {
  try {
    return parseAgentTaskPlan(
      typeof value === "string" ? JSON.parse(value) : value,
    );
  } catch {
    return null;
  }
}

function serializeAgentTaskPlanValue(value: AgentTaskPlanInput): string {
  const plan = parseAgentTaskPlanValue(value);
  if (!plan) throw new BadRequestError("Invalid agent task plan");
  return JSON.stringify(plan);
}

export function isBoundedAgentTaskPlan(value: AgentTaskPlanInput): boolean {
  try {
    const source = typeof value === "string" ? value : JSON.stringify(value);
    return new TextEncoder().encode(source).byteLength <=
        MAX_AGENT_TASK_PLAN_BYTES && parseAgentTaskPlanValue(value) !== null;
  } catch {
    return false;
  }
}

const agentTaskPlanSchema = z.union([z.record(z.unknown()), z.string()])
  .refine(isBoundedAgentTaskPlan, {
    message:
      `plan must match the Agent Task plan contract and be at most ${MAX_AGENT_TASK_PLAN_BYTES} bytes`,
  });

const agentTaskDueAtSchema = z.string().datetime({ offset: true });

export const createAgentTaskSchema = z.object({
  title: z.string().max(MAX_AGENT_TASK_TITLE_CHARACTERS),
  description: z.string().max(MAX_AGENT_TASK_DESCRIPTION_CHARACTERS).nullish(),
  status: z.enum(VALID_STATUSES).optional(),
  priority: z.enum(VALID_PRIORITIES).optional(),
  agent_type: z.enum(AGENT_TYPES).optional(),
  model: z.string().max(MAX_AGENT_TASK_MODEL_CHARACTERS).nullish(),
  plan: agentTaskPlanSchema.nullish(),
  due_at: agentTaskDueAtSchema.nullish(),
  thread_id: z.string().min(1).max(MAX_AGENT_TASK_REFERENCE_CHARACTERS)
    .optional(),
  create_thread: z.boolean().optional(),
}).strict();

/**
 * Public task edits own the work-item description and user-selected state.
 * Thread/Run links and lifecycle timestamps are projections written by the
 * start route and execution lifecycle, never caller supplied metadata.
 */
export const patchAgentTaskSchema = z.object({
  title: z.string().max(MAX_AGENT_TASK_TITLE_CHARACTERS).optional(),
  description: z.string().max(MAX_AGENT_TASK_DESCRIPTION_CHARACTERS).nullish(),
  status: z.enum(VALID_STATUSES).optional(),
  priority: z.enum(VALID_PRIORITIES).optional(),
  agent_type: z.enum(AGENT_TYPES).optional(),
  model: z.string().max(MAX_AGENT_TASK_MODEL_CHARACTERS).nullish(),
  plan: agentTaskPlanSchema.nullish(),
  due_at: agentTaskDueAtSchema.nullish(),
}).strict();

export function isTerminalAgentTaskStatus(
  status: AgentTaskRouteStatus | null | undefined,
): status is TerminalAgentTaskStatus {
  return status === "completed" || status === "failed";
}

export function applyAgentTaskStatusTimestamps(
  updates: { startedAt?: string | null; completedAt?: string | null },
  status: AgentTaskRouteStatus | null | undefined,
  now = new Date().toISOString(),
  current: {
    status?: AgentTaskRouteStatus | null;
    startedAt?: string | null;
    completedAt?: string | null;
  } = {},
): void {
  if (!status) return;

  if (isTerminalAgentTaskStatus(status)) {
    updates.completedAt = isTerminalAgentTaskStatus(current.status) &&
        current.completedAt
      ? current.completedAt
      : now;
    return;
  }

  // Reopening or cancelling a previously terminal task must not retain a
  // misleading completion timestamp.
  updates.completedAt = null;
  if (status === "in_progress") {
    updates.startedAt = current.startedAt || now;
  }
}

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  .get("/spaces/:spaceId/agent-tasks", async (c) => {
    const user = c.get("user");
    const spaceId = c.req.param("spaceId");
    const status = c.req.query("status") as AgentTaskStatus | undefined;
    const { limit, offset } = parsePagination(c.req.query(), {
      limit: 50,
      maxLimit: 200,
    });

    const access = await checkSpaceAccess(c.env.DB, spaceId, user.id);
    if (!access) {
      throw new NotFoundError("Workspace");
    }

    if (
      status &&
      !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])
    ) {
      throw new BadRequestError("Invalid status");
    }

    const db = getDb(c.env.DB);
    const conditions = [eq(agentTasks.accountId, spaceId)];
    if (status) {
      conditions.push(eq(agentTasks.status, status));
    }
    const results = await db
      .select()
      .from(agentTasks)
      .where(and(...conditions))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(limit)
      .offset(offset)
      .all();

    const tasks = await enrichTasks(c.env, results.map(toApiTask));

    return c.json({ tasks });
  })
  .post(
    "/spaces/:spaceId/agent-tasks",
    agentTaskCreateLimiter.middleware(),
    zValidator("json", createAgentTaskSchema),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const body = c.req.valid("json");

      const access = await checkSpaceAccess(c.env.DB, spaceId, user.id);
      if (!access) {
        throw new NotFoundError("Workspace");
      }

      if (!body.title?.trim()) {
        throw new BadRequestError("title is required");
      }

      const status = body.status || DEFAULT_STATUS;
      const priority = body.priority || DEFAULT_PRIORITY;
      const timestamps: {
        startedAt?: string | null;
        completedAt?: string | null;
      } = {};
      applyAgentTaskStatusTimestamps(
        timestamps,
        status,
        new Date().toISOString(),
      );

      const db = getDb(c.env.DB);

      let threadId = body.thread_id ?? null;
      if (threadId) {
        const thread = await db
          .select({ id: threads.id })
          .from(threads)
          .where(and(eq(threads.id, threadId), eq(threads.accountId, spaceId)))
          .get();
        if (!thread) {
          throw new NotFoundError("Thread");
        }
      }
      if (!threadId && body.create_thread !== false) {
        const thread = await createThread(c.env.DB, spaceId, {
          title: body.title.trim(),
        });
        threadId = thread?.id || null;
      }

      const planValue = body.plan ? serializeAgentTaskPlanValue(body.plan) : null;

      const normalizedModel = normalizeModelId(body.model);
      const taskId = generateId();
      const timestamp = new Date().toISOString();

      const created = await db
        .insert(agentTasks)
        .values({
          id: taskId,
          accountId: spaceId,
          createdByAccountId: user.id,
          threadId,
          title: body.title.trim(),
          description: body.description?.trim() || null,
          status,
          priority,
          agentType: body.agent_type || DEFAULT_AGENT_TYPE,
          model: normalizedModel,
          plan: planValue,
          dueAt: body.due_at || null,
          startedAt: timestamps.startedAt ?? null,
          completedAt: timestamps.completedAt ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning()
        .get();

      const task = await enrichTask(c.env, toApiTask(created));

      return c.json({ task }, 201);
    },
  )
  .get("/agent-tasks/:id", async (c) => {
    const user = c.get("user");
    const taskId = c.req.param("id");

    const task = await fetchTask(c.env.DB, taskId);
    if (!task) {
      throw new NotFoundError("Task");
    }

    const access = await checkSpaceAccess(c.env.DB, task.space_id, user.id);
    if (!access) {
      throw new NotFoundError("Task");
    }

    return c.json({ task: await enrichTask(c.env, task) });
  })
  .patch(
    "/agent-tasks/:id",
    zValidator("json", patchAgentTaskSchema),
    async (c) => {
      const user = c.get("user");
      const taskId = c.req.param("id");
      const body = c.req.valid("json");

      const task = await fetchTask(c.env.DB, taskId);
      if (!task) {
        throw new NotFoundError("Task");
      }

      const access = await checkSpaceAccess(c.env.DB, task.space_id, user.id);
      if (!access) {
        throw new NotFoundError("Task");
      }

      const updates: Record<string, unknown> & {
        startedAt?: string | null;
        completedAt?: string | null;
      } = {};

      if (body.title !== undefined) {
        if (!body.title?.trim()) {
          throw new BadRequestError("title is required");
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
        updates.agentType = body.agent_type;
      }

      if (body.model !== undefined) {
        updates.model = normalizeModelId(body.model);
      }

      if (body.plan !== undefined) {
        updates.plan = body.plan ? serializeAgentTaskPlanValue(body.plan) : null;
      }

      if (body.due_at !== undefined) {
        updates.dueAt = body.due_at || null;
      }

      applyAgentTaskStatusTimestamps(
        updates,
        body.status,
        new Date().toISOString(),
        {
          status: task.status,
          startedAt: task.started_at,
          completedAt: task.completed_at,
        },
      );

      if (Object.keys(updates).length === 0) {
        throw new BadRequestError("No valid updates provided");
      }

      updates.updatedAt = new Date().toISOString();
      const updated = await getDb(c.env.DB)
        .update(agentTasks)
        .set(updates)
        .where(eq(agentTasks.id, taskId))
        .returning()
        .get();
      if (!updated) {
        throw new InternalError("Failed to update task");
      }

      return c.json({ task: await enrichTask(c.env, toApiTask(updated)) });
    },
  )
  .delete("/agent-tasks/:id", async (c) => {
    const user = c.get("user");
    const taskId = c.req.param("id");

    const task = await fetchTask(c.env.DB, taskId);
    if (!task) {
      throw new NotFoundError("Task");
    }

    const access = await checkSpaceAccess(c.env.DB, task.space_id, user.id);
    if (!access) {
      throw new NotFoundError("Task");
    }

    const db = getDb(c.env.DB);
    await db.delete(agentTasks).where(eq(agentTasks.id, taskId));

    return c.json({ success: true });
  })
  .post(
    "/agent-tasks/:id/start",
    zValidator(
      "json",
      z.object({ locale: z.enum(["ja", "en"]).optional() }).strict(),
    ),
    async (c) => {
      const user = c.get("user");
      const taskId = c.req.param("id");
      const body = c.req.valid("json");
      const task = await fetchTask(c.env.DB, taskId);
      if (!task) throw new NotFoundError("Task");
      if (task.status === "completed" || task.status === "cancelled") {
        throw new BadRequestError("Terminal tasks cannot be started");
      }

      const access = await checkSpaceAccess(c.env.DB, task.space_id, user.id);
      if (!access) throw new NotFoundError("Task");

      const activeStatuses = new Set(["pending", "queued", "running"]);
      const reuseActiveRun = async (
        currentInput?: Awaited<ReturnType<typeof enrichTask>>,
      ) => {
        const current = currentInput ?? await enrichTask(
          c.env,
          (await fetchTask(c.env.DB, taskId)) ?? task,
        );
        const latestRun = current.latest_run;
        if (!latestRun || !activeStatuses.has(latestRun.status)) return null;
        const now = new Date().toISOString();
        await getDb(c.env.DB).update(agentTasks).set({
          status: "in_progress",
          lastRunId: latestRun.run_id,
          startedAt: current.started_at || now,
          completedAt: null,
          updatedAt: now,
        }).where(eq(agentTasks.id, taskId)).run();
        return {
          task_id: taskId,
          thread_id: current.thread_id!,
          run_id: latestRun.run_id,
          reused: true,
        };
      };

      const current = await enrichTask(c.env, task);
      const active = await reuseActiveRun(current);
      if (active) return c.json(active);

      const taskContent = task.description?.trim() || task.title;
      const operationIds = await deriveAgentTaskStartOperationIds({
        taskId,
        previousRunId: current.latest_run?.run_id,
        content: taskContent,
        agentType: task.agent_type || DEFAULT_AGENT_TYPE,
        model: task.model,
        locale: body.locale,
      });

      const now = new Date().toISOString();
      const claimed = await claimAgentTaskStart(c.env.DB, {
        taskId,
        expectedUpdatedAt: task.updated_at,
        startedAt: task.started_at || now,
        updatedAt: now,
      });
      if (!claimed) {
        const racedActive = await reuseActiveRun();
        if (racedActive) return c.json(racedActive);
        throw new ConflictError("Task start is already in progress; retry");
      }

      let createdRunId: string | null = null;
      try {
        let thread = null;
        if (task.thread_id) {
          const threadAccess = await checkThreadAccess(
            c.env.DB,
            task.thread_id,
            user.id,
          );
          if (!threadAccess) throw new NotFoundError("Task thread");
          thread = threadAccess.thread;
        }
        if (!thread) {
          thread = await createThread(c.env.DB, task.space_id, {
            title: task.title,
            locale: body.locale,
            idempotency_key: operationIds.thread,
          });
          if (!thread) throw new InternalError("Failed to create task thread");
          await getDb(c.env.DB).update(agentTasks).set({
            threadId: thread.id,
            updatedAt: new Date().toISOString(),
          }).where(eq(agentTasks.id, taskId)).run();
        }

        const message = await createMessage(c.env, c.env.DB, thread, {
          role: "user",
          content: taskContent,
          metadata: { source: "agent_task", agent_task_id: taskId },
          idempotency_key: operationIds.message,
        });
        if (!message) throw new InternalError("Failed to create task message");

        const runResult = await createThreadRun(c.env, {
          userId: user.id,
          threadId: thread.id,
          agentType: task.agent_type || DEFAULT_AGENT_TYPE,
          input: body.locale ? { locale: body.locale } : undefined,
          model: task.model || undefined,
          idempotencyKey: operationIds.run,
        });
        if (!runResult.ok) {
          throw new AppError(runResult.error, undefined, runResult.status);
        }
        createdRunId = runResult.run.id;

        try {
          await getDb(c.env.DB).update(agentTasks).set({
            status: "in_progress",
            lastRunId: createdRunId,
            startedAt: task.started_at || now,
            completedAt: null,
            updatedAt: new Date().toISOString(),
          }).where(eq(agentTasks.id, taskId)).run();
        } catch (error) {
          // The Run is already queued and is the execution authority. Task
          // enrichment discovers it by root thread, so do not report a false
          // launch failure or invite the user to create a duplicate Run.
          logWarn("Task launch metadata update failed after Run creation", {
            module: "routes/agent-tasks",
            taskId,
            runId: createdRunId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        return c.json({
          task_id: taskId,
          thread_id: thread.id,
          run_id: createdRunId,
          reused: false,
        }, 201);
      } catch (error) {
        if (!createdRunId) {
          const failedAt = new Date().toISOString();
          await getDb(c.env.DB).update(agentTasks).set({
            status: "failed",
            completedAt: failedAt,
            updatedAt: failedAt,
          }).where(eq(agentTasks.id, taskId)).run().catch((updateError) => {
            logError("Failed to mark task launch as failed", updateError, {
              module: "routes/agent-tasks",
              taskId,
            });
          });
        }
        throw error;
      }
    },
  )
  .post("/agent-tasks/:id/plan", agentTaskPlanLimiter.middleware(), async (c) => {
    const user = c.get("user");
    const taskId = c.req.param("id");

    const task = await fetchTask(c.env.DB, taskId);
    if (!task) {
      throw new NotFoundError("Task");
    }

    const access = await checkSpaceAccess(c.env.DB, task.space_id, user.id);
    if (!access) {
      throw new NotFoundError("Task");
    }

    const model =
      normalizeModelId(task.model) ||
      normalizeModelId(access.space.ai_model) ||
      DEFAULT_MODEL_ID;
    const backend = getBackendFromModel(model);

    let apiKey: string | undefined;
    if (backend === "anthropic") {
      apiKey = c.env.ANTHROPIC_API_KEY;
    } else if (backend === "google") {
      apiKey = c.env.GOOGLE_API_KEY;
    } else {
      apiKey = c.env.OPENAI_API_KEY;
    }

    if (!apiKey) {
      throw new BadRequestError(
        `API key for backend "${backend}" is not configured`,
      );
    }

    const taskText = task.description?.trim() || task.title;

    try {
      const plan = await analyzeTask(taskText, {
        tools: CUSTOM_TOOL_NAMES,
        apiKey,
        model,
        baseUrl: c.env.OPENAI_BASE_URL,
      });

      if (!isBoundedAgentTaskPlan(plan)) {
        throw new InternalError("Generated task plan exceeds persistence limit");
      }
      const planJson = serializeAgentTaskPlanValue(plan);
      const timestamp = new Date().toISOString();

      const db = getDb(c.env.DB);
      const updated = await db
        .update(agentTasks)
        .set({
          plan: planJson,
          updatedAt: timestamp,
        })
        .where(eq(agentTasks.id, taskId))
        .returning()
        .get();
      if (!updated) {
        throw new InternalError("Failed to update task plan");
      }

      return c.json({
        task: await enrichTask(c.env, toApiTask(updated)),
        plan,
      });
    } catch (err) {
      logError("Failed to generate task plan", err, {
        module: "routes/agent-tasks",
      });
      throw new InternalError("Failed to generate task plan");
    }
  });
