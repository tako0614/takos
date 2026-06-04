import type {
  AiBinding,
  SqlDatabaseBinding,
  ThreadStatus,
  VectorIndexBinding,
} from "takos-api-contract/shared/types";
import { asRecord } from "../api/common.ts";
import { readSpaceMembershipRole } from "../spaces/access.ts";
import { readThreadAccess } from "./read-model.ts";

export type ThreadSearchEnv = {
  DB: SqlDatabaseBinding;
  AI?: AiBinding;
  VECTORIZE?: VectorIndexBinding;
};

export type SearchOptions = {
  query: string;
  type: string;
  limit: number;
  offset: number;
};

type SearchMatch = { start: number; end: number };

type SpaceThreadSearchResult = {
  kind: "keyword" | "semantic";
  score?: number;
  thread: {
    id: string;
    title: string | null;
    status: ThreadStatus;
    updated_at: string;
    created_at: string;
  };
  message: {
    id: string;
    sequence: number;
    role: string;
    created_at: string;
  };
  snippet: string;
  match?: SearchMatch | null;
};

type ThreadMessageSearchResult = {
  kind: "keyword" | "semantic";
  score?: number;
  message: {
    id: string;
    sequence: number;
    role: string;
    created_at: string;
  };
  snippet: string;
  match?: SearchMatch | null;
};

type ThreadSearchRow = {
  threadId: string;
  threadTitle: string | null;
  threadStatus: string;
  threadCreatedAt: string | Date;
  threadUpdatedAt: string | Date;
  messageId: string;
  messageRole: string;
  messageContent: string;
  messageSequence: number;
  messageCreatedAt: string | Date;
};

type MessageSearchRow = {
  id: string;
  role: string;
  content: string;
  sequence: number;
  createdAt: string | Date;
};

const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const THREAD_MESSAGE_VECTOR_KIND = "thread_message";

