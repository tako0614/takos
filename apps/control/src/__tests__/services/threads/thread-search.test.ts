import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  queryRelevantThreadMessages: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('@/services/agent', () => ({
  queryRelevantThreadMessages: mocks.queryRelevantThreadMessages,
  THREAD_MESSAGE_VECTOR_KIND: 'thread_message',
}));

vi.mock('@/shared/utils/logger', () => ({
  logWarn: mocks.logWarn,
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

import { searchSpaceThreads, searchThreadMessages } from '@/services/threads/thread-search';

function makeEnv(options: { ai?: boolean; vectorize?: boolean } = {}): Env {
  const env: Partial<Env> = {
    DB: {} as Env['DB'],
  };
  if (options.ai) {
    env.AI = {
      run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }),
    } as unknown as Env['AI'];
  }
  if (options.vectorize) {
    env.VECTORIZE = {
      query: vi.fn().mockResolvedValue({ matches: [] }),
    } as unknown as Env['VECTORIZE'];
  }
  return env as Env;
}

function makeDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      const result = selectResults[selectIdx++];
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.offset = vi.fn().mockReturnValue(chain);
      chain.all = vi.fn().mockResolvedValue(Array.isArray(result) ? result : []);
      chain.get = vi.fn().mockResolvedValue(Array.isArray(result) ? result[0] : result);
      return chain;
    }),
  };
}

describe('searchSpaceThreads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs keyword search and returns results with snippets', async () => {
    const threadRow = {
      id: 'thread-1',
      title: 'Test Thread',
      status: 'active',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T01:00:00.000Z',
    };
    const messageRow = {
      id: 'msg-1',
      role: 'user',
      content: 'This is a test message with the keyword searchterm inside it.',
      sequence: 0,
      createdAt: '2026-03-01T00:00:01.000Z',
      threadId: 'thread-1',
    };

    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [threadRow],   // spaceThreads
      [messageRow],  // messageRows
    ]));

    const result = await searchSpaceThreads({
      env: makeEnv(),
      spaceId: 'space-1',
      query: 'searchterm',
      type: 'keyword',
      limit: 10,
      offset: 0,
    });

    expect(result.query).toBe('searchterm');
    expect(result.type).toBe('keyword');
    expect(result.semantic_available).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].kind).toBe('keyword');
    expect(result.results[0].thread.id).toBe('thread-1');
    expect(result.results[0].message.id).toBe('msg-1');
    expect(result.results[0].snippet).toContain('searchterm');
    expect(result.results[0].match).not.toBeNull();
  });

  it('returns empty results when no threads exist in the space', async () => {
    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [],  // no threads
    ]));

    const result = await searchSpaceThreads({
      env: makeEnv(),
      spaceId: 'space-1',
      query: 'anything',
      type: 'keyword',
      limit: 10,
      offset: 0,
    });

    expect(result.results).toHaveLength(0);
  });

  it('deduplicates results across keyword and semantic results', async () => {
    const threadRow = {
      id: 'thread-1',
      title: 'Test',
      status: 'active',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T01:00:00.000Z',
    };
    const messageRow = {
      id: 'msg-1',
      role: 'user',
      content: 'duplicated keyword content',
      sequence: 0,
      createdAt: '2026-03-01T00:00:01.000Z',
      threadId: 'thread-1',
    };

    const env = makeEnv({ ai: true, vectorize: true });
    (env.AI!.run as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [[0.1, 0.2]] });
    (env.VECTORIZE!.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [{
        id: 'vec-1',
        score: 0.95,
        metadata: {
          threadId: 'thread-1',
          messageId: 'msg-1',
          sequence: 0,
          role: 'user',
          content: 'duplicated keyword content',
          createdAt: '2026-03-01T00:00:01.000Z',
        },
      }],
    });

    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [threadRow],   // semantic thread lookup
      [threadRow],   // keyword spaceThreads
      [messageRow],  // keyword messageRows
    ]));

    const result = await searchSpaceThreads({
      env,
      spaceId: 'space-1',
      query: 'keyword',
      type: 'all',
      limit: 10,
      offset: 0,
    });

    // Same thread:message pair should appear only once
    expect(result.results).toHaveLength(1);
  });

  it('sets semantic_available based on AI and VECTORIZE bindings', async () => {
    mocks.getDb.mockReturnValue(makeDrizzleMock([[]]));

    const resultNoAI = await searchSpaceThreads({
      env: makeEnv(),
      spaceId: 'space-1',
      query: 'test',
      type: 'keyword',
      limit: 10,
      offset: 0,
    });
    expect(resultNoAI.semantic_available).toBe(false);

    mocks.getDb.mockReturnValue(makeDrizzleMock([[]]));
    const resultWithAI = await searchSpaceThreads({
      env: makeEnv({ ai: true, vectorize: true }),
      spaceId: 'space-1',
      query: 'test',
      type: 'keyword',
      limit: 10,
      offset: 0,
    });
    expect(resultWithAI.semantic_available).toBe(true);
  });

  it('handles semantic search failure gracefully', async () => {
    const env = makeEnv({ ai: true, vectorize: true });
    (env.AI!.run as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('AI unavailable'));

    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [],  // keyword: no threads
    ]));

    const result = await searchSpaceThreads({
      env,
      spaceId: 'space-1',
      query: 'test',
      type: 'all',
      limit: 10,
      offset: 0,
    });

    expect(result.results).toHaveLength(0);
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('skips deleted threads from semantic results', async () => {
    const env = makeEnv({ ai: true, vectorize: true });
    (env.AI!.run as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [[0.1]] });
    (env.VECTORIZE!.query as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [{
        id: 'vec-1',
        score: 0.9,
        metadata: {
          threadId: 'thread-deleted',
          messageId: 'msg-1',
          sequence: 0,
          role: 'user',
          content: 'old content',
        },
      }],
    });

    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [{ id: 'thread-deleted', title: 'Deleted', status: 'deleted', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    ]));

    const result = await searchSpaceThreads({
      env,
      spaceId: 'space-1',
      query: 'old',
      type: 'semantic',
      limit: 10,
      offset: 0,
    });

    expect(result.results).toHaveLength(0);
  });

  it('respects limit parameter', async () => {
    const threadRow = {
      id: 'thread-1', title: 'T', status: 'active',
      createdAt: '2026-03-01', updatedAt: '2026-03-01',
    };
    const msgs = Array.from({ length: 5 }, (_, i) => ({
      id: `msg-${i}`, role: 'user', content: `match content ${i}`, sequence: i,
      createdAt: '2026-03-01', threadId: 'thread-1',
    }));

    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [threadRow],
      msgs,
    ]));

    const result = await searchSpaceThreads({
      env: makeEnv(),
      spaceId: 'space-1',
      query: 'match',
      type: 'keyword',
      limit: 2,
      offset: 0,
    });

    expect(result.results.length).toBeLessThanOrEqual(2);
  });
});

