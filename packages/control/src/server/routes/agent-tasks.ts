import { Hono } from "hono";
import { z } from "zod";
import type { AgentTaskStatus, Env } from "../../shared/types/index.ts";
import type { BaseVariables } from "./route-auth.ts";
import { parsePagination } from "../../shared/utils/index.ts";
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";
import { zValidator } from "./zod-validator.ts";
import { generateId } from "../../shared/utils/index.ts";
import { checkSpaceAccess } from "../../application/services/identity/space-access.ts";
import { createThread } from "../../application/services/threads/thread-service.ts";
import { analyzeTask } from "../../application/services/agent/workflow.ts";
import {
  DEFAULT_MODEL_ID,
  filterAgentAllowedToolNames,
  getBackendFromModel,
  normalizeModelId,
} from "../../application/services/agent/index.ts";
import { CUSTOM_TOOLS } from "../../application/tools/custom/index.ts";
import { getDb } from "../../infra/db/index.ts";
import { agentTasks, runs, threads } from "../../infra/db/schema.ts";
import { and, desc, eq } from "drizzle-orm";
import { logError } from "../../shared/utils/logger.ts";
import {
  DEFAULT_PRIORITY,
  DEFAULT_STATUS,
  enrichTask,
  enrichTasks,
  fetchTask,
  toApiTask,
  VALID_PRIORITIES,
  VALID_STATUSES,
} from "./agent-tasks-handlers.ts";

