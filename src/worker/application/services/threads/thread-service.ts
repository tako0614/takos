import type { SqlDatabaseLike } from "../../../infra/db/index.ts";
import type {
  Env,
  Message,
  MessageRole,
  Thread,
  ThreadStatus,
} from "../../../shared/types/index.ts";
import type {
  InsertOf,
  SelectOf,
} from "../../../shared/types/drizzle-utils.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { checkSpaceAccess } from "../identity/space-access.ts";
import { getDb, messages, threads } from "../../../infra/db/index.ts";
import { and, asc, count, desc, eq, max, ne } from "drizzle-orm";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import {
  makeMessagePreview,
  MAX_MESSAGE_PAGE_HYDRATION_BYTES,
  readOffloadedMessageRecord,
  readMessageFromR2,
  shouldOffloadMessage,
  writeMessageToR2,
} from "../offload/messages.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import {
  reserveThreadMessageSequence,
  ThreadMessageSequenceUnavailableError,
} from "./message-sequence.ts";
import {
  clientOperationRowId,
  ClientOperationConflictError,
} from "../../../shared/utils/client-operation-id.ts";
import { MAX_CLIENT_THREAD_TITLE_CHARACTERS } from "../../../shared/utils/client-thread.ts";
import { stringifyCanonicalJson } from "../../../shared/utils/canonical-json.ts";
import { MAX_CHAT_THREADS_PER_RESPONSE } from "takos-api-contract/chat-thread";
import { retireDeletedThreadTurnProjectionsBatch } from "../agent/memory-projection.ts";

function normalizeThreadTitle(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new TypeError("Invalid Thread title");
  const title = value.trim();
  if (title.length > MAX_CLIENT_THREAD_TITLE_CHARACTERS) {
    throw new TypeError("Invalid Thread title");
  }
  return title || null;
}

export interface ThreadAccess {
  thread: Thread;
}

export class ArchivedThreadWriteError extends Error {
  constructor() {
    super("Archived Thread must be unarchived before writing");
    this.name = "ArchivedThreadWriteError";
  }
}

