import type {
  Message,
  MessageRole,
  ObjectStoreBinding,
  Run,
  SqlDatabaseBinding,
} from "takos-api-contract/shared/types";
import { asRunRow, runRowToApi } from "takos-api-contract/shared/types/runs";
import { generateId } from "@takos/worker-platform-utils/id";
import { isRecord } from "../api/common.ts";
import { readThreadAccess } from "./read-model.ts";

export type ListThreadMessagesOptions = {
  limit: number;
  offset: number;
  offload?: ObjectStoreBinding;
};

export type ListThreadMessagesResult = {
  messages: Message[];
  total: number;
  runs: Run[];
};

export type CreateThreadMessageInput = {
  role: MessageRole;
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type CreateThreadMessageOptions = {
  offload?: ObjectStoreBinding;
};

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
  createdAt: string | Date;
};

type PersistedMessage = {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  metadata: string;
  sequence: number;
  created_at: string;
};

const MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS = 4000;
const MESSAGE_PREVIEW_MAX_CHARS = 800;

export async function listThreadMessages(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
  options: ListThreadMessagesOptions,
): Promise<ListThreadMessagesResult | null> {
  const access = await readThreadAccess(db, threadId, actorAccountId);
  if (!access) return null;

  const rows = (await db.prepare(`
    SELECT
      id,
      thread_id AS threadId,
      role,
      content,
      r2_key AS r2Key,
      tool_calls AS toolCalls,
      tool_call_id AS toolCallId,
      metadata,
      sequence,
      created_at AS createdAt
    FROM messages
    WHERE thread_id = ?
    ORDER BY sequence ASC
    LIMIT ?
    OFFSET ?
  `).bind(threadId, options.limit, options.offset).all<
    Record<string, unknown>
  >())
    .results.map(asMessageRow);

  const totalRow = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM messages
    WHERE thread_id = ?
  `).bind(threadId).first<{ count: number | bigint | string }>();
  const total = Number(totalRow?.count ?? 0);

  const runRows = await db.prepare(`
    SELECT
      id,
      thread_id AS threadId,
      account_id AS spaceId,
      session_id AS sessionId,
      parent_run_id AS parentRunId,
      child_thread_id AS childThreadId,
      root_thread_id AS rootThreadId,
      root_run_id AS rootRunId,
      agent_type AS agentType,
      status,
      input,
      output,
      error,
      usage,
      service_id AS serviceId,
      service_heartbeat AS serviceHeartbeat,
      started_at AS startedAt,
      completed_at AS completedAt,
      created_at AS createdAt
    FROM runs
    WHERE thread_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).bind(threadId).all<Record<string, unknown>>();

  if (options.offload) {
    await hydrateOffloadedMessages(options.offload, threadId, rows);
  }

  return {
    messages: rows.map(messageRowToApi),
    total,
    runs: runRows.results.map((row) => runRowToApi(asRunRow(row))),
  };
}

