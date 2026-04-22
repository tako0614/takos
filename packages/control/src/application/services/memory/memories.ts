import type {
  Env,
  Memory,
  MemoryType,
  Reminder,
  ReminderPriority,
  ReminderStatus,
  ReminderTriggerType,
} from "../../../shared/types/index.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { getDb, memories, reminders } from "../../../infra/db/index.ts";
import {
  and,
  type asc as _asc,
  desc,
  eq,
  inArray,
  like,
  or,
  sql,
} from "drizzle-orm";
import { textDate } from "../../../shared/utils/db-guards.ts";

export const MEMORY_TYPES: readonly string[] = [
  "episode",
  "semantic",
  "procedural",
];
const REMINDER_TRIGGER_TYPES: readonly string[] = [
  "time",
  "condition",
  "context",
];
const REMINDER_STATUSES: readonly string[] = [
  "pending",
  "triggered",
  "completed",
  "dismissed",
];
const REMINDER_PRIORITIES: readonly string[] = [
  "low",
  "normal",
  "high",
  "critical",
];

export const memoryServiceDeps = {
  getDb,
  generateId,
  now: () => new Date().toISOString(),
};

function toOptionalIsoString(value: string | Date | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.toISOString();
}

function isMemoryType(value: string): value is MemoryType {
  return MEMORY_TYPES.includes(value);
}

function isReminderTriggerType(value: string): value is ReminderTriggerType {
  return REMINDER_TRIGGER_TYPES.includes(value);
}

function isReminderStatus(value: string): value is ReminderStatus {
  return REMINDER_STATUSES.includes(value);
}

function isReminderPriority(value: string): value is ReminderPriority {
  return REMINDER_PRIORITIES.includes(value);
}

function toMemoryApi(m: {
  id: string;
  accountId: string;
  authorAccountId: string | null;
  threadId: string | null;
  type: string;
  category: string | null;
  content: string;
  summary: string | null;
  importance: number | null;
  tags: string | null;
  occurredAt: string | Date | null;
  expiresAt: string | Date | null;
  lastAccessedAt: string | Date | null;
  accessCount: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}): Memory {
  return {
    id: m.id,
    space_id: m.accountId,
    user_id: m.authorAccountId,
    thread_id: m.threadId,
    type: isMemoryType(m.type) ? m.type : "semantic",
    category: m.category,
    content: m.content,
    summary: m.summary,
    importance: m.importance ?? 0.5,
    tags: m.tags,
    occurred_at: toOptionalIsoString(m.occurredAt),
    expires_at: toOptionalIsoString(m.expiresAt),
    last_accessed_at: toOptionalIsoString(m.lastAccessedAt),
    access_count: m.accessCount ?? 0,
    created_at: textDate(m.createdAt),
    updated_at: textDate(m.updatedAt),
  };
}

function toReminderApi(r: {
  id: string;
  accountId: string;
  ownerAccountId: string | null;
  content: string;
  context: string | null;
  triggerType: string;
  triggerValue: string | null;
  status: string | null;
  triggeredAt: string | Date | null;
  priority: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}): Reminder {
  const reminderStatus = r.status ?? "pending";
  const reminderPriority = r.priority ?? "normal";

  return {
    id: r.id,
    space_id: r.accountId,
    user_id: r.ownerAccountId,
    content: r.content,
    context: r.context,
    trigger_type: isReminderTriggerType(r.triggerType) ? r.triggerType : "time",
    trigger_value: r.triggerValue,
    status: isReminderStatus(reminderStatus) ? reminderStatus : "pending",
    triggered_at: toOptionalIsoString(r.triggeredAt),
    priority: isReminderPriority(reminderPriority)
      ? reminderPriority
      : "normal",
    created_at: textDate(r.createdAt),
    updated_at: textDate(r.updatedAt),
  };
}

