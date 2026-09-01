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
import { stringifyCanonicalJson } from "../../../shared/utils/canonical-json.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import {
  agentResourceDeletionOutbox,
  agentResourceTombstones,
  getDb,
  memories,
  reminders,
} from "../../../infra/db/index.ts";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { textDate } from "../../../shared/utils/db-guards.ts";
import {
  assertMemoryImportance,
  DEFAULT_MEMORY_IMPORTANCE,
} from "./importance.ts";
import { prepareAgentResourceDeletion } from "../agent/resource-deletion.ts";
import type { RunContextResourceReference } from "../runs/run-authority.ts";

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

/**
 * Canonical semantic revision of one ExplicitMemory.
 *
 * Access counters are operational telemetry and deliberately excluded: a read
 * must not manufacture a new content revision or invalidate a pinned digest.
 * The returned object is used only as digest input and is never copied into a
 * RunContext or deletion tombstone.
 */
export function explicitMemoryResourceSnapshot(memory: Memory) {
  return {
    schemaVersion: 1,
    resourceKind: "explicit_memory",
    id: memory.id,
    workspaceId: memory.space_id,
    authorAccountId: memory.user_id,
    threadId: memory.thread_id,
    type: memory.type,
    category: memory.category,
    content: memory.content,
    summary: memory.summary,
    importance: memory.importance,
    tags: memory.tags,
    occurredAt: memory.occurred_at,
    expiresAt: memory.expires_at,
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
  };
}

