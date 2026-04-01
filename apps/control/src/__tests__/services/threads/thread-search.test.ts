import type { Env } from "@/types";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  queryRelevantThreadMessages: ((..._args: any[]) => undefined) as any,
  logWarnCalls: [] as unknown[][],
  logWarn: (...args: unknown[]) => {
    mocks.logWarnCalls.push(args);
  },
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import {
  searchSpaceThreads,
  searchThreadMessages,
  threadSearchDeps,
} from "@/services/threads/thread-search";

threadSearchDeps.getDb = ((db) => mocks.getDb(db)) as typeof threadSearchDeps.getDb;
threadSearchDeps.queryRelevantThreadMessages = ((
  ...args: Parameters<typeof threadSearchDeps.queryRelevantThreadMessages>
) => mocks.queryRelevantThreadMessages(...args)) as typeof threadSearchDeps.queryRelevantThreadMessages;
threadSearchDeps.logWarn = ((...args) => mocks.logWarn(...args)) as typeof threadSearchDeps.logWarn;

function makeEnv(options: { ai?: boolean; vectorize?: boolean } = {}): Env {
  const env: Partial<Env> = {
    DB: {} as Env["DB"],
  };
  if (options.ai) {
    env.AI = {
      run: async () => ({ data: [[0.1, 0.2, 0.3]] }),
    } as unknown as Env["AI"];
  }
  if (options.vectorize) {
    env.VECTORIZE = {
      query: async () => ({ matches: [] }),
    } as unknown as Env["VECTORIZE"];
  }
  return env as Env;
}

function makeDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;
  return {
    select: () => {
      const result = selectResults[selectIdx++];
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.orderBy = () => chain;
      chain.limit = () => chain;
      chain.offset = () => chain;
      chain.all = async () => Array.isArray(result) ? result : [];
      chain.get = async () => Array.isArray(result) ? result[0] : result;
      return chain;
    },
  };
}