export async function listMemories(
  dbBinding: Env["DB"],
  spaceId: string,
  options: {
    type?: MemoryType;
    category?: string;
    limit?: number;
    offset?: number;
  },
): Promise<Memory[]> {
  const db = memoryServiceDeps.getDb(dbBinding);

  const conditions = [eq(memories.accountId, spaceId)];
  if (options.type) {
    conditions.push(eq(memories.type, options.type));
  }
  if (options.category) {
    conditions.push(eq(memories.category, options.category));
  }

  const result = await db.select().from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.importance), desc(memories.occurredAt))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0)
    .all();

  return result.map(toMemoryApi);
}

export async function bumpMemoryAccess(
  dbBinding: Env["DB"],
  memoryIds: string[],
  timestamp: string = new Date().toISOString(),
) {
  if (memoryIds.length === 0) return;

  const db = memoryServiceDeps.getDb(dbBinding);
  await db.update(memories)
    .set({
      accessCount: sql`${memories.accessCount} + 1`,
      lastAccessedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(inArray(memories.id, memoryIds));
}

export async function searchMemories(
  dbBinding: Env["DB"],
  spaceId: string,
  query: string,
  type?: MemoryType,
  limit: number = 20,
): Promise<Memory[]> {
  const db = memoryServiceDeps.getDb(dbBinding);

  const conditions = [
    eq(memories.accountId, spaceId),
    or(
      like(memories.content, `%${query}%`),
      like(memories.summary, `%${query}%`),
    ),
  ];

  if (type) {
    conditions.push(eq(memories.type, type));
  }

  const result = await db.select().from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.importance), desc(memories.occurredAt))
    .limit(limit)
    .all();

  return result.map(toMemoryApi);
}

export async function getMemoryById(
  dbBinding: Env["DB"],
  memoryId: string,
): Promise<Memory | null> {
  const db = memoryServiceDeps.getDb(dbBinding);

  const memory = await db.select().from(memories)
    .where(eq(memories.id, memoryId))
    .get();

  if (!memory) return null;

  return toMemoryApi(memory);
}

