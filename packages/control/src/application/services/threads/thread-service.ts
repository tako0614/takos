import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Env, Message, MessageRole, Run, RunStatus, Thread, ThreadStatus, SpaceRole } from '../../../shared/types';
import { checkSpaceAccess, generateId, now, toIsoString } from '../../../shared/utils';
import { getDb, threads, messages, runs } from '../../../infra/db';
import { eq, and, ne, desc, asc, count, max, sql } from 'drizzle-orm';
import { isValidOpaqueId } from '../../../shared/utils/db-guards';
import { makeMessagePreview, readMessageFromR2, shouldOffloadMessage, writeMessageToR2 } from '../offload/messages';
import { logWarn } from '../../../shared/utils/logger';

export interface ThreadAccess {
  thread: Thread;
  role: SpaceRole;
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

function toThread(t: typeof threads.$inferSelect): Thread {
  return {
    id: t.id,
    space_id: t.accountId,
    title: t.title ?? null,
    locale: (t.locale === 'ja' || t.locale === 'en') ? t.locale : null,
    status: t.status as ThreadStatus,
    summary: t.summary ?? null,
    key_points: t.keyPoints ?? '[]',
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

function toRun(r: typeof runs.$inferSelect): Run {
  const rootThreadId = r.rootThreadId ?? r.threadId;
  const rootRunId = r.rootRunId ?? r.id;
  return {
    id: r.id,
    thread_id: r.threadId,
    space_id: r.accountId,
    session_id: r.sessionId ?? null,
    parent_run_id: r.parentRunId ?? null,
    child_thread_id: r.childThreadId ?? null,
    root_thread_id: rootThreadId,
    root_run_id: rootRunId,
    agent_type: r.agentType,
    status: r.status as RunStatus,
    input: r.input,
    output: r.output ?? null,
    error: r.error ?? null,
    usage: r.usage,
    worker_id: r.serviceId ?? null,
    worker_heartbeat: r.serviceHeartbeat ?? null,
    started_at: r.startedAt ?? null,
    completed_at: r.completedAt ?? null,
    created_at: r.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Exported service functions
// ---------------------------------------------------------------------------

export async function checkThreadAccess(
  dbBinding: D1Database,
  threadId: string,
  userId: string,
  requiredRole?: SpaceRole[]
): Promise<ThreadAccess | null> {
  if (!isValidOpaqueId(threadId) || !isValidOpaqueId(userId)) {
    return null;
  }

  const db = getDb(dbBinding);
  const row = await db.select().from(threads).where(eq(threads.id, threadId)).get();

  if (!row) {
    return null;
  }

  const thread = toThread(row);

  const access = await checkSpaceAccess(dbBinding, thread.space_id, userId, requiredRole);
  if (!access) {
    return null;
  }

  return { thread, role: access.membership.role };
}

export async function listThreads(
  dbBinding: D1Database,
  spaceId: string,
  options: { status?: ThreadStatus }
): Promise<Thread[]> {
  const db = getDb(dbBinding);

  const conditions = [eq(threads.accountId, spaceId)];

  if (options.status) {
    conditions.push(eq(threads.status, options.status));
  } else {
    conditions.push(ne(threads.status, 'deleted'));
  }

  const results = await db.select().from(threads)
    .where(and(...conditions))
    .orderBy(desc(threads.updatedAt))
    .all();

  return results.map(toThread);
}

export async function createThread(
  dbBinding: D1Database,
  spaceId: string,
  input: { title?: string; locale?: 'ja' | 'en' | null }
): Promise<Thread | null> {
  const db = getDb(dbBinding);
  const id = generateId();
  const timestamp = now();
  const title = input.title || null;

  const result = await db.insert(threads).values({
    id,
    accountId: spaceId,
    title,
    locale: input.locale ?? null,
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning().get();

  return toThread(result);
}

export async function updateThread(
  dbBinding: D1Database,
  threadId: string,
  updates: { title?: string | null; locale?: 'ja' | 'en' | null; status?: ThreadStatus; context_window?: number }
): Promise<Thread | null> {
  if (updates.title === undefined && updates.locale === undefined && !updates.status && updates.context_window === undefined) {
    return null;
  }

  const db = getDb(dbBinding);
  const timestamp = now();

  const data: Partial<typeof threads.$inferInsert> = { updatedAt: timestamp };

  if (updates.title !== undefined) {
    data.title = updates.title || null;
  }

  if (updates.locale !== undefined) {
    data.locale = updates.locale || null;
  }

  if (updates.status) {
    data.status = updates.status;
  }

  if (updates.context_window !== undefined) {
    data.contextWindow = updates.context_window;
  }

  const result = await db.update(threads)
    .set(data)
    .where(eq(threads.id, threadId))
    .returning()
    .get();

  return result ? toThread(result) : null;
}

export async function updateThreadStatus(
  dbBinding: D1Database,
  threadId: string,
  status: ThreadStatus
): Promise<void> {
  const db = getDb(dbBinding);
  const timestamp = now();

  await db.update(threads)
    .set({ status, updatedAt: timestamp })
    .where(eq(threads.id, threadId));
}

export async function listThreadMessages(
  env: Env,
  dbBinding: D1Database,
  threadId: string,
  limit: number,
  offset: number
): Promise<{ messages: Message[]; total: number; runs: Run[] }> {
  if (!isValidOpaqueId(threadId)) {
    return { messages: [], total: 0, runs: [] };
  }

  const db = getDb(dbBinding);

  // D1 does not support concurrent queries in a single request -- run sequentially
  const rows = await db.select({
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
  }).from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.sequence))
    .limit(limit)
    .offset(offset)
    .all();

  const totalResult = await db.select({ count: count() }).from(messages)
    .where(eq(messages.threadId, threadId))
    .get();
  const total = totalResult?.count ?? 0;

  const runRows = await db.select().from(runs)
    .where(eq(runs.threadId, threadId))
    .orderBy(desc(runs.createdAt))
    .limit(10)
    .all();

  // Hydrate offloaded message payloads from R2 (best-effort).
  if (env.TAKOS_OFFLOAD) {
    const bucket = env.TAKOS_OFFLOAD;
    const candidates = rows
      .map((m, idx) => ({ idx, key: m.r2Key }))
      .filter((x) => typeof x.key === 'string' && x.key.length > 0) as Array<{ idx: number; key: string }>;

    const concurrency = 20;
    for (let i = 0; i < candidates.length; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency);
      await Promise.all(batch.map(async ({ idx, key }) => {
        const persisted = await readMessageFromR2(bucket, key);
        if (!persisted) return;
        if (persisted.id !== rows[idx].id) return;
        if (persisted.thread_id !== threadId) return;
        rows[idx] = {
          ...rows[idx],
          content: persisted.content,
          toolCalls: persisted.tool_calls,
          toolCallId: persisted.tool_call_id,
          metadata: persisted.metadata,
        };
      }));
    }
  }

  return {
    messages: rows.map(toMessage),
    total,
    runs: runRows.map(toRun),
  };
}

export async function createMessage(
  env: Env,
  dbBinding: D1Database,
  thread: Thread,
  input: {
    role: MessageRole;
    content: string;
    tool_calls?: unknown[];
    tool_call_id?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<Message | null> {
  const db = getDb(dbBinding);

  const agg = await db.select({ maxSeq: max(messages.sequence) }).from(messages)
    .where(eq(messages.threadId, thread.id))
    .get();

  const sequence = (agg?.maxSeq ?? -1) + 1;
  const id = generateId();
  const timestamp = now();
  const toolCallsStr = input.tool_calls ? JSON.stringify(input.tool_calls) : null;
  const metadataStr = JSON.stringify(input.metadata || {});

  let r2Key: string | null = null;
  let contentForD1 = input.content;
  let toolCallsForD1: string | null = toolCallsStr;

  const offloadBucket = env.TAKOS_OFFLOAD;
  if (offloadBucket && shouldOffloadMessage({ role: input.role, content: input.content })) {
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
      // Keep D1 small; hydrate from R2 on read.
      toolCallsForD1 = null;
    } catch (err) {
      logWarn(`Failed to persist message ${id} to R2, storing inline`, { module: 'message_offload', detail: err });
    }
  }

  const createData: typeof messages.$inferInsert = {
    id,
    threadId: thread.id,
    role: input.role,
    content: contentForD1,
    toolCalls: toolCallsForD1,
    toolCallId: input.tool_call_id || null,
    metadata: metadataStr,
    sequence,
    createdAt: timestamp,
  };
  if (r2Key) {
    createData.r2Key = r2Key;
  }

  await db.insert(messages).values(createData);

  // Update thread's updatedAt (non-critical, don't let failure block message creation)
  try {
    await db.update(threads)
      .set({ updatedAt: timestamp })
      .where(eq(threads.id, thread.id));
  } catch (err) {
    logWarn('Failed to update thread updatedAt', { module: 'services/threads/thread-service', detail: err });
  }

  // Auto-set title from first user message
  if (input.role === 'user' && sequence === 0 && !thread.title) {
    const autoTitle = input.content.slice(0, 50) + (input.content.length > 50 ? '...' : '');
    try {
      await db.update(threads)
        .set({ title: autoTitle, updatedAt: timestamp })
        .where(eq(threads.id, thread.id));
    } catch (err) {
      logWarn('Failed to auto-set thread title', { module: 'services/threads/thread-service', detail: err });
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