export async function createThreadMessage(
  db: SqlDatabaseBinding,
  threadId: string,
  actorAccountId: string,
  input: CreateThreadMessageInput,
  options: CreateThreadMessageOptions = {},
): Promise<Message | null> {
  const access = await readThreadAccess(db, threadId, actorAccountId, [
    "owner",
    "admin",
    "editor",
  ]);
  if (!access) return null;

  const maxRow = await db.prepare(`
    SELECT MAX(sequence) AS maxSeq
    FROM messages
    WHERE thread_id = ?
  `).bind(threadId).first<{ maxSeq: number | bigint | null }>();
  const sequence = Number(maxRow?.maxSeq ?? -1) + 1;
  const id = generateId();
  const timestamp = new Date().toISOString();
  const toolCalls = input.tool_calls ? JSON.stringify(input.tool_calls) : null;
  const metadata = JSON.stringify(input.metadata ?? {});

  let r2Key: string | null = null;
  let contentForSql = input.content;
  let toolCallsForSql = toolCalls;

  if (
    options.offload &&
    shouldOffloadMessage({ role: input.role, content: input.content })
  ) {
    try {
      r2Key = await writeMessageToObjectStore(options.offload, threadId, id, {
        id,
        thread_id: threadId,
        role: input.role,
        content: input.content,
        tool_calls: toolCalls,
        tool_call_id: input.tool_call_id ?? null,
        metadata,
        sequence,
        created_at: timestamp,
      });
      contentForSql = makeMessagePreview(input.content);
      toolCallsForSql = null;
    } catch {
      r2Key = null;
      contentForSql = input.content;
      toolCallsForSql = toolCalls;
    }
  }

  await db.prepare(`
    INSERT INTO messages (
      id,
      thread_id,
      role,
      content,
      r2_key,
      tool_calls,
      tool_call_id,
      metadata,
      sequence,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    threadId,
    input.role,
    contentForSql,
    r2Key,
    toolCallsForSql,
    input.tool_call_id ?? null,
    metadata,
    sequence,
    timestamp,
  ).run();

  await db.prepare(`
    UPDATE threads
    SET updated_at = ?
    WHERE id = ?
  `).bind(timestamp, threadId).run();

  if (input.role === "user" && sequence === 0 && !access.thread.title) {
    await db.prepare(`
      UPDATE threads
      SET title = ?, updated_at = ?
      WHERE id = ?
    `).bind(autoTitle(input.content), timestamp, threadId).run();
  }

  return {
    id,
    thread_id: threadId,
    role: input.role,
    content: contentForSql,
    tool_calls: toolCallsForSql,
    tool_call_id: input.tool_call_id ?? null,
    metadata,
    sequence,
    created_at: timestamp,
  };
}

async function hydrateOffloadedMessages(
  bucket: ObjectStoreBinding,
  threadId: string,
  rows: MessageRow[],
): Promise<void> {
  const candidates = rows
    .map((message, index) => ({ index, key: message.r2Key }))
    .filter((candidate): candidate is { index: number; key: string } =>
      typeof candidate.key === "string" && candidate.key.length > 0
    );

  const concurrency = 20;
  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    const batch = candidates.slice(offset, offset + concurrency);
    await Promise.all(batch.map(async ({ index, key }) => {
      const persisted = await readMessageFromObjectStore(bucket, key);
      if (!persisted) return;
      if (persisted.id !== rows[index].id) return;
      if (persisted.thread_id !== threadId) return;
      rows[index] = {
        ...rows[index],
        content: persisted.content,
        toolCalls: persisted.tool_calls,
        toolCallId: persisted.tool_call_id,
        metadata: persisted.metadata,
      };
    }));
  }
}

function shouldOffloadMessage(input: { role: MessageRole; content: string }) {
  return input.role === "tool" ||
    input.content.length > MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS;
}

function makeMessagePreview(content: string): string {
  if (content.length <= MESSAGE_PREVIEW_MAX_CHARS) return content;
  return `${content.slice(0, MESSAGE_PREVIEW_MAX_CHARS)}...`;
}

function autoTitle(content: string): string {
  const codepoints = Array.from(content);
  if (codepoints.length <= 50) return content;
  return codepoints.slice(0, 50).join("") + "...";
}

async function writeMessageToObjectStore(
  bucket: ObjectStoreBinding,
  threadId: string,
  messageId: string,
  payload: PersistedMessage,
): Promise<string> {
  const key = `threads/${threadId}/messages/${messageId}.json`;
  await bucket.put(key, JSON.stringify(payload), {
    httpMetadata: { contentType: "application/json" },
  });
  return key;
}

async function readMessageFromObjectStore(
  bucket: ObjectStoreBinding,
  key: string,
): Promise<PersistedMessage | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  try {
    const parsed = JSON.parse(await object.text()) as unknown;
    if (!isRecord(parsed)) return null;
    if (typeof parsed.id !== "string") return null;
    if (typeof parsed.thread_id !== "string") return null;
    if (typeof parsed.role !== "string") return null;
    if (typeof parsed.content !== "string") return null;
    return {
      id: parsed.id,
      thread_id: parsed.thread_id,
      role: parsed.role as MessageRole,
      content: parsed.content,
      tool_calls: nullableStringField(parsed, "tool_calls"),
      tool_call_id: nullableStringField(parsed, "tool_call_id"),
      metadata: typeof parsed.metadata === "string" ? parsed.metadata : "{}",
      sequence: typeof parsed.sequence === "number" ? parsed.sequence : 0,
      created_at: typeof parsed.created_at === "string"
        ? parsed.created_at
        : "",
    };
  } catch {
    return null;
  }
}

function messageRowToApi(row: MessageRow): Message {
  return {
    id: row.id,
    thread_id: row.threadId,
    role: row.role as MessageRole,
    content: row.content,
    tool_calls: row.toolCalls,
    tool_call_id: row.toolCallId,
    metadata: row.metadata,
    sequence: row.sequence,
    created_at: toIsoString(row.createdAt),
  };
}

function asMessageRow(row: Record<string, unknown>): MessageRow {
  return {
    id: stringField(row, "id"),
    threadId: stringField(row, "threadId"),
    role: stringField(row, "role"),
    content: stringField(row, "content"),
    r2Key: nullableStringField(row, "r2Key"),
    toolCalls: nullableStringField(row, "toolCalls"),
    toolCallId: nullableStringField(row, "toolCallId"),
    metadata: stringField(row, "metadata"),
    sequence: numberField(row, "sequence"),
    createdAt: dateField(row, "createdAt"),
  };
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Message row field ${key} must be a string`);
}

function nullableStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new TypeError(`Message row field ${key} must be a string or null`);
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new TypeError(`Message row field ${key} must be a number`);
}

function dateField(row: Record<string, unknown>, key: string): string | Date {
  const value = row[key];
  if (typeof value === "string" || value instanceof Date) return value;
  throw new TypeError(`Message row field ${key} must be a date`);
}

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}