describe('searchThreadMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs keyword search within a specific thread', async () => {
    const messageRow = {
      id: 'msg-1',
      role: 'user',
      content: 'The quick brown fox jumps over the lazy dog',
      sequence: 0,
      createdAt: '2026-03-01T00:00:01.000Z',
    };

    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [messageRow],
    ]));

    const result = await searchThreadMessages({
      env: makeEnv(),
      spaceId: 'space-1',
      threadId: 'thread-1',
      query: 'brown fox',
      type: 'keyword',
      limit: 10,
      offset: 0,
    });

    expect(result.query).toBe('brown fox');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].kind).toBe('keyword');
    expect(result.results[0].snippet).toContain('brown fox');
    expect(result.results[0].match).not.toBeNull();
  });

  it('deduplicates by message sequence', async () => {
    // Simulate getting the same sequence from both semantic and keyword
    mocks.queryRelevantThreadMessages.mockResolvedValue([
      {
        id: 'vec-1',
        messageId: 'msg-1',
        sequence: 0,
        role: 'user',
        content: 'shared content',
        score: 0.9,
        createdAt: '2026-03-01',
      },
    ]);

    const messageRow = {
      id: 'msg-1',
      role: 'user',
      content: 'shared content',
      sequence: 0,
      createdAt: '2026-03-01',
    };

    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [messageRow],
    ]));

    const result = await searchThreadMessages({
      env: makeEnv({ ai: true, vectorize: true }),
      spaceId: 'space-1',
      threadId: 'thread-1',
      query: 'shared',
      type: 'all',
      limit: 10,
      offset: 0,
    });

    expect(result.results).toHaveLength(1);
  });

  it('returns empty results when no messages match', async () => {
    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [],
    ]));

    const result = await searchThreadMessages({
      env: makeEnv(),
      spaceId: 'space-1',
      threadId: 'thread-1',
      query: 'nonexistent',
      type: 'keyword',
      limit: 10,
      offset: 0,
    });

    expect(result.results).toHaveLength(0);
  });

  it('handles semantic search failure gracefully', async () => {
    mocks.queryRelevantThreadMessages.mockRejectedValue(new Error('Vectorize down'));

    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [],  // keyword: no matches
    ]));

    const result = await searchThreadMessages({
      env: makeEnv({ ai: true, vectorize: true }),
      spaceId: 'space-1',
      threadId: 'thread-1',
      query: 'test',
      type: 'all',
      limit: 10,
      offset: 0,
    });

    expect(result.results).toHaveLength(0);
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('uses semantic search results with scores', async () => {
    mocks.queryRelevantThreadMessages.mockResolvedValue([
      {
        id: 'vec-1',
        messageId: 'msg-42',
        sequence: 5,
        role: 'assistant',
        content: 'Relevant answer about deployment',
        score: 0.88,
        createdAt: '2026-03-01',
      },
    ]);

    mocks.getDb.mockReturnValue(makeDrizzleMock([
      [],  // keyword: no matches
    ]));

    const result = await searchThreadMessages({
      env: makeEnv({ ai: true, vectorize: true }),
      spaceId: 'space-1',
      threadId: 'thread-1',
      query: 'how to deploy',
      type: 'all',
      limit: 10,
      offset: 0,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].kind).toBe('semantic');
    expect(result.results[0].score).toBe(0.88);
    expect(result.results[0].message.id).toBe('msg-42');
    expect(result.results[0].message.sequence).toBe(5);
  });
});
