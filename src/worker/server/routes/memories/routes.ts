import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../shared/types/index.ts";
import {
  MAX_MEMORY_CATEGORY_CHARACTERS,
  MAX_MEMORY_CONTENT_CHARACTERS,
  MAX_MEMORY_REFERENCE_CHARACTERS,
  MAX_MEMORY_SEARCH_QUERY_CHARACTERS,
  MAX_MEMORY_SUMMARY_CHARACTERS,
  MAX_MEMORY_TAG_CHARACTERS,
  MAX_MEMORY_TAG_ITEMS,
  MAX_MEMORY_TAGS_CHARACTERS,
  MAX_MEMORY_TIMESTAMP_CHARACTERS,
  MAX_REMINDER_CONTENT_CHARACTERS,
  MAX_REMINDER_CONTEXT_CHARACTERS,
  MAX_REMINDER_TRIGGER_VALUE_CHARACTERS,
} from "../../../shared/types/index.ts";
import { checkSpaceAccess } from "../../../application/services/identity/space-access.ts";
import { type BaseVariables, requireSpaceAccess } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import {
  AuthorizationError,
  ConflictError,
  InternalError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
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
import {
  findAgentResourceTombstone,
  runAgentResourceDeletionOutboxBatch,
} from "../../../application/services/agent/resource-deletion.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
const VALID_MEMORY_TYPES = ["episode", "semantic", "procedural"] as const;
const VALID_REMINDER_STATUSES = [
  "pending",
  "triggered",
  "completed",
  "dismissed",
] as const;
const VALID_REMINDER_TRIGGER_TYPES = [
  "time",
  "condition",
  "context",
] as const;
const VALID_REMINDER_PRIORITIES = [
  "low",
  "normal",
  "high",
  "critical",
] as const;
const paginationValueSchema = z.string().regex(/^\d{1,10}$/).optional();
const nonBlankString = (maxCharacters: number, message: string) =>
  z.string().max(maxCharacters).refine((value) => value.trim().length > 0, {
    message,
  });
const timestampSchema = z.string().max(MAX_MEMORY_TIMESTAMP_CHARACTERS)
  .datetime({ offset: true });
const memoryTagsSchema = z.array(
  nonBlankString(MAX_MEMORY_TAG_CHARACTERS, "tag is required"),
).max(MAX_MEMORY_TAG_ITEMS).refine(
  (tags) => JSON.stringify(tags).length <= MAX_MEMORY_TAGS_CHARACTERS,
  `tags must serialize to at most ${MAX_MEMORY_TAGS_CHARACTERS} characters`,
);

export const memoryListQuerySchema = z.object({
  type: z.enum(VALID_MEMORY_TYPES).optional(),
  category: z.string().max(MAX_MEMORY_CATEGORY_CHARACTERS).optional(),
  limit: paginationValueSchema,
  offset: paginationValueSchema,
}).strict();

export const memorySearchQuerySchema = z.object({
  q: z.string().max(MAX_MEMORY_SEARCH_QUERY_CHARACTERS).optional(),
  type: z.enum(VALID_MEMORY_TYPES).optional(),
  limit: paginationValueSchema,
}).strict();

export const memoryCreateSchema = z.object({
  type: z.enum(VALID_MEMORY_TYPES),
  content: nonBlankString(
    MAX_MEMORY_CONTENT_CHARACTERS,
    "content is required",
  ),
  category: z.string().max(MAX_MEMORY_CATEGORY_CHARACTERS).optional(),
  summary: z.string().max(MAX_MEMORY_SUMMARY_CHARACTERS).optional(),
  importance: z.number().min(0).max(1).optional(),
  tags: memoryTagsSchema.optional(),
  occurred_at: timestampSchema.optional(),
  expires_at: timestampSchema.optional(),
  thread_id: z.string().max(MAX_MEMORY_REFERENCE_CHARACTERS).optional(),
}).strict();

export const memoryPatchSchema = z.object({
  content: nonBlankString(
    MAX_MEMORY_CONTENT_CHARACTERS,
    "content is required",
  ).optional(),
  summary: z.string().max(MAX_MEMORY_SUMMARY_CHARACTERS).nullable().optional(),
  importance: z.number().min(0).max(1).optional(),
  category: z.string().max(MAX_MEMORY_CATEGORY_CHARACTERS).nullable()
    .optional(),
  tags: memoryTagsSchema.nullable().optional(),
  expires_at: timestampSchema.nullable().optional(),
}).strict().refine(
  (body) => Object.keys(body).length > 0,
  "At least one Memory field is required",
);

export const reminderListQuerySchema = z.object({
  status: z.enum(VALID_REMINDER_STATUSES).optional(),
  limit: paginationValueSchema,
}).strict();

export const reminderCreateSchema = z.object({
  content: nonBlankString(
    MAX_REMINDER_CONTENT_CHARACTERS,
    "content is required",
  ),
  context: z.string().max(MAX_REMINDER_CONTEXT_CHARACTERS).optional(),
  trigger_type: z.enum(VALID_REMINDER_TRIGGER_TYPES),
  trigger_value: z.string().max(MAX_REMINDER_TRIGGER_VALUE_CHARACTERS)
    .optional(),
  priority: z.enum(VALID_REMINDER_PRIORITIES).optional(),
}).strict();

export const reminderPatchSchema = z.object({
  content: nonBlankString(
    MAX_REMINDER_CONTENT_CHARACTERS,
    "content is required",
  ).optional(),
  context: z.string().max(MAX_REMINDER_CONTEXT_CHARACTERS).nullable()
    .optional(),
  trigger_value: z.string().max(MAX_REMINDER_TRIGGER_VALUE_CHARACTERS)
    .nullable().optional(),
  status: z.enum(VALID_REMINDER_STATUSES).optional(),
  priority: z.enum(VALID_REMINDER_PRIORITIES).optional(),
}).strict().refine(
  (body) => Object.keys(body).length > 0,
  "At least one Reminder field is required",
);

// ==================== Memories ====================

export default new Hono<{ Bindings: Env; Variables: BaseVariables }>()
  // List memories for a workspace
  .get(
    "/spaces/:spaceId/memories",
    zValidator(
      "query",
      memoryListQuerySchema,
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      const validatedQuery = c.req.valid("query");
      const type = validatedQuery.type;
      const category = validatedQuery.category;
      const { limit, offset } = parsePagination(validatedQuery, {
        limit: 50,
        maxLimit: 100,
      });

      const memoryList = await listMemories(
        c.env.DB,
        access.space.id,
        { type, category, limit, offset },
      );

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
      memorySearchQuerySchema,
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      const validatedQuery = c.req.valid("query");
      const query = (validatedQuery.q || "").trim();
      const type = validatedQuery.type;
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

    const access = await checkSpaceAccess(
      c.env.DB,
      memory.space_id,
      user.id,
    );
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
      memoryCreateSchema,
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

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

      if (!memory) {
        throw new InternalError("Failed to create memory");
      }
      return c.json(memory, 201);
    },
  )
  // Update a memory
  .patch(
    "/memories/:id",
    zValidator(
      "json",
      memoryPatchSchema,
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
      );
      if (!access) {
        throw new AuthorizationError();
      }

      const body = c.req.valid("json");

      const updated = await updateMemory(
        c.env.DB,
        memory.space_id,
        memoryId,
        {
          content: body.content,
          summary: body.summary,
          importance: body.importance,
          category: body.category,
          tags: body.tags,
          expiresAt: body.expires_at,
        },
      );

      if (!updated) {
        throw new InternalError("Failed to update memory");
      }
      return c.json(updated);
    },
  )
  // Delete a memory
  .delete("/memories/:id", async (c) => {
    const user = c.get("user");
    const memoryId = c.req.param("id");

    const memory = await getMemoryById(c.env.DB, memoryId);
    const existingDeletion = memory ? null : await findAgentResourceTombstone(
      c.env.DB,
      "explicit_memory",
      memoryId,
    );
    if (!memory && !existingDeletion) {
      throw new NotFoundError("Memory");
    }

    const access = await checkSpaceAccess(
      c.env.DB,
      memory?.space_id ?? existingDeletion!.accountId,
      user.id,
    );
    if (!access) {
      throw new AuthorizationError();
    }

    const deletion = existingDeletion ?? await deleteMemory(
      c.env.DB,
      memory!.space_id,
      memoryId,
      user.id,
    );
    if (!deletion) {
      throw new ConflictError("Memory changed while it was being deleted");
    }
    const tombstoneId = "tombstoneId" in deletion
      ? deletion.tombstoneId
      : deletion.id;
    const cleanup = runAgentResourceDeletionOutboxBatch(c.env, {
      ids: [tombstoneId],
      limit: 1,
    }).catch((error) => {
      logWarn("Deferred Agent resource cleanup failed after Memory deletion", {
        module: "memory_routes",
        tombstoneId,
        detail: error,
      });
    });
    if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
      c.executionCtx.waitUntil(cleanup);
    } else {
      await cleanup;
    }

    return c.json({ success: true });
  })
  // ==================== Reminders ====================

  // List reminders for a workspace
  .get(
    "/spaces/:spaceId/reminders",
    zValidator(
      "query",
      reminderListQuerySchema,
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

      const validatedQuery = c.req.valid("query");
      const status = validatedQuery.status;
      const { limit } = parsePagination(validatedQuery, {
        limit: 50,
        maxLimit: 100,
      });

      const reminders = await listReminders(
        c.env.DB,
        access.space.id,
        { status, limit },
      );

      return c.json({ reminders });
    },
  )
  // Get a specific reminder
  .get("/reminders/:id", async (c) => {
    const user = c.get("user");
    const reminderId = c.req.param("id");

    const reminder = await getReminderById(
      c.env.DB,
      reminderId,
    );
    if (!reminder) {
      throw new NotFoundError("Reminder");
    }

    const access = await checkSpaceAccess(
      c.env.DB,
      reminder.space_id,
      user.id,
    );
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
      reminderCreateSchema,
    ),
    async (c) => {
      const user = c.get("user");
      const spaceId = c.req.param("spaceId");

      const access = await requireSpaceAccess(
        c,
        spaceId,
        user.id,
      );

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
      reminderPatchSchema,
    ),
    async (c) => {
      const user = c.get("user");
      const reminderId = c.req.param("id");

      const reminder = await getReminderById(
        c.env.DB,
        reminderId,
      );
      if (!reminder) {
        throw new NotFoundError("Reminder");
      }

      const access = await checkSpaceAccess(
        c.env.DB,
        reminder.space_id,
        user.id,
      );
      if (!access) {
        throw new AuthorizationError();
      }

      const body = c.req.valid("json");

      const updated = await updateReminder(
        c.env.DB,
        reminder.space_id,
        reminderId,
        {
          content: body.content,
          context: body.context,
          triggerValue: body.trigger_value,
          status: body.status,
          priority: body.priority,
        },
      );

      if (!updated) {
        throw new InternalError("Failed to update reminder");
      }
      return c.json(updated);
    },
  )
  // Delete a reminder
  .delete("/reminders/:id", async (c) => {
    const user = c.get("user");
    const reminderId = c.req.param("id");

    const reminder = await getReminderById(
      c.env.DB,
      reminderId,
    );
    if (!reminder) {
      throw new NotFoundError("Reminder");
    }

    const access = await checkSpaceAccess(
      c.env.DB,
      reminder.space_id,
      user.id,
    );
    if (!access) {
      throw new AuthorizationError();
    }

    await deleteReminder(c.env.DB, reminder.space_id, reminderId);

    return c.json({ success: true });
  })
  // Trigger a reminder manually
  .post("/reminders/:id/trigger", async (c) => {
    const user = c.get("user");
    const reminderId = c.req.param("id");

    const reminder = await getReminderById(
      c.env.DB,
      reminderId,
    );
    if (!reminder) {
      throw new NotFoundError("Reminder");
    }

    const access = await checkSpaceAccess(
      c.env.DB,
      reminder.space_id,
      user.id,
    );
    if (!access) {
      throw new AuthorizationError();
    }

    const updated = await triggerReminder(
      c.env.DB,
      reminder.space_id,
      reminderId,
    );

    if (!updated) {
      throw new InternalError("Failed to trigger reminder");
    }

    return c.json(updated);
  });