const CUSTOM_TOOL_NAMES = filterAgentAllowedToolNames(
  CUSTOM_TOOLS.map((tool) => tool.name),
);
export const agentTaskRouteDeps = {
  checkSpaceAccess,
  getDb,
};

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  .get("/spaces/:spaceId/agent-tasks", async (c) => {
    const user = c.get("user");
    const spaceId = c.req.param("spaceId");
    const status = c.req.query("status") as AgentTaskStatus | undefined;
    const { limit, offset } = parsePagination(c.req.query(), {
      limit: 50,
      maxLimit: 200,
    });

    const access = await agentTaskRouteDeps.checkSpaceAccess(
      c.env.DB,
      spaceId,
      user.id,
    );
    if (!access) {
      throw new NotFoundError("Workspace");
    }

    if (
      status &&
      !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])
    ) {
      throw new BadRequestError("Invalid status");
    }

    const db = agentTaskRouteDeps.getDb(c.env.DB);
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
  .post(
    "/spaces/:spaceId/agent-tasks",
    zValidator(
      "json",
      z.object({
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
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");
      const body = c.req.valid("json");

      const access = await agentTaskRouteDeps.checkSpaceAccess(
        c.env.DB,
        spaceId,
        user.id,
        ["owner", "admin", "editor"],
      );
      if (!access) {
        throw new NotFoundError("Workspace");
      }

      if (!body.title?.trim()) {
        throw new BadRequestError("title is required");
      }

      const status = body.status || DEFAULT_STATUS;
      const priority = body.priority || DEFAULT_PRIORITY;

      let threadId = body.thread_id ?? null;
      if (!threadId && body.create_thread !== false) {
        const thread = await createThread(c.env.DB, spaceId, {
          title: body.title.trim(),
        });
        threadId = thread?.id || null;
      }

      const planValue = body.plan
        ? (typeof body.plan === "string"
          ? body.plan
          : JSON.stringify(body.plan))
        : null;

      const normalizedModel = normalizeModelId(body.model);
      const taskId = generateId();
      const timestamp = new Date().toISOString();

      const db = agentTaskRouteDeps.getDb(c.env.DB);
      const created = await db.insert(agentTasks).values({
        id: taskId,
        accountId: spaceId,
        createdByAccountId: user.id,
        threadId,
        title: body.title.trim(),
        description: body.description?.trim() || null,
        status,
        priority,
        agentType: body.agent_type || "default",
        model: normalizedModel,
        plan: planValue,
        dueAt: body.due_at || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }).returning().get();

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

    const access = await agentTaskRouteDeps.checkSpaceAccess(
      c.env.DB,
      task.space_id,
      user.id,
    );
    if (!access) {
      throw new NotFoundError("Task");
    }

    return c.json({ task: await enrichTask(c.env, task) });
  })
  .patch(
    "/agent-tasks/:id",
    zValidator(
      "json",
      z.object({
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
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const taskId = c.req.param("id");
      const body = c.req.valid("json");

      const task = await fetchTask(c.env.DB, taskId);
      if (!task) {
        throw new NotFoundError("Task");
      }

      const access = await agentTaskRouteDeps.checkSpaceAccess(
        c.env.DB,
        task.space_id,
        user.id,
        ["owner", "admin", "editor"],
      );
      if (!access) {
        throw new NotFoundError("Task");
      }

      const updates: Record<string, unknown> = {};

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
        updates.agentType = body.agent_type || "default";
      }

      if (body.model !== undefined) {
        updates.model = normalizeModelId(body.model);
      }

      if (body.plan !== undefined) {
        updates.plan = body.plan
          ? (typeof body.plan === "string"
            ? body.plan
            : JSON.stringify(body.plan))
          : null;
      }

      if (body.due_at !== undefined) {
        updates.dueAt = body.due_at || null;
      }

      const db = agentTaskRouteDeps.getDb(c.env.DB);

      if (body.thread_id !== undefined) {
        if (body.thread_id) {
          const thread = await db.select({ id: threads.id }).from(threads)
            .where(
              and(
                eq(threads.id, body.thread_id),
                eq(threads.accountId, task.space_id),
              ),
            ).get();
          if (!thread) {
            throw new NotFoundError("Thread");
          }
        }
        updates.threadId = body.thread_id || null;
      }

      if (body.last_run_id !== undefined) {
        if (body.last_run_id) {
          const run = await db.select({ id: runs.id }).from(runs).where(
            and(
              eq(runs.id, body.last_run_id),
              eq(runs.accountId, task.space_id),
            ),
          ).get();
          if (!run) {
            throw new NotFoundError("Run");
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

      if (!updates.completedAt && body.status === "completed") {
        updates.completedAt = new Date().toISOString();
      }

      if (!updates.startedAt && body.status === "in_progress") {
        updates.startedAt = new Date().toISOString();
      }

      if (Object.keys(updates).length === 0) {
        throw new BadRequestError("No valid updates provided");
      }

      updates.updatedAt = new Date().toISOString();
      const updated = await db.update(agentTasks).set(updates).where(
        eq(agentTasks.id, taskId),
      ).returning().get();
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

    const access = await agentTaskRouteDeps.checkSpaceAccess(
      c.env.DB,
      task.space_id,
      user.id,
      ["owner", "admin"],
    );
    if (!access) {
      throw new NotFoundError("Task");
    }

    const db = agentTaskRouteDeps.getDb(c.env.DB);
    await db.delete(agentTasks).where(eq(agentTasks.id, taskId));

    return c.json({ success: true });
  })
  .post("/agent-tasks/:id/plan", async (c) => {
    const user = c.get("user");
    const taskId = c.req.param("id");

    const task = await fetchTask(c.env.DB, taskId);
    if (!task) {
      throw new NotFoundError("Task");
    }

    const access = await agentTaskRouteDeps.checkSpaceAccess(
      c.env.DB,
      task.space_id,
      user.id,
      ["owner", "admin", "editor"],
    );
    if (!access) {
      throw new NotFoundError("Task");
    }

    const model = normalizeModelId(task.model) ||
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
        spaceId: task.space_id,
        userId: user.id,
        tools: CUSTOM_TOOL_NAMES,
        apiKey,
        model,
      });

      const planJson = JSON.stringify(plan);
      const timestamp = new Date().toISOString();

      const db = agentTaskRouteDeps.getDb(c.env.DB);
      const updated = await db.update(agentTasks).set({
        plan: planJson,
        updatedAt: timestamp,
      }).where(eq(agentTasks.id, taskId)).returning().get();
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