Deno.test("searchSpaceThreads - performs keyword search and returns results with snippets", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const threadRow = {
    id: "thread-1",
    title: "Test Thread",
    status: "active",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T01:00:00.000Z",
  };
  const messageRow = {
    id: "msg-1",
    role: "user",
    content: "This is a test message with the keyword searchterm inside it.",
    sequence: 0,
    createdAt: "2026-03-01T00:00:01.000Z",
    threadId: "thread-1",
  };

  mocks.getDb = (() =>
    makeDrizzleMock([
      [threadRow], // spaceThreads
      [messageRow], // messageRows
    ])) as any;

  const result = await searchSpaceThreads({
    env: makeEnv(),
    spaceId: "space-1",
    query: "searchterm",
    type: "keyword",
    limit: 10,
    offset: 0,
  });

  assertEquals(result.query, "searchterm");
  assertEquals(result.type, "keyword");
  assertEquals(result.semantic_available, false);
  assertEquals(result.results.length, 1);
  assertEquals(result.results[0].kind, "keyword");
  assertEquals(result.results[0].thread.id, "thread-1");
  assertEquals(result.results[0].message.id, "msg-1");
  assertStringIncludes(result.results[0].snippet, "searchterm");
  assertNotEquals(result.results[0].match, null);
});
Deno.test("searchSpaceThreads - returns empty results when no threads exist in the space", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() =>
    makeDrizzleMock([
      [], // no threads
    ])) as any;

  const result = await searchSpaceThreads({
    env: makeEnv(),
    spaceId: "space-1",
    query: "anything",
    type: "keyword",
    limit: 10,
    offset: 0,
  });

  assertEquals(result.results.length, 0);
});
Deno.test("searchSpaceThreads - deduplicates results across keyword and semantic results", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const threadRow = {
    id: "thread-1",
    title: "Test",
    status: "active",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T01:00:00.000Z",
  };
  const messageRow = {
    id: "msg-1",
    role: "user",
    content: "duplicated keyword content",
    sequence: 0,
    createdAt: "2026-03-01T00:00:01.000Z",
    threadId: "thread-1",
  };

  const env = makeEnv({ ai: true, vectorize: true });
  (env.AI!.run as any) = (async () => ({ data: [[0.1, 0.2]] })) as any;
  (env.VECTORIZE!.query as any) = (async () => ({
    matches: [{
      id: "vec-1",
      score: 0.95,
      metadata: {
        threadId: "thread-1",
        messageId: "msg-1",
        sequence: 0,
        role: "user",
        content: "duplicated keyword content",
        createdAt: "2026-03-01T00:00:01.000Z",
      },
    }],
  })) as any;

  mocks.getDb = (() =>
    makeDrizzleMock([
      [threadRow], // semantic thread lookup
      [threadRow], // keyword spaceThreads
      [messageRow], // keyword messageRows
    ])) as any;

  const result = await searchSpaceThreads({
    env,
    spaceId: "space-1",
    query: "keyword",
    type: "all",
    limit: 10,
    offset: 0,
  });

  // Same thread:message pair should appear only once
  assertEquals(result.results.length, 1);
});
Deno.test("searchSpaceThreads - sets semantic_available based on AI and VECTORIZE bindings", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => makeDrizzleMock([[]])) as any;

  const resultNoAI = await searchSpaceThreads({
    env: makeEnv(),
    spaceId: "space-1",
    query: "test",
    type: "keyword",
    limit: 10,
    offset: 0,
  });
  assertEquals(resultNoAI.semantic_available, false);

  mocks.getDb = (() => makeDrizzleMock([[]])) as any;
  const resultWithAI = await searchSpaceThreads({
    env: makeEnv({ ai: true, vectorize: true }),
    spaceId: "space-1",
    query: "test",
    type: "keyword",
    limit: 10,
    offset: 0,
  });
  assertEquals(resultWithAI.semantic_available, true);
});
Deno.test("searchSpaceThreads - handles semantic search failure gracefully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = makeEnv({ ai: true, vectorize: true });
  (env.AI!.run as any) = (async () => {
    throw new Error("AI unavailable");
  }) as any;

  mocks.getDb = (() =>
    makeDrizzleMock([
      [], // keyword: no threads
    ])) as any;

  const result = await searchSpaceThreads({
    env,
    spaceId: "space-1",
    query: "test",
    type: "all",
    limit: 10,
    offset: 0,
  });

  assertEquals(result.results.length, 0);
  assert(mocks.logWarnCalls.length > 0);
});
Deno.test("searchSpaceThreads - skips deleted threads from semantic results", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = makeEnv({ ai: true, vectorize: true });
  (env.AI!.run as any) = (async () => ({ data: [[0.1]] })) as any;
  (env.VECTORIZE!.query as any) = (async () => ({
    matches: [{
      id: "vec-1",
      score: 0.9,
      metadata: {
        threadId: "thread-deleted",
        messageId: "msg-1",
        sequence: 0,
        role: "user",
        content: "old content",
      },
    }],
  })) as any;

  mocks.getDb = (() =>
    makeDrizzleMock([
      [{
        id: "thread-deleted",
        title: "Deleted",
        status: "deleted",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      }],
    ])) as any;

  const result = await searchSpaceThreads({
    env,
    spaceId: "space-1",
    query: "old",
    type: "semantic",
    limit: 10,
    offset: 0,
  });

  assertEquals(result.results.length, 0);
});
Deno.test("searchSpaceThreads - respects limit parameter", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const threadRow = {
    id: "thread-1",
    title: "T",
    status: "active",
    createdAt: "2026-03-01",
    updatedAt: "2026-03-01",
  };
  const msgs = Array.from({ length: 5 }, (_, i) => ({
    id: `msg-${i}`,
    role: "user",
    content: `match content ${i}`,
    sequence: i,
    createdAt: "2026-03-01",
    threadId: "thread-1",
  }));

  mocks.getDb = (() =>
    makeDrizzleMock([
      [threadRow],
      msgs,
    ])) as any;

  const result = await searchSpaceThreads({
    env: makeEnv(),
    spaceId: "space-1",
    query: "match",
    type: "keyword",
    limit: 2,
    offset: 0,
  });

  assert(result.results.length <= 2);
});