export async function explicitMemoryResourceReference(
  memory: Memory,
): Promise<RunContextResourceReference> {
  const canonical = stringifyCanonicalJson(
    explicitMemoryResourceSnapshot(memory),
  );
  if (canonical === undefined) {
    throw new TypeError("ExplicitMemory revision is not serializable");
  }
  return {
    resourceKind: "explicit_memory",
    resourceId: memory.id,
    resourceDigest: `sha256:${await computeSHA256(canonical)}`,
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
      // `timestamps.updatedAt` has a Drizzle $onUpdateFn; explicitly retain the
      // semantic revision timestamp for this telemetry-only mutation.
      updatedAt: sql`${memories.updatedAt}`,
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
      sql`instr(lower(${memories.content}), lower(${query})) > 0`,
      sql`instr(lower(${memories.summary}), lower(${query})) > 0`,
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

async function getMemoryByIdInSpace(
  dbBinding: Env["DB"],
  spaceId: string,
  memoryId: string,
): Promise<Memory | null> {
  const db = memoryServiceDeps.getDb(dbBinding);
  const memory = await db.select().from(memories)
    .where(
      and(eq(memories.id, memoryId), eq(memories.accountId, spaceId)),
    )
    .get();
  return memory ? toMemoryApi(memory) : null;
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
  const importance = assertMemoryImportance(
    input.importance ?? DEFAULT_MEMORY_IMPORTANCE,
  );
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
    importance,
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
  spaceId: string,
  memoryId: string,
  updates: {
    content?: string;
    summary?: string | null;
    importance?: number;
    category?: string | null;
    tags?: string[] | null;
    expiresAt?: string | null;
  },
): Promise<Memory | null> {
  const importance = updates.importance === undefined
    ? undefined
    : assertMemoryImportance(updates.importance);
  const db = memoryServiceDeps.getDb(dbBinding);
  const timestamp = memoryServiceDeps.now();

  const data: Record<string, unknown> = { updatedAt: timestamp };
  if (updates.content !== undefined) data.content = updates.content;
  if (updates.summary !== undefined) data.summary = updates.summary;
  if (importance !== undefined) data.importance = importance;
  if (updates.category !== undefined) data.category = updates.category;
  if (updates.tags !== undefined) {
    data.tags = updates.tags ? JSON.stringify(updates.tags) : null;
  }
  if (updates.expiresAt !== undefined) data.expiresAt = updates.expiresAt;

  await db.update(memories)
    .set(data)
    .where(
      and(eq(memories.id, memoryId), eq(memories.accountId, spaceId)),
    );

  return getMemoryByIdInSpace(dbBinding, spaceId, memoryId);
}

export async function deleteMemory(
  dbBinding: Env["DB"],
  spaceId: string,
  memoryId: string,
  deletedByAccountId: string,
): Promise<{ tombstoneId: string } | null> {
  const db = memoryServiceDeps.getDb(dbBinding);
  const memory = await db.select({
    id: memories.id,
    accountId: memories.accountId,
    authorAccountId: memories.authorAccountId,
    threadId: memories.threadId,
    type: memories.type,
    category: memories.category,
    content: memories.content,
    summary: memories.summary,
    importance: memories.importance,
    tags: memories.tags,
    occurredAt: memories.occurredAt,
    expiresAt: memories.expiresAt,
    lastAccessedAt: memories.lastAccessedAt,
    accessCount: memories.accessCount,
    createdAt: memories.createdAt,
    updatedAt: memories.updatedAt,
  }).from(memories).where(and(
    eq(memories.id, memoryId),
    eq(memories.accountId, spaceId),
  )).get();
  if (!memory) return null;

  const deletedAt = memoryServiceDeps.now();
  const deletion = await prepareAgentResourceDeletion({
    accountId: spaceId,
    resourceKind: "explicit_memory",
    resourceId: memoryId,
    source: explicitMemoryResourceSnapshot(toMemoryApi(memory)),
    deletedByAccountId,
    deletedAt,
  });
  const exactSource = and(
    eq(memories.id, memoryId),
    eq(memories.accountId, spaceId),
    eq(memories.updatedAt, textDate(memory.updatedAt)),
  );
  const tombstoneInsert = db.insert(agentResourceTombstones).select(
    db.select({
      id: sql<string>`${deletion.id}`.as("id"),
      accountId: memories.accountId,
      resourceKind: sql<string>`${deletion.resourceKind}`.as("resource_kind"),
      resourceId: memories.id,
      sourceDigest: sql<string>`${deletion.sourceDigest}`.as("source_digest"),
      deletedByAccountId: sql<string>`${deletion.deletedByAccountId}`.as(
        "deleted_by_account_id",
      ),
      deletedAt: sql<string>`${deletion.deletedAt}`.as("deleted_at"),
      createdAt: sql<string>`${deletion.deletedAt}`.as("created_at"),
    }).from(memories).where(exactSource),
  ).onConflictDoNothing();
  const outboxInsert = db.insert(agentResourceDeletionOutbox).select(
    db.select({
      id: agentResourceTombstones.id,
      accountId: agentResourceTombstones.accountId,
      resourceKind: agentResourceTombstones.resourceKind,
      resourceId: agentResourceTombstones.resourceId,
      vectorIds: sql<string>`${deletion.vectorIdsJson}`.as("vector_ids"),
      offloadObjectKeys: sql<string>`${deletion.offloadObjectKeysJson}`.as(
        "offload_object_keys",
      ),
      deliveryStatus: sql<string>`'pending'`.as("delivery_status"),
      attempts: sql<number>`0`.as("attempts"),
      claimToken: sql<string | null>`NULL`.as("claim_token"),
      claimedAt: sql<string | null>`NULL`.as("claimed_at"),
      nextAttemptAt: sql<string | null>`NULL`.as("next_attempt_at"),
      completedAt: sql<string | null>`NULL`.as("completed_at"),
      lastError: sql<string | null>`NULL`.as("last_error"),
      createdAt: agentResourceTombstones.createdAt,
      updatedAt: agentResourceTombstones.createdAt,
    }).from(agentResourceTombstones).where(
      eq(agentResourceTombstones.id, deletion.id),
    ),
  ).onConflictDoNothing();
  await db.batch([
    tombstoneInsert,
    outboxInsert,
    db.delete(memories).where(exactSource),
  ]);

  const [remaining, tombstone] = await Promise.all([
    db.select({ id: memories.id }).from(memories).where(and(
      eq(memories.id, memoryId),
      eq(memories.accountId, spaceId),
    )).get(),
    db.select({ id: agentResourceTombstones.id })
      .from(agentResourceTombstones)
      .where(and(
        eq(agentResourceTombstones.id, deletion.id),
        eq(agentResourceTombstones.accountId, spaceId),
        eq(agentResourceTombstones.resourceKind, "explicit_memory"),
        eq(agentResourceTombstones.resourceId, memoryId),
      )).get(),
  ]);
  if (remaining || !tombstone) return null;
  return { tombstoneId: tombstone.id };
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

async function getReminderByIdInSpace(
  dbBinding: Env["DB"],
  spaceId: string,
  reminderId: string,
): Promise<Reminder | null> {
  const db = memoryServiceDeps.getDb(dbBinding);
  const reminder = await db.select().from(reminders)
    .where(
      and(eq(reminders.id, reminderId), eq(reminders.accountId, spaceId)),
    )
    .get();
  return reminder ? toReminderApi(reminder) : null;
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
  spaceId: string,
  reminderId: string,
  updates: {
    content?: string;
    context?: string | null;
    triggerValue?: string | null;
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
    .where(
      and(eq(reminders.id, reminderId), eq(reminders.accountId, spaceId)),
    );

  return getReminderByIdInSpace(dbBinding, spaceId, reminderId);
}

export async function deleteReminder(
  dbBinding: Env["DB"],
  spaceId: string,
  reminderId: string,
) {
  const db = memoryServiceDeps.getDb(dbBinding);

  await db.delete(reminders).where(
    and(eq(reminders.id, reminderId), eq(reminders.accountId, spaceId)),
  );
}

export async function triggerReminder(
  dbBinding: Env["DB"],
  spaceId: string,
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
    .where(
      and(eq(reminders.id, reminderId), eq(reminders.accountId, spaceId)),
    );

  return getReminderByIdInSpace(dbBinding, spaceId, reminderId);
}