export async function createMemory(
  dbBinding: Env["DB"],
  input: {
    spaceId: string;
    userId: string;
    threadId?: string | null;
    type: MemoryType;
    content: string;
    category?: string | null;
    summary?: string | null;
    importance?: number;
    tags?: string[] | null;
    occurredAt?: string | null;
    expiresAt?: string | null;
  },
): Promise<Memory | null> {
  const db = memoryServiceDeps.getDb(dbBinding);
  const timestamp = memoryServiceDeps.now();
  const id = memoryServiceDeps.generateId();

  await db.insert(memories).values({
    id,
    accountId: input.spaceId,
    authorAccountId: input.userId,
    threadId: input.threadId || null,
    type: input.type,
    category: input.category || null,
    content: input.content,
    summary: input.summary || null,
    importance: input.importance ?? 0.5,
    tags: input.tags ? JSON.stringify(input.tags) : null,
    occurredAt: input.occurredAt || timestamp,
    expiresAt: input.expiresAt || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return getMemoryById(dbBinding, id);
}

export async function updateMemory(
  dbBinding: Env["DB"],
  memoryId: string,
  updates: {
    content?: string;
    summary?: string;
    importance?: number;
    category?: string;
    tags?: string[] | null;
    expiresAt?: string | null;
  },
): Promise<Memory | null> {
  const db = memoryServiceDeps.getDb(dbBinding);
  const timestamp = memoryServiceDeps.now();

  const data: Record<string, unknown> = { updatedAt: timestamp };
  if (updates.content !== undefined) data.content = updates.content;
  if (updates.summary !== undefined) data.summary = updates.summary;
  if (updates.importance !== undefined) data.importance = updates.importance;
  if (updates.category !== undefined) data.category = updates.category;
  if (updates.tags !== undefined) {
    data.tags = updates.tags ? JSON.stringify(updates.tags) : null;
  }
  if (updates.expiresAt !== undefined) data.expiresAt = updates.expiresAt;

  await db.update(memories)
    .set(data)
    .where(eq(memories.id, memoryId));

  return getMemoryById(dbBinding, memoryId);
}

export async function deleteMemory(dbBinding: Env["DB"], memoryId: string) {
  const db = memoryServiceDeps.getDb(dbBinding);

  await db.delete(memories).where(eq(memories.id, memoryId));
}

export async function listReminders(
  dbBinding: Env["DB"],
  spaceId: string,
  options: { status?: ReminderStatus; limit?: number },
): Promise<Reminder[]> {
  const db = memoryServiceDeps.getDb(dbBinding);

  const conditions = [eq(reminders.accountId, spaceId)];
  if (options.status) {
    conditions.push(eq(reminders.status, options.status));
  }

  const result = await db.select().from(reminders)
    .where(and(...conditions))
    .orderBy(desc(reminders.priority), desc(reminders.createdAt))
    .limit(options.limit ?? 50)
    .all();

  return result.map(toReminderApi);
}

export async function getReminderById(
  dbBinding: Env["DB"],
  reminderId: string,
): Promise<Reminder | null> {
  const db = memoryServiceDeps.getDb(dbBinding);

  const reminder = await db.select().from(reminders)
    .where(eq(reminders.id, reminderId))
    .get();

  if (!reminder) return null;

  return toReminderApi(reminder);
}

export async function createReminder(
  dbBinding: Env["DB"],
  input: {
    spaceId: string;
    userId: string;
    content: string;
    context?: string | null;
    triggerType: ReminderTriggerType;
    triggerValue?: string | null;
    priority?: ReminderPriority;
  },
): Promise<Reminder | null> {
  const db = memoryServiceDeps.getDb(dbBinding);
  const timestamp = memoryServiceDeps.now();
  const id = memoryServiceDeps.generateId();

  await db.insert(reminders).values({
    id,
    accountId: input.spaceId,
    ownerAccountId: input.userId,
    content: input.content,
    context: input.context || null,
    triggerType: input.triggerType,
    triggerValue: input.triggerValue || null,
    status: "pending",
    priority: input.priority || "normal",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return getReminderById(dbBinding, id);
}

export async function updateReminder(
  dbBinding: Env["DB"],
  reminderId: string,
  updates: {
    content?: string;
    context?: string;
    triggerValue?: string;
    status?: ReminderStatus;
    priority?: ReminderPriority;
  },
): Promise<Reminder | null> {
  const db = memoryServiceDeps.getDb(dbBinding);
  const timestamp = memoryServiceDeps.now();

  const data: Record<string, unknown> = { updatedAt: timestamp };
  if (updates.content !== undefined) data.content = updates.content;
  if (updates.context !== undefined) data.context = updates.context;
  if (updates.triggerValue !== undefined) {
    data.triggerValue = updates.triggerValue;
  }
  if (updates.status !== undefined) {
    data.status = updates.status;
    if (updates.status === "triggered") data.triggeredAt = timestamp;
  }
  if (updates.priority !== undefined) data.priority = updates.priority;

  await db.update(reminders)
    .set(data)
    .where(eq(reminders.id, reminderId));

  return getReminderById(dbBinding, reminderId);
}

export async function deleteReminder(dbBinding: Env["DB"], reminderId: string) {
  const db = memoryServiceDeps.getDb(dbBinding);

  await db.delete(reminders).where(eq(reminders.id, reminderId));
}

export async function triggerReminder(
  dbBinding: Env["DB"],
  reminderId: string,
): Promise<Reminder | null> {
  const db = memoryServiceDeps.getDb(dbBinding);
  const timestamp = memoryServiceDeps.now();

  await db.update(reminders)
    .set({
      status: "triggered",
      triggeredAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(reminders.id, reminderId));

  return getReminderById(dbBinding, reminderId);
}
