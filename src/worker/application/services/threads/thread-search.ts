import { accounts, getDb, messages, threads } from "../../../infra/db/index.ts";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  buildThreadMessageVectorId,
  parseThreadMessageVectorReference,
  queryRelevantThreadMessages,
  THREAD_MESSAGE_VECTOR_KIND,
} from "../agent/index.ts";
import type { Env, ThreadStatus } from "../../../shared/types/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { EMBEDDING_MODEL } from "../../../shared/config/limits.ts";

export const threadSearchDeps = {
  getDb,
  queryRelevantThreadMessages,
  logWarn,
};

export type ThreadSearchType = "all" | "keyword" | "semantic";

function buildSnippet(
  content: string,
  query: string,
): { snippet: string; match: { start: number; end: number } | null } {
  const hay = content || "";
  const needle = query || "";
  if (!hay || !needle) return { snippet: hay.slice(0, 240), match: null };

  const lowerHay = hay.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const idx = lowerHay.indexOf(lowerNeedle);
  if (idx < 0) return { snippet: hay.slice(0, 240), match: null };

  const radius = 90;
  const start = Math.max(0, idx - radius);
  const end = Math.min(hay.length, idx + needle.length + radius);
  const snippet = (start > 0 ? "\u2026" : "") + hay.slice(start, end) +
    (end < hay.length ? "\u2026" : "");
  const prefixLen = start > 0 ? 1 : 0;
  return {
    snippet,
    match: {
      start: prefixLen + (idx - start),
      end: prefixLen + (idx - start) + needle.length,
    },
  };
}