Deno.test("searchThreadMessages - performs keyword search within a specific thread", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const messageRow = {
    id: "msg-1",
    role: "user",
    content: "The quick brown fox jumps over the lazy dog",
    sequence: 0,
    createdAt: "2026-03-01T00:00:01.000Z",
  };

  mocks.getDb = (() =>
    makeDrizzleMock([
      [messageRow],
    ])) as any;

  const result = await searchThreadMessages({
    env: makeEnv(),
    spaceId: "space-1",
    threadId: "thread-1",
    query: "brown fox",
    type: "keyword",
    limit: 10,
    offset: 0,
  });

  assertEquals(result.query, "brown fox");
  assertEquals(result.results.length, 1);
  assertEquals(result.results[0].kind, "keyword");
  assertStringIncludes(result.results[0].snippet, "brown fox");
  assertNotEquals(result.results[0].match, null);
});
Deno.test("searchThreadMessages - deduplicates by message sequence", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Simulate getting the same sequence from both semantic and keyword
  mocks.queryRelevantThreadMessages = (async () => [
    {
      id: "vec-1",
      messageId: "msg-1",
      sequence: 0,
      role: "user",
      content: "shared content",
      score: 0.9,
      createdAt: "2026-03-01",
    },
  ]) as any;

  const messageRow = {
    id: "msg-1",
    role: "user",
    content: "shared content",
    sequence: 0,
    createdAt: "2026-03-01",
  };

  mocks.getDb = (() =>
    makeDrizzleMock([
      [messageRow],
    ])) as any;

  const result = await searchThreadMessages({
    env: makeEnv({ ai: true, vectorize: true }),
    spaceId: "space-1",
    threadId: "thread-1",
    query: "shared",
    type: "all",
    limit: 10,
    offset: 0,
  });

  assertEquals(result.results.length, 1);
});
Deno.test("searchThreadMessages - returns empty results when no messages match", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() =>
    makeDrizzleMock([
      [],
    ])) as any;

  const result = await searchThreadMessages({
    env: makeEnv(),
    spaceId: "space-1",
    threadId: "thread-1",
    query: "nonexistent",
    type: "keyword",
    limit: 10,
    offset: 0,
  });

  assertEquals(result.results.length, 0);
});
Deno.test("searchThreadMessages - handles semantic search failure gracefully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.queryRelevantThreadMessages = (async () => {
    throw new Error("Vectorize down");
  }) as any;

  mocks.getDb = (() =>
    makeDrizzleMock([
      [], // keyword: no matches
    ])) as any;

  const result = await searchThreadMessages({
    env: makeEnv({ ai: true, vectorize: true }),
    spaceId: "space-1",
    threadId: "thread-1",
    query: "test",
    type: "all",
    limit: 10,
    offset: 0,
  });

  assertEquals(result.results.length, 0);
  assert(mocks.logWarnCalls.length > 0);
});
Deno.test("searchThreadMessages - uses semantic search results with scores", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.queryRelevantThreadMessages = (async () => [
    {
      id: "vec-1",
      messageId: "msg-42",
      sequence: 5,
      role: "assistant",
      content: "Relevant answer about deployment",
      score: 0.88,
      createdAt: "2026-03-01",
    },
  ]) as any;

  mocks.getDb = (() =>
    makeDrizzleMock([
      [], // keyword: no matches
    ])) as any;

  const result = await searchThreadMessages({
    env: makeEnv({ ai: true, vectorize: true }),
    spaceId: "space-1",
    threadId: "thread-1",
    query: "how to deploy",
    type: "all",
    limit: 10,
    offset: 0,
  });

  assertEquals(result.results.length, 1);
  assertEquals(result.results[0].kind, "semantic");
  assertEquals(result.results[0].score, 0.88);
  assertEquals(result.results[0].message.id, "msg-42");
  assertEquals(result.results[0].message.sequence, 5);
});