export async function searchSpaceThreads(
  env: ThreadSearchEnv,
  spaceId: string,
  actorAccountId: string,
  options: SearchOptions,
) {
  const role = await readSpaceMembershipRole(
    env.DB,
    spaceId,
    actorAccountId,
  );
  if (!role) return null;

  const semanticAvailable = Boolean(env.AI && env.VECTORIZE);
  const results: SpaceThreadSearchResult[] = [];

  if (
    (options.type === "semantic" || options.type === "all") &&
    semanticAvailable &&
    env.AI &&
    env.VECTORIZE
  ) {
    try {
      const semanticEnv = { ...env, AI: env.AI, VECTORIZE: env.VECTORIZE };
      results.push(
        ...await searchSpaceThreadsSemantic(semanticEnv, spaceId, options),
      );
    } catch {
      // Keyword search is the durable fallback when semantic search fails.
    }
  }

  if (options.type === "keyword" || options.type === "all") {
    results.push(...await searchSpaceThreadsKeyword(env.DB, spaceId, options));
  }

  const seen = new Set<string>();
  const deduped = results.filter((result) => {
    const key = `${result.thread.id}:${result.message.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    query: options.query,
    type: options.type,
    results: deduped.slice(0, options.limit),
    limit: options.limit,
    offset: options.offset,
    semantic_available: semanticAvailable,
  };
}

export async function searchThreadMessages(
  env: ThreadSearchEnv,
  threadId: string,
  actorAccountId: string,
  options: SearchOptions,
) {
  const access = await readThreadAccess(env.DB, threadId, actorAccountId);
  if (!access) return null;

  const semanticAvailable = Boolean(env.AI && env.VECTORIZE);
  const results: ThreadMessageSearchResult[] = [];

  if (
    (options.type === "semantic" || options.type === "all") &&
    semanticAvailable &&
    env.AI &&
    env.VECTORIZE
  ) {
    try {
      const semanticEnv = { ...env, AI: env.AI, VECTORIZE: env.VECTORIZE };
      results.push(
        ...await searchThreadMessagesSemantic(
          semanticEnv,
          access.thread.space_id,
          threadId,
          options,
        ),
      );
    } catch {
      // Keyword search is the durable fallback when semantic search fails.
    }
  }

  if (options.type === "keyword" || options.type === "all") {
    results.push(
      ...await searchThreadMessagesKeyword(env.DB, threadId, options),
    );
  }

  const seenSeq = new Set<number>();
  const deduped = results.filter((result) => {
    if (seenSeq.has(result.message.sequence)) return false;
    seenSeq.add(result.message.sequence);
    return true;
  });

  return {
    query: options.query,
    type: options.type,
    results: deduped.slice(0, options.limit),
    limit: options.limit,
    offset: options.offset,
    semantic_available: semanticAvailable,
  };
}

async function searchSpaceThreadsKeyword(
  db: SqlDatabaseBinding,
  spaceId: string,
  options: SearchOptions,
): Promise<SpaceThreadSearchResult[]> {
  const rows = await db.prepare(`
    SELECT
      t.id AS threadId,
      t.title AS threadTitle,
      t.status AS threadStatus,
      t.created_at AS threadCreatedAt,
      t.updated_at AS threadUpdatedAt,
      m.id AS messageId,
      m.role AS messageRole,
      m.content AS messageContent,
      m.sequence AS messageSequence,
      m.created_at AS messageCreatedAt
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    WHERE t.account_id = ?
      AND t.status != 'deleted'
      AND m.content LIKE ? ESCAPE '\'
    ORDER BY m.created_at DESC
    LIMIT ?
    OFFSET ?
  `).bind(spaceId, likePattern(options.query), options.limit, options.offset)
    .all<Record<string, unknown>>();

  return rows.results.map((row) =>
    toSpaceSearchResult(asThreadSearchRow(row), options.query)
  );
}

async function searchThreadMessagesKeyword(
  db: SqlDatabaseBinding,
  threadId: string,
  options: SearchOptions,
): Promise<ThreadMessageSearchResult[]> {
  const rows = await db.prepare(`
    SELECT
      id,
      role,
      content,
      sequence,
      created_at AS createdAt
    FROM messages
    WHERE thread_id = ?
      AND content LIKE ? ESCAPE '\'
    ORDER BY sequence ASC
    LIMIT ?
    OFFSET ?
  `).bind(threadId, likePattern(options.query), options.limit, options.offset)
    .all<Record<string, unknown>>();

  return rows.results.map((row) =>
    toThreadMessageSearchResult(asMessageSearchRow(row), options.query)
  );
}

async function searchSpaceThreadsSemantic(
  env: Required<Pick<ThreadSearchEnv, "AI" | "VECTORIZE">> & ThreadSearchEnv,
  spaceId: string,
  options: SearchOptions,
): Promise<SpaceThreadSearchResult[]> {
  const queryEmbedding = await generateEmbedding(env.AI, options.query);
  const search = await env.VECTORIZE.query(queryEmbedding, {
    topK: Math.max(10, options.limit * 2),
    filter: { kind: THREAD_MESSAGE_VECTOR_KIND, spaceId },
    returnMetadata: "all",
  }) as {
    matches: Array<{ id: string; score: number; metadata?: unknown }>;
  };

  const matches = (search.matches || []).filter((match) =>
    typeof match.score === "number"
  );
  const threadIds = Array.from(
    new Set(
      matches
        .map((match) => metadataString(match.metadata, "threadId"))
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const threadRows = await readThreadsById(env.DB, spaceId, threadIds);
  const threadMap = new Map(
    threadRows.map((thread) => [thread.threadId, thread]),
  );

  const results: SpaceThreadSearchResult[] = [];
  for (const match of matches) {
    const threadId = metadataString(match.metadata, "threadId");
    const messageId = metadataString(match.metadata, "messageId");
    const sequence = metadataNumber(match.metadata, "sequence");
    if (!threadId || !messageId || sequence === null) continue;

    const thread = threadMap.get(threadId);
    if (!thread || thread.threadStatus === "deleted") continue;

    results.push({
      kind: "semantic",
      score: match.score,
      thread: {
        id: thread.threadId,
        title: thread.threadTitle,
        status: thread.threadStatus as ThreadStatus,
        created_at: toIsoString(thread.threadCreatedAt),
        updated_at: toIsoString(thread.threadUpdatedAt),
      },
      message: {
        id: messageId,
        sequence,
        role: metadataString(match.metadata, "role") ?? "unknown",
        created_at: metadataString(match.metadata, "createdAt") ?? "",
      },
      snippet: metadataString(match.metadata, "content") ?? "",
      match: null,
    });
    if (results.length >= options.limit) break;
  }
  return results;
}

async function searchThreadMessagesSemantic(
  env: Required<Pick<ThreadSearchEnv, "AI" | "VECTORIZE">> & ThreadSearchEnv,
  spaceId: string,
  threadId: string,
  options: SearchOptions,
): Promise<ThreadMessageSearchResult[]> {
  const queryEmbedding = await generateEmbedding(env.AI, options.query);
  const search = await env.VECTORIZE.query(queryEmbedding, {
    topK: Math.max(10, options.limit * 3),
    filter: { kind: THREAD_MESSAGE_VECTOR_KIND, spaceId, threadId },
    returnMetadata: "all",
  }) as {
    matches: Array<{ id: string; score: number; metadata?: unknown }>;
  };

  const results: ThreadMessageSearchResult[] = [];
  const seenSeq = new Set<number>();
  for (const match of search.matches || []) {
    if (match.score < 0.35) continue;
    const sequence = metadataNumber(match.metadata, "sequence");
    const content = metadataString(match.metadata, "content");
    if (sequence === null || !content || seenSeq.has(sequence)) continue;
    seenSeq.add(sequence);
    results.push({
      kind: "semantic",
      score: match.score,
      message: {
        id: metadataString(match.metadata, "messageId") ?? match.id,
        sequence,
        role: metadataString(match.metadata, "role") ?? "unknown",
        created_at: metadataString(match.metadata, "createdAt") ?? "",
      },
      snippet: content,
      match: null,
    });
    if (results.length >= options.limit) break;
  }
  return results;
}

async function readThreadsById(
  db: SqlDatabaseBinding,
  spaceId: string,
  threadIds: string[],
): Promise<
  Array<
    Pick<
      ThreadSearchRow,
      | "threadId"
      | "threadTitle"
      | "threadStatus"
      | "threadCreatedAt"
      | "threadUpdatedAt"
    >
  >
> {
  if (threadIds.length === 0) return [];
  const placeholders = threadIds.map(() => "?").join(", ");
  const rows = await db.prepare(`
    SELECT
      id AS threadId,
      title AS threadTitle,
      status AS threadStatus,
      created_at AS threadCreatedAt,
      updated_at AS threadUpdatedAt
    FROM threads
    WHERE account_id = ? AND id IN (${placeholders})
  `).bind(spaceId, ...threadIds).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    threadId: stringField(row, "threadId"),
    threadTitle: nullableStringField(row, "threadTitle"),
    threadStatus: stringField(row, "threadStatus"),
    threadCreatedAt: dateField(row, "threadCreatedAt"),
    threadUpdatedAt: dateField(row, "threadUpdatedAt"),
  }));
}

async function generateEmbedding(
  ai: AiBinding,
  query: string,
): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL, { text: [query] }) as {
    data?: number[][];
  };
  const embedding = result.data?.[0];
  if (!embedding) {
    throw new Error(
      `Failed to generate embedding (model=${EMBEDDING_MODEL}, queryLength=${query.length}): AI returned no data[0]`,
    );
  }
  return embedding;
}

function toSpaceSearchResult(
  row: ThreadSearchRow,
  query: string,
): SpaceThreadSearchResult {
  const snippet = buildSnippet(row.messageContent, query);
  return {
    kind: "keyword",
    thread: {
      id: row.threadId,
      title: row.threadTitle,
      status: row.threadStatus as ThreadStatus,
      created_at: toIsoString(row.threadCreatedAt),
      updated_at: toIsoString(row.threadUpdatedAt),
    },
    message: {
      id: row.messageId,
      sequence: row.messageSequence,
      role: row.messageRole,
      created_at: toIsoString(row.messageCreatedAt),
    },
    snippet: snippet.snippet,
    match: snippet.match,
  };
}

function toThreadMessageSearchResult(
  row: MessageSearchRow,
  query: string,
): ThreadMessageSearchResult {
  const snippet = buildSnippet(row.content, query);
  return {
    kind: "keyword",
    message: {
      id: row.id,
      sequence: row.sequence,
      role: row.role,
      created_at: toIsoString(row.createdAt),
    },
    snippet: snippet.snippet,
    match: snippet.match,
  };
}

function buildSnippet(
  content: string,
  query: string,
): { snippet: string; match: SearchMatch | null } {
  const haystack = content || "";
  const needle = query || "";
  if (!haystack || !needle) {
    return { snippet: haystack.slice(0, 240), match: null };
  }

  const index = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return { snippet: haystack.slice(0, 240), match: null };

  const radius = 90;
  const start = Math.max(0, index - radius);
  const end = Math.min(haystack.length, index + needle.length + radius);
  const snippet = (start > 0 ? "\u2026" : "") +
    haystack.slice(start, end) +
    (end < haystack.length ? "\u2026" : "");
  const prefixLength = start > 0 ? 1 : 0;
  return {
    snippet,
    match: {
      start: prefixLength + (index - start),
      end: prefixLength + (index - start) + needle.length,
    },
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function likePattern(value: string): string {
  return `%${escapeLike(value)}%`;
}

function metadataString(metadata: unknown, key: string): string | null {
  const value = asRecord(metadata)?.[key];
  return typeof value === "string" ? value : null;
}

function metadataNumber(metadata: unknown, key: string): number | null {
  const value = asRecord(metadata)?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asThreadSearchRow(row: Record<string, unknown>): ThreadSearchRow {
  return {
    threadId: stringField(row, "threadId"),
    threadTitle: nullableStringField(row, "threadTitle"),
    threadStatus: stringField(row, "threadStatus"),
    threadCreatedAt: dateField(row, "threadCreatedAt"),
    threadUpdatedAt: dateField(row, "threadUpdatedAt"),
    messageId: stringField(row, "messageId"),
    messageRole: stringField(row, "messageRole"),
    messageContent: stringField(row, "messageContent"),
    messageSequence: numberField(row, "messageSequence"),
    messageCreatedAt: dateField(row, "messageCreatedAt"),
  };
}

function asMessageSearchRow(row: Record<string, unknown>): MessageSearchRow {
  return {
    id: stringField(row, "id"),
    role: stringField(row, "role"),
    content: stringField(row, "content"),
    sequence: numberField(row, "sequence"),
    createdAt: dateField(row, "createdAt"),
  };
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Search row field ${key} must be a string`);
}

function nullableStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new TypeError(`Search row field ${key} must be a string or null`);
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  throw new TypeError(`Search row field ${key} must be a number`);
}

function dateField(row: Record<string, unknown>, key: string): string | Date {
  const value = row[key];
  if (typeof value === "string" || value instanceof Date) return value;
  throw new TypeError(`Search row field ${key} must be a date`);
}

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}
