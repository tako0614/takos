import { getDb, threads, messages } from '../../../infra/db';
import { eq, and, ne, like, desc, asc, inArray } from 'drizzle-orm';
import { queryRelevantThreadMessages, THREAD_MESSAGE_VECTOR_KIND } from '../agent';
import type { Env, ThreadStatus } from '../../../shared/types';
import { logWarn } from '../../../shared/utils/logger';
import { EMBEDDING_MODEL } from '../../../shared/config/limits.ts';

function buildSnippet(
  content: string,
  query: string,
): { snippet: string; match: { start: number; end: number } | null } {
  const hay = content || '';
  const needle = query || '';
  if (!hay || !needle) return { snippet: hay.slice(0, 240), match: null };

  const lowerHay = hay.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const idx = lowerHay.indexOf(lowerNeedle);
  if (idx < 0) return { snippet: hay.slice(0, 240), match: null };

  const radius = 90;
  const start = Math.max(0, idx - radius);
  const end = Math.min(hay.length, idx + needle.length + radius);
  const snippet = (start > 0 ? '\u2026' : '') + hay.slice(start, end) + (end < hay.length ? '\u2026' : '');
  const prefixLen = start > 0 ? 1 : 0;
  return {
    snippet,
    match: { start: prefixLen + (idx - start), end: prefixLen + (idx - start) + needle.length },
  };
}

export async function searchSpaceThreads(options: {
  env: Env;
  spaceId: string;
  query: string;
  type: string;
  limit: number;
  offset: number;
}) {
  const { env, spaceId, query, type, limit, offset } = options;
  const db = getDb(env.DB);
  const results: Array<{
    kind: 'keyword' | 'semantic';
    score?: number;
    thread: { id: string; title: string | null; status: ThreadStatus; updated_at: string; created_at: string };
    message: { id: string; sequence: number; role: string; created_at: string };
    snippet: string;
    match?: { start: number; end: number } | null;
  }> = [];
  const semanticAvailable = !!env.AI && !!env.VECTORIZE;

  if ((type === 'semantic' || type === 'all') && semanticAvailable) {
    try {
      const embed = await env.AI!.run(EMBEDDING_MODEL, { text: [query] }) as { data: number[][] };
      const queryEmbedding = embed?.data?.[0];
      if (queryEmbedding) {
        const search = await env.VECTORIZE!.query(queryEmbedding, {
          topK: Math.max(10, limit * 2),
          filter: { kind: THREAD_MESSAGE_VECTOR_KIND, spaceId },
          returnMetadata: 'all',
        }) as { matches: Array<{ id: string; score: number; metadata?: unknown }> };

        const matches = (search.matches || []).filter((match) => typeof match.score === 'number');
        const threadIds = Array.from(new Set(matches
          .map((match) => (match.metadata as { threadId?: string })?.threadId)
          .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0)
        ));
        const threadRows = threadIds.length > 0
          ? await db.select({
              id: threads.id,
              title: threads.title,
              status: threads.status,
              createdAt: threads.createdAt,
              updatedAt: threads.updatedAt,
            }).from(threads)
            .where(and(inArray(threads.id, threadIds), eq(threads.accountId, spaceId)))
            .all()
          : [];
        const threadMap = new Map(threadRows.map((thread) => [thread.id, thread]));

        for (const match of matches) {
          const meta = (match.metadata || {}) as Record<string, unknown>;
          const threadId = typeof meta.threadId === 'string' ? meta.threadId : '';
          const messageId = typeof meta.messageId === 'string' ? meta.messageId : '';
          const sequence = typeof meta.sequence === 'number'
            ? meta.sequence
            : typeof meta.sequence === 'string'
              ? Number.parseInt(meta.sequence, 10)
              : NaN;
          if (!threadId || !messageId || !Number.isFinite(sequence)) continue;

          const thread = threadMap.get(threadId);
          if (!thread || thread.status === 'deleted') continue;

          results.push({
            kind: 'semantic',
            score: match.score,
            thread: {
              id: thread.id,
              title: thread.title,
              status: thread.status as ThreadStatus,
              created_at: thread.createdAt,
              updated_at: thread.updatedAt,
            },
            message: {
              id: messageId,
              sequence,
              role: typeof meta.role === 'string' ? meta.role : 'unknown',
              created_at: typeof meta.createdAt === 'string' ? meta.createdAt : '',
            },
            snippet: typeof meta.content === 'string' ? meta.content : '',
            match: null,
          });

          if (results.length >= limit) break;
        }
      }
    } catch (err) {
      logWarn('semantic search failed', { module: 'threads.search', error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (type === 'keyword' || type === 'all') {
    // Find threads in the space that are not deleted
    const spaceThreads = await db.select({
      id: threads.id,
      title: threads.title,
      status: threads.status,
      createdAt: threads.createdAt,
      updatedAt: threads.updatedAt,
    }).from(threads)
      .where(and(eq(threads.accountId, spaceId), ne(threads.status, 'deleted')))
      .all();

    if (spaceThreads.length > 0) {
      const threadIds = spaceThreads.map((t) => t.id);
      const threadMap = new Map(spaceThreads.map((t) => [t.id, t]));

      const messageRows = await db.select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        sequence: messages.sequence,
        createdAt: messages.createdAt,
        threadId: messages.threadId,
      }).from(messages)
        .where(and(
          inArray(messages.threadId, threadIds),
          like(messages.content, `%${query}%`),
        ))
        .orderBy(desc(messages.createdAt))
        .limit(limit)
        .offset(offset)
        .all();

      for (const message of messageRows) {
        const thread = threadMap.get(message.threadId);
        if (!thread) continue;

        const snippet = buildSnippet(message.content, query);
        results.push({
          kind: 'keyword',
          thread: {
            id: thread.id,
            title: thread.title,
            status: thread.status as ThreadStatus,
            created_at: thread.createdAt,
            updated_at: thread.updatedAt,
          },
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
  type: string;
  limit: number;
  offset: number;
}) {
  const { env, spaceId, threadId, query, type, limit, offset } = options;
  const db = getDb(env.DB);
  const results: Array<{
    kind: 'keyword' | 'semantic';
    score?: number;
    message: { id: string; sequence: number; role: string; created_at: string };
    snippet: string;
    match?: { start: number; end: number } | null;
  }> = [];
  const semanticAvailable = !!env.AI && !!env.VECTORIZE;

  if ((type === 'semantic' || type === 'all') && semanticAvailable) {
    try {
      const semantic = await queryRelevantThreadMessages({
        env,
        spaceId,
        threadId,
        query,
        topK: limit,
        minScore: 0.35,
      });

      for (const result of semantic) {
        results.push({
          kind: 'semantic',
          score: result.score,
          message: {
            id: result.messageId || result.id,
            sequence: result.sequence,
            role: result.role,
            created_at: result.createdAt || '',
          },
          snippet: result.content,
          match: null,
        });
      }
    } catch (err) {
      logWarn('semantic search failed', { module: 'threads.messages.search', error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (type === 'keyword' || type === 'all') {
    const messageRows = await db.select({
      id: messages.id,
      role: messages.role,
      content: messages.content,
      sequence: messages.sequence,
      createdAt: messages.createdAt,
    }).from(messages)
      .where(and(
        eq(messages.threadId, threadId),
        like(messages.content, `%${query}%`),
      ))
      .orderBy(asc(messages.sequence))
      .limit(limit)
      .offset(offset)
      .all();

    for (const message of messageRows) {
      const snippet = buildSnippet(message.content, query);
      results.push({
        kind: 'keyword',
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
