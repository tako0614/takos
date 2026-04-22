import { Hono } from "hono";
import { z } from "zod";
import type {
  Env,
  MemoryType,
  ReminderStatus,
} from "../../../shared/types/index.ts";
import { checkSpaceAccess } from "../../../application/services/identity/space-access.ts";
import { type BaseVariables, requireSpaceAccess } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import {
  AuthorizationError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";
import { zValidator } from "../zod-validator.ts";
import {
  bumpMemoryAccess,
  createMemory,
  createReminder,
  deleteMemory,
  deleteReminder,
  getMemoryById,
  getReminderById,
  listMemories,
  listReminders,
  searchMemories,
  triggerReminder,
  updateMemory,
  updateReminder,
} from "../../../application/services/memory/index.ts";

// ==================== Memories ====================

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  // List memories for a workspace
  .get(
    "/spaces/:spaceId/memories",
    zValidator(
      "query",
      z.object({
        type: z.string().optional(),
        category: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await requireSpaceAccess(c, spaceId, user.id);

      const validatedQuery = c.req.valid("query");
      const type = validatedQuery.type as MemoryType | undefined;
      const category = validatedQuery.category;
      const { limit, offset } = parsePagination(validatedQuery, {
        limit: 50,
        maxLimit: 100,
      });

      const memoryList = await listMemories(c.env.DB, access.space.id, {
        type,
        category,
        limit,
        offset,
      });

      await bumpMemoryAccess(
        c.env.DB,
        memoryList.map((memory) => memory.id),
      );

      return c.json({ memories: memoryList });
    },
  )
  // Search memories
  .get(
    "/spaces/:spaceId/memories/search",
    zValidator(
      "query",
      z.object({
        q: z.string().max(1000, "Search query must be under 1000 characters")
          .optional(),
        type: z.string().optional(),
        limit: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await requireSpaceAccess(c, spaceId, user.id);

      const validatedQuery = c.req.valid("query");
      const query = (validatedQuery.q || "").trim();
      const type = validatedQuery.type as MemoryType | undefined;
      const { limit } = parsePagination(validatedQuery, { maxLimit: 100 });

      const memoriesResult = await searchMemories(
        c.env.DB,
        access.space.id,
        query,
        type,
        limit,
      );

      return c.json({ memories: memoriesResult });
    },
  )
  // Get a specific memory
  .get("/memories/:id", async (c) => {
    const user = c.get("user");
    const memoryId = c.req.param("id");

    const memory = await getMemoryById(c.env.DB, memoryId);
    if (!memory) {
      throw new NotFoundError("Memory");
    }

    const access = await checkSpaceAccess(c.env.DB, memory.space_id, user.id);
    if (!access) {
      throw new AuthorizationError();
    }

    await bumpMemoryAccess(c.env.DB, [memoryId]);

    return c.json(memory);
  })
  // Create a memory
  .post(
    "/spaces/:spaceId/memories",
    zValidator(
      "json",
      z.object({
        type: z.enum(["episode", "semantic", "procedural"]),
        content: z.string().min(1, "content is required"),
        category: z.string().optional(),
        source: z.string().optional(),
        summary: z.string().optional(),
        importance: z.number().optional(),
        tags: z.array(z.string()).optional(),
        occurred_at: z.string().optional(),
        expires_at: z.string().optional(),
        thread_id: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await requireSpaceAccess(c, spaceId, user.id);

      const body = c.req.valid("json");

      const memory = await createMemory(c.env.DB, {
        spaceId: access.space.id,
        userId: user.id,
        threadId: body.thread_id || null,
        type: body.type,
        content: body.content,
        category: body.category || null,
        summary: body.summary || null,
        importance: body.importance,
        tags: body.tags || null,
        occurredAt: body.occurred_at,
        expiresAt: body.expires_at || null,
      });

      return c.json(memory, 201);
    },
  )
  // Update a memory
  .patch(
    "/memories/:id",
    zValidator(
      "json",
      z.object({
        content: z.string().optional(),
        summary: z.string().optional(),
        importance: z.number().optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        expires_at: z.string().nullish(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const memoryId = c.req.param("id");

      const memory = await getMemoryById(c.env.DB, memoryId);
      if (!memory) {
        throw new NotFoundError("Memory");
      }

      const access = await checkSpaceAccess(
        c.env.DB,
        memory.space_id,
        user.id,
        ["owner", "admin", "editor"],
      );
      if (!access) {
        throw new AuthorizationError();
      }

      const body = c.req.valid("json");

      const updated = await updateMemory(c.env.DB, memoryId, {
        content: body.content,
        summary: body.summary,
        importance: body.importance,
        category: body.category,
        tags: body.tags,
        expiresAt: body.expires_at,
      });

      return c.json(updated);
    },
  )
  // Delete a memory
  .delete("/memories/:id", async (c) => {
    const user = c.get("user");
    const memoryId = c.req.param("id");

    const memory = await getMemoryById(c.env.DB, memoryId);
    if (!memory) {
      throw new NotFoundError("Memory");
    }

    const access = await checkSpaceAccess(c.env.DB, memory.space_id, user.id, [
      "owner",
      "admin",
      "editor",
    ]);
    if (!access) {
      throw new AuthorizationError();
    }

    await deleteMemory(c.env.DB, memoryId);

    return c.json({ success: true });
  })
  // ==================== Reminders ====================

  // List reminders for a workspace
  .get(
    "/spaces/:spaceId/reminders",
    zValidator(
      "query",
      z.object({
        status: z.string().optional(),
        limit: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await requireSpaceAccess(c, spaceId, user.id);

      const validatedQuery = c.req.valid("query");
      const status = validatedQuery.status as ReminderStatus | undefined;
      const { limit } = parsePagination(validatedQuery, {
        limit: 50,
        maxLimit: 100,
      });

      const reminders = await listReminders(c.env.DB, access.space.id, {
        status,
        limit,
      });

      return c.json({ reminders });
    },
  )
  // Get a specific reminder
  .get("/reminders/:id", async (c) => {
    const user = c.get("user");
    const reminderId = c.req.param("id");

    const reminder = await getReminderById(c.env.DB, reminderId);
    if (!reminder) {
      throw new NotFoundError("Reminder");
    }

    const access = await checkSpaceAccess(c.env.DB, reminder.space_id, user.id);
    if (!access) {
      throw new AuthorizationError();
    }

    return c.json(reminder);
  })
  // Create a reminder
  .post(
    "/spaces/:spaceId/reminders",
    zValidator(
      "json",
      z.object({
        content: z.string().min(1, "content is required"),
        context: z.string().optional(),
        trigger_type: z.enum(["time", "condition", "context"]),
        trigger_value: z.string().optional(),
        priority: z.enum(["low", "normal", "high", "critical"]).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await requireSpaceAccess(c, spaceId, user.id);

      const body = c.req.valid("json");

      const reminder = await createReminder(c.env.DB, {
        spaceId: access.space.id,
        userId: user.id,
        content: body.content,
        context: body.context || null,
        triggerType: body.trigger_type,
        triggerValue: body.trigger_value || null,
        priority: body.priority,
      });

      if (!reminder) {
        throw new InternalError("Failed to create reminder");
      }
      return c.json(reminder, 201);
    },
  )
  // Update a reminder
  .patch(
    "/reminders/:id",
    zValidator(
      "json",
      z.object({
        content: z.string().optional(),
        context: z.string().optional(),
        trigger_value: z.string().optional(),
        status: z.enum(["pending", "triggered", "completed", "dismissed"])
          .optional(),
        priority: z.enum(["low", "normal", "high", "critical"]).optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const reminderId = c.req.param("id");

      const reminder = await getReminderById(c.env.DB, reminderId);
      if (!reminder) {
        throw new NotFoundError("Reminder");
      }

      const access = await checkSpaceAccess(
        c.env.DB,
        reminder.space_id,
        user.id,
        ["owner", "admin", "editor"],
      );
      if (!access) {
        throw new AuthorizationError();
      }

      const body = c.req.valid("json");

      const updated = await updateReminder(c.env.DB, reminderId, {
        content: body.content,
        context: body.context,
        triggerValue: body.trigger_value,
        status: body.status,
        priority: body.priority,
      });

      return c.json(updated);
    },
  )
  // Delete a reminder
  .delete("/reminders/:id", async (c) => {
    const user = c.get("user");
    const reminderId = c.req.param("id");

    const reminder = await getReminderById(c.env.DB, reminderId);
    if (!reminder) {
      throw new NotFoundError("Reminder");
    }

    const access = await checkSpaceAccess(
      c.env.DB,
      reminder.space_id,
      user.id,
      ["owner", "admin", "editor"],
    );
    if (!access) {
      throw new AuthorizationError();
    }

    await deleteReminder(c.env.DB, reminderId);

    return c.json({ success: true });
  })
  // Trigger a reminder manually
  .post("/reminders/:id/trigger", async (c) => {
    const user = c.get("user");
    const reminderId = c.req.param("id");

    const reminder = await getReminderById(c.env.DB, reminderId);
    if (!reminder) {
      throw new NotFoundError("Reminder");
    }

    const access = await checkSpaceAccess(
      c.env.DB,
      reminder.space_id,
      user.id,
      ["owner", "admin", "editor"],
    );
    if (!access) {
      throw new AuthorizationError();
    }

    const updated = await triggerReminder(c.env.DB, reminderId);

    return c.json(updated);
  });