export async function searchSpaceThreads(options: {
  env: Env;
  spaceId: string;
  query: string;
  type: ThreadSearchType;
  limit: number;
  offset: number;
}) {
  const { env, spaceId, query, type, limit, offset } = options;
  const db = threadSearchDeps.getDb(env.DB);
  const results: Array<{
    kind: "keyword" | "semantic";
    score?: number;
    thread: {
      id: string;
      title: string | null;
      status: ThreadStatus;
      updated_at: string;
      created_at: string;
    };
    message: { id: string; sequence: number; role: string; created_at: string };
    snippet: string;
    match?: { start: number; end: number } | null;
  }> = [];
  const ai = env.AI;
  const vectorize = env.VECTORIZE;
  const semanticAvailable = !!ai && !!vectorize;

  if (
    (type === "semantic" || type === "all") && semanticAvailable && ai &&
    vectorize
  ) {
    try {
      const embed = await ai.run(EMBEDDING_MODEL, { text: [query] }) as {
        data: number[][];
      };
      const queryEmbedding = embed?.data?.[0];
      if (queryEmbedding) {
        const search = await vectorize.query(queryEmbedding, {
          // returnMetadata="all" is capped at 50 by Vectorize. Keep the
          // query within that platform boundary before it reaches production.
          topK: Math.min(50, Math.max(10, limit * 2)),
          filter: { kind: THREAD_MESSAGE_VECTOR_KIND, spaceId },
          returnMetadata: "all",
        }) as {
          matches: Array<{ id: string; score: number; metadata?: unknown }>;
        };

        const matches = (search.matches || [])
          .map((match) =>
            parseThreadMessageVectorReference(match, { spaceId })
          )
          .filter((match) => match !== null);
        const messageIds = Array.from(
          new Set(
            matches.map((match) => match.messageId),
          ),
        );
        const canonicalRows = messageIds.length > 0
          ? await db.select({
            messageId: messages.id,
            messageThreadId: messages.threadId,
            messageRole: messages.role,
            messageContent: messages.content,
            messageSequence: messages.sequence,
            messageCreatedAt: messages.createdAt,
            threadId: threads.id,
            threadTitle: threads.title,
            threadStatus: threads.status,
            threadCreatedAt: threads.createdAt,
            threadUpdatedAt: threads.updatedAt,
          }).from(messages)
            .innerJoin(threads, eq(messages.threadId, threads.id))
            .innerJoin(accounts, eq(threads.accountId, accounts.id))
            .where(
              and(
                inArray(messages.id, messageIds),
                eq(threads.accountId, spaceId),
                ne(threads.status, "deleted"),
                eq(accounts.status, "active"),
                inArray(messages.role, ["user", "assistant", "tool"]),
              ),
            )
            .all()
          : [];
        const messageMap = new Map(
          canonicalRows.map((row) => [row.messageId, row]),
        );

        for (const match of matches) {
          const row = messageMap.get(match.messageId);
          if (
            !row || row.messageThreadId !== match.threadId ||
            row.messageSequence !== match.sequence ||
            match.id !== buildThreadMessageVectorId(
              spaceId,
              row.messageThreadId,
              row.messageSequence,
            )
          ) {
            continue;
          }

          results.push({
            kind: "semantic",
            score: match.score,
            thread: {
              id: row.threadId,
              title: row.threadTitle,
              status: row.threadStatus as ThreadStatus,
              created_at: row.threadCreatedAt,
              updated_at: row.threadUpdatedAt,
            },
            message: {
              id: row.messageId,
              sequence: row.messageSequence,
              role: row.messageRole,
              created_at: row.messageCreatedAt,
            },
            snippet: buildSnippet(row.messageContent, "").snippet,
            match: null,
          });

          if (results.length >= limit) break;
        }
      }
    } catch (err) {
      threadSearchDeps.logWarn("semantic search failed", {
        module: "threads.search",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (type === "keyword" || type === "all") {
    const messageRows = await db.select({
      messageId: messages.id,
      messageRole: messages.role,
      messageContent: messages.content,
      messageSequence: messages.sequence,
      messageCreatedAt: messages.createdAt,
      threadId: threads.id,
      threadTitle: threads.title,
      threadStatus: threads.status,
      threadCreatedAt: threads.createdAt,
      threadUpdatedAt: threads.updatedAt,
    }).from(messages)
      .innerJoin(threads, eq(messages.threadId, threads.id))
      .where(and(
        eq(threads.accountId, spaceId),
        ne(threads.status, "deleted"),
        sql`instr(lower(${messages.content}), lower(${query})) > 0`,
      ))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset)
      .all();

    for (const row of messageRows) {
      const snippet = buildSnippet(row.messageContent, query);
      results.push({
        kind: "keyword",
        thread: {
          id: row.threadId,
          title: row.threadTitle,
          status: row.threadStatus as ThreadStatus,
          created_at: row.threadCreatedAt,
          updated_at: row.threadUpdatedAt,
        },
        message: {
          id: row.messageId,
          sequence: row.messageSequence,
          role: row.messageRole,
          created_at: row.messageCreatedAt,
        },
        snippet: snippet.snippet,
        match: snippet.match,
      });
    }
  }

  const seen = new Set<string>();
  const deduped = results.filter((result) => {
    const key = `${result.thread.id}:${result.message.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    query,
    type,
    results: deduped.slice(0, limit),
    limit,
    offset,
    semantic_available: semanticAvailable,
  };
}

export async function searchThreadMessages(options: {
  env: Env;
  spaceId: string;
  threadId: string;
  query: string;
  type: ThreadSearchType;
  limit: number;
  offset: number;
}) {
  const { env, spaceId, threadId, query, type, limit, offset } = options;
  const db = threadSearchDeps.getDb(env.DB);
  const results: Array<{
    kind: "keyword" | "semantic";
    score?: number;
    message: { id: string; sequence: number; role: string; created_at: string };
    snippet: string;
    match?: { start: number; end: number } | null;
  }> = [];
  const semanticAvailable = !!env.AI && !!env.VECTORIZE;

  if ((type === "semantic" || type === "all") && semanticAvailable) {
    try {
      const semantic = await threadSearchDeps.queryRelevantThreadMessages({
        env,
        spaceId,
        threadId,
        query,
        topK: limit,
        minScore: 0.35,
      });

      for (const result of semantic) {
        results.push({
          kind: "semantic",
          score: result.score,
          message: {
            id: result.messageId || result.id,
            sequence: result.sequence,
            role: result.role,
            created_at: result.createdAt || "",
          },
          snippet: result.content,
          match: null,
        });
      }
    } catch (err) {
      threadSearchDeps.logWarn("semantic search failed", {
        module: "threads.messages.search",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (type === "keyword" || type === "all") {
    const messageRows = await db.select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      sequence: messages.sequence,
      createdAt: messages.createdAt,
    }).from(messages)
      .where(and(
        eq(messages.threadId, threadId),
        sql`instr(lower(${messages.content}), lower(${query})) > 0`,
      ))
      .orderBy(asc(messages.sequence))
      .limit(limit)
      .offset(offset)
      .all();

    for (const message of messageRows) {
      const snippet = buildSnippet(message.content, query);
      results.push({
        kind: "keyword",
        message: {
          id: message.id,
          sequence: message.sequence,
          role: message.role,
          created_at: message.createdAt,
        },
        snippet: snippet.snippet,
        match: snippet.match,
      });
    }
  }

  const seenSeq = new Set<number>();
  const deduped = results.filter((result) => {
    if (seenSeq.has(result.message.sequence)) return false;
    seenSeq.add(result.message.sequence);
    return true;
  });

  return {
    query,
    type,
    results: deduped.slice(0, limit),
    limit,
    offset,
    semantic_available: semanticAvailable,
  };
}