type MessageRow = {
  id: string;
  threadId: string;
  role: string;
  content: string;
  r2Key: string | null;
  toolCalls: string | null;
  toolCallId: string | null;
  metadata: string;
  sequence: number;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Drizzle row -> app type converters
// ---------------------------------------------------------------------------

function toThread(t: SelectOf<typeof threads>): Thread {
  return {
    id: t.id,
    space_id: t.accountId,
    title: t.title ?? null,
    locale: t.locale === "ja" || t.locale === "en" ? t.locale : null,
    status: t.status as ThreadStatus,
    summary: t.summary ?? null,
    key_points: t.keyPoints ?? "[]",
    retrieval_index: t.retrievalIndex ?? -1,
    context_window: t.contextWindow ?? 50,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

function toMessage(m: MessageRow): Message {
  return {
    id: m.id,
    thread_id: m.threadId,
    role: m.role as MessageRole,
    content: m.content,
    tool_calls: m.toolCalls ?? null,
    tool_call_id: m.toolCallId ?? null,
    metadata: m.metadata,
    sequence: m.sequence,
    created_at: m.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Exported service functions
// ---------------------------------------------------------------------------

export async function checkThreadAccess(
  dbBinding: SqlDatabaseLike,
  threadId: string,
  userId: string,
): Promise<ThreadAccess | null> {
  if (!isValidOpaqueId(threadId) || !isValidOpaqueId(userId)) {
    return null;
  }

  const db = getDb(dbBinding);
  const row = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), ne(threads.status, "deleted")))
    .get();

  if (!row) {
    return null;
  }

  const thread = toThread(row);

  const access = await checkSpaceAccess(dbBinding, thread.space_id, userId);
  if (!access) {
    return null;
  }

  return { thread };
}

export async function listThreads(
  dbBinding: SqlDatabaseLike,
  spaceId: string,
  options: { status?: ThreadStatus },
): Promise<{ threads: Thread[]; truncated: boolean }> {
  const db = getDb(dbBinding);

  const conditions = [eq(threads.accountId, spaceId)];

  if (options.status) {
    conditions.push(eq(threads.status, options.status));
  } else {
    conditions.push(ne(threads.status, "deleted"));
  }

  const results = await db
    .select()
    .from(threads)
    .where(and(...conditions))
    .orderBy(desc(threads.updatedAt), desc(threads.id))
    .limit(MAX_CHAT_THREADS_PER_RESPONSE + 1)
    .all();

  return {
    threads: results.slice(0, MAX_CHAT_THREADS_PER_RESPONSE).map(toThread),
    truncated: results.length > MAX_CHAT_THREADS_PER_RESPONSE,
  };
}

export async function createThread(
  dbBinding: SqlDatabaseLike,
  spaceId: string,
  input: {
    title?: string;
    locale?: "ja" | "en" | null;
    idempotency_key?: string;
  },
): Promise<Thread | null> {
  const db = getDb(dbBinding);
  const id = input.idempotency_key
    ? clientOperationRowId("thread", input.idempotency_key)
    : generateId();
  const timestamp = new Date().toISOString();
  const title = normalizeThreadTitle(input.title) ?? null;
  if (
    input.locale !== undefined && input.locale !== null &&
    input.locale !== "ja" && input.locale !== "en"
  ) {
    throw new TypeError("Invalid Thread locale");
  }

  const readExistingIdempotentThread = async (): Promise<Thread | null> => {
    if (!input.idempotency_key) return null;
    const row = await db.select().from(threads).where(eq(threads.id, id)).get();
    if (!row) return null;
    if (row.accountId !== spaceId) {
      throw new ClientOperationConflictError(
        "Idempotency key already used by another Workspace",
      );
    }
    return toThread(row);
  };

  const existing = await readExistingIdempotentThread();
  if (existing) return existing;

  let result;
  try {
    result = await db
      .insert(threads)
      .values({
        id,
        accountId: spaceId,
        title,
        locale: input.locale ?? null,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning()
      .get();
  } catch (error) {
    const winner = await readExistingIdempotentThread();
    if (winner) return winner;
    throw error;
  }

  return toThread(result);
}

export async function updateThread(
  dbBinding: SqlDatabaseLike,
  threadId: string,
  updates: {
    title?: string | null;
    locale?: "ja" | "en" | null;
    context_window?: number;
  },
): Promise<Thread | null> {
  if (
    updates.title === undefined &&
    updates.locale === undefined &&
    updates.context_window === undefined
  ) {
    return null;
  }

  const db = getDb(dbBinding);
  const timestamp = new Date().toISOString();
  const normalizedTitle = normalizeThreadTitle(updates.title);

  if (
    updates.locale !== undefined && updates.locale !== null &&
    updates.locale !== "ja" && updates.locale !== "en"
  ) {
    throw new TypeError("Invalid Thread locale");
  }
  if (
    updates.context_window !== undefined &&
    (!Number.isSafeInteger(updates.context_window) ||
      updates.context_window < 20 || updates.context_window > 200)
  ) {
    throw new TypeError("Invalid Thread context window");
  }

  const data: Partial<InsertOf<typeof threads>> = { updatedAt: timestamp };

  if (normalizedTitle !== undefined) {
    data.title = normalizedTitle;
  }

  if (updates.locale !== undefined) {
    data.locale = updates.locale || null;
  }

  if (updates.context_window !== undefined) {
    data.contextWindow = updates.context_window;
  }

  const result = await db
    .update(threads)
    .set(data)
    .where(and(eq(threads.id, threadId), ne(threads.status, "deleted")))
    .returning()
    .get();

  return result ? toThread(result) : null;
}

export async function updateThreadStatus(
  dbBinding: SqlDatabaseLike,
  threadId: string,
  status: Exclude<ThreadStatus, "deleted">,
): Promise<Thread | null> {
  const db = getDb(dbBinding);
  const timestamp = new Date().toISOString();

  const result = await db
    .update(threads)
    .set({ status, updatedAt: timestamp })
    .where(and(eq(threads.id, threadId), ne(threads.status, "deleted")))
    .returning()
    .get();

  return result ? toThread(result) : null;
}

export async function deleteThread(
  _env: Env,
  dbBinding: SqlDatabaseLike,
  threadId: string,
  deletedByAccountId: string | null = null,
): Promise<boolean> {
  const db = getDb(dbBinding);
  const timestamp = new Date().toISOString();

  const result = await db
    .update(threads)
    .set({ status: "deleted", updatedAt: timestamp })
    .where(and(eq(threads.id, threadId), ne(threads.status, "deleted")))
    .returning({ id: threads.id })
    .get();

  if (result?.id !== threadId) return false;
  try {
    await retireDeletedThreadTurnProjectionsBatch(dbBinding, {
      threadId,
      deletedByAccountId,
    });
  } catch (error) {
    // The deleted Thread is already excluded from every read/execution path.
    // Hourly maintenance rediscovers its remaining projections and retries the
    // tombstone/outbox transition without trusting this response.
    logWarn("TurnProjection retirement will retry after Thread deletion", {
      module: "thread_service",
      threadId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

export async function listThreadMessages(
  env: Env,
  dbBinding: SqlDatabaseLike,
  threadId: string,
  limit: number,
  offset: number,
  options: { latest?: boolean } = {},
): Promise<{
  messages: Message[];
  total: number;
  offset: number;
  messageDataTruncated: boolean;
}> {
  if (!isValidOpaqueId(threadId)) {
    return {
      messages: [],
      total: 0,
      offset: options.latest ? 0 : offset,
      messageDataTruncated: false,
    };
  }

  const db = getDb(dbBinding);

  // SQL store does not support concurrent queries in a single request -- run
  // sequentially. Count first so a latest-page request has one canonical
  // effective offset and still returns messages in transcript order.
  const totalResult = await db
    .select({ count: count() })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .get();
  const total = totalResult?.count ?? 0;
  const effectiveOffset = options.latest
    ? Math.max(0, total - limit)
    : offset;

  const rows = await db
    .select({
      id: messages.id,
      threadId: messages.threadId,
      role: messages.role,
      content: messages.content,
      r2Key: messages.r2Key,
      toolCalls: messages.toolCalls,
      toolCallId: messages.toolCallId,
      metadata: messages.metadata,
      sequence: messages.sequence,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.sequence))
    .limit(limit)
    .offset(effectiveOffset)
    .all();

  const candidates = rows
    .map((message, index) => ({ index, key: message.r2Key }))
    .filter((candidate): candidate is { index: number; key: string } =>
      typeof candidate.key === "string" && candidate.key.length > 0
    )
    .reverse();
  let messageDataTruncated = candidates.length > 0 && !env.TAKOS_OFFLOAD;

  // Hydrate newest offloaded payloads first under one request-wide budget.
  // A missing, corrupt, or over-budget object keeps its bounded SQL preview
  // and is exposed as explicit truncation rather than silently looking full.
  if (env.TAKOS_OFFLOAD && candidates.length > 0) {
    const bucket = env.TAKOS_OFFLOAD;
    let remainingBytes = MAX_MESSAGE_PAGE_HYDRATION_BYTES;
    const concurrency = 4;
    for (let i = 0; i < candidates.length; i += concurrency) {
      if (remainingBytes <= 0) {
        messageDataTruncated = true;
        break;
      }
      const batch = candidates.slice(i, i + concurrency);
      const records = await Promise.all(
        batch.map(({ key }) => readOffloadedMessageRecord(bucket, key)),
      );
      for (let index = 0; index < batch.length; index++) {
        const candidate = batch[index];
        const record = records[index];
        const row = rows[candidate.index];
        if (
          !record || record.size > remainingBytes ||
          record.message.id !== row.id ||
          record.message.thread_id !== threadId
        ) {
          messageDataTruncated = true;
          continue;
        }
        remainingBytes -= record.size;
        rows[candidate.index] = {
          ...row,
          content: record.message.content,
          toolCalls: record.message.tool_calls,
          toolCallId: record.message.tool_call_id,
          metadata: record.message.metadata,
        };
      }
    }
  }

  return {
    messages: rows.map(toMessage),
    total,
    offset: effectiveOffset,
    messageDataTruncated,
  };
}

export async function createMessage(
  env: Env,
  dbBinding: SqlDatabaseLike,
  thread: Thread,
  input: {
    role: MessageRole;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string | null;
    metadata?: Record<string, unknown>;
    idempotency_key?: string;
    require_active_thread?: boolean;
  },
): Promise<Message | null> {
  const db = getDb(dbBinding);
  const id = input.idempotency_key
    ? clientOperationRowId("message", input.idempotency_key)
    : generateId();
  const timestamp = new Date().toISOString();
  const toolCallsStr = input.tool_calls
    ? stringifyCanonicalJson(input.tool_calls) ?? null
    : null;
  const metadataStr = stringifyCanonicalJson(input.metadata || {}) ?? "{}";
  const toolCallId = input.tool_call_id || null;

  const readExistingIdempotentMessage = async (): Promise<Message | null> => {
    if (!input.idempotency_key) return null;
    const row = await db.select({
      id: messages.id,
      threadId: messages.threadId,
      role: messages.role,
      content: messages.content,
      r2Key: messages.r2Key,
      toolCalls: messages.toolCalls,
      toolCallId: messages.toolCallId,
      metadata: messages.metadata,
      sequence: messages.sequence,
      createdAt: messages.createdAt,
    }).from(messages).where(eq(messages.id, id)).get();
    if (!row) return null;
    if (row.threadId !== thread.id) {
      throw new ClientOperationConflictError();
    }

    let persistedRow = row;
    if (row.r2Key && env.TAKOS_OFFLOAD) {
      const persisted = await readMessageFromR2(env.TAKOS_OFFLOAD, row.r2Key);
      if (persisted?.id === row.id && persisted.thread_id === thread.id) {
        persistedRow = {
          ...row,
          content: persisted.content,
          toolCalls: persisted.tool_calls,
          toolCallId: persisted.tool_call_id,
          metadata: persisted.metadata,
        };
      }
    }
    if (
      persistedRow.role !== input.role ||
      persistedRow.content !== input.content ||
      persistedRow.toolCalls !== toolCallsStr ||
      persistedRow.toolCallId !== toolCallId ||
      persistedRow.metadata !== metadataStr
    ) {
      throw new ClientOperationConflictError();
    }
    return toMessage(persistedRow);
  };

  const existing = await readExistingIdempotentMessage();
  if (existing) return existing;

  if (input.require_active_thread) {
    const current = await db.select({ status: threads.status }).from(threads)
      .where(eq(threads.id, thread.id)).get();
    if (current?.status !== "active") {
      throw new ArchivedThreadWriteError();
    }
  }

  let sequence = -1;
  const maxSequenceAttempts = 16;
  for (let attempt = 0; attempt < maxSequenceAttempts; attempt++) {
    let reservedSequence: number | null;
    try {
      reservedSequence = await reserveThreadMessageSequence(
        dbBinding,
        thread.id,
        1,
        { requireActive: input.require_active_thread === true },
      );
    } catch (error) {
      if (
        input.require_active_thread &&
        error instanceof ThreadMessageSequenceUnavailableError
      ) {
        throw new ArchivedThreadWriteError();
      }
      throw error;
    }
    const agg =
      reservedSequence === null
        ? await db
            .select({ maxSeq: max(messages.sequence) })
            .from(messages)
            .where(eq(messages.threadId, thread.id))
            .get()
        : null;
    sequence = reservedSequence ?? (agg?.maxSeq ?? -1) + 1;

    let r2Key: string | null = null;
    let contentForD1 = input.content;
    let toolCallsForD1: string | null = toolCallsStr;
    const offloadBucket = env.TAKOS_OFFLOAD;
    if (
      !input.idempotency_key &&
      offloadBucket &&
      shouldOffloadMessage({ role: input.role, content: input.content })
    ) {
      try {
        const { key } = await writeMessageToR2(offloadBucket, thread.id, id, {
          id,
          thread_id: thread.id,
          role: input.role,
          content: input.content,
          tool_calls: toolCallsStr,
          tool_call_id: input.tool_call_id || null,
          metadata: metadataStr,
          sequence,
          created_at: timestamp,
        });
        r2Key = key;
        contentForD1 = makeMessagePreview(input.content);
        toolCallsForD1 = null;
      } catch (err) {
        logWarn(
          `Failed to persist message ${id} to object store, storing inline`,
          { module: "message_offload", detail: err },
        );
      }
    }

    const createData: InsertOf<typeof messages> = {
      id,
      threadId: thread.id,
      role: input.role,
      content: contentForD1,
      toolCalls: toolCallsForD1,
      toolCallId,
      metadata: metadataStr,
      sequence,
      createdAt: timestamp,
      ...(r2Key ? { r2Key } : {}),
    };
    try {
      await db.insert(messages).values(createData);
      break;
    } catch (error) {
      const idempotentWinner = await readExistingIdempotentMessage();
      if (idempotentWinner) return idempotentWinner;
      const detail = [
        error instanceof Error ? error.message : String(error),
        error instanceof Error && error.cause instanceof Error
          ? error.cause.message
          : "",
      ].join(" ");
      const sequenceConflict =
        detail.includes("idx_messages_thread_sequence") ||
        (detail.includes("UNIQUE") &&
          detail.includes("thread_id") &&
          detail.includes("sequence"));
      if (!sequenceConflict || attempt === maxSequenceAttempts - 1) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(100, 5 * 2 ** attempt)),
      );
    }
  }

  // Update thread's updatedAt (non-critical, don't let failure block message creation)
  try {
    await db
      .update(threads)
      .set({ updatedAt: timestamp })
      .where(eq(threads.id, thread.id));
  } catch (err) {
    logWarn("Failed to update thread updatedAt", {
      module: "services/threads/thread-service",
      detail: err,
    });
  }

  // Auto-set title from first user message
  if (input.role === "user" && sequence === 0 && !thread.title) {
    const autoTitle =
      input.content.slice(0, 50) + (input.content.length > 50 ? "..." : "");
    try {
      await db
        .update(threads)
        .set({ title: autoTitle, updatedAt: timestamp })
        .where(eq(threads.id, thread.id));
    } catch (err) {
      logWarn("Failed to auto-set thread title", {
        module: "services/threads/thread-service",
        detail: err,
      });
    }
  }

  return {
    id,
    thread_id: thread.id,
    role: input.role,
    content: input.content,
    tool_calls: toolCallsStr,
    tool_call_id: input.tool_call_id || null,
    metadata: metadataStr,
    sequence,
    created_at: timestamp,
  };
}
