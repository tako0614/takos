import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  LLMClient: vi.fn(),
  getProviderFromModel: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
  accounts: { id: 'id', aiModel: 'aiModel' },
  threads: {
    id: 'id',
    accountId: 'accountId',
    retrievalIndex: 'retrievalIndex',
    summary: 'summary',
    keyPoints: 'keyPoints',
    updatedAt: 'updatedAt',
  },
  messages: {
    id: 'id',
    threadId: 'threadId',
    role: 'role',
    content: 'content',
    sequence: 'sequence',
    createdAt: 'createdAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  gt: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: unknown) => col),
  asc: vi.fn((col: unknown) => col),
}));

vi.mock('@/services/agent/llm', () => ({
  LLMClient: mocks.LLMClient,
  getProviderFromModel: mocks.getProviderFromModel,
}));

vi.mock('@/services/agent/model-catalog', () => ({
  DEFAULT_MODEL_ID: 'gpt-5.4-nano',
}));

vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils')>()),
  now: () => '2025-01-01T00:00:00Z',
  toIsoString: (val: unknown) => typeof val === 'string' ? val : null,
}));

vi.mock('@/utils/logger', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: mocks.logWarn,
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  safeJsonParse: vi.fn((v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } }),
  safeJsonParseOrDefault: vi.fn((v: unknown, d: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return d; } }),
}));

import {
  buildThreadContextSystemMessage,
  queryRelevantThreadMessages,
  THREAD_MESSAGE_VECTOR_KIND,
  DEFAULT_MAX_MESSAGES_PER_THREAD_INDEX_JOB,
  type RetrievedThreadMessage,
} from '@/services/agent/thread-context';

describe('buildThreadContextSystemMessage', () => {
  it('returns null when no content is available', () => {
    const result = buildThreadContextSystemMessage({
      summary: null,
      keyPointsJson: '[]',
      retrieved: [],
      maxChars: 5000,
    });
    expect(result).toBeNull();
  });

  it('includes summary when provided', () => {
    const result = buildThreadContextSystemMessage({
      summary: 'This thread is about fixing a bug.',
      keyPointsJson: '[]',
      retrieved: [],
      maxChars: 5000,
    });

    expect(result).not.toBeNull();
    expect(result!.role).toBe('system');
    expect(result!.content).toContain('[THREAD_CONTEXT]');
    expect(result!.content).toContain('Summary:');
    expect(result!.content).toContain('This thread is about fixing a bug.');
    expect(result!.content).toContain('[/THREAD_CONTEXT]');
  });

  it('includes key points when provided', () => {
    const result = buildThreadContextSystemMessage({
      summary: null,
      keyPointsJson: JSON.stringify(['Point 1', 'Point 2']),
      retrieved: [],
      maxChars: 5000,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('Key points:');
    expect(result!.content).toContain('- Point 1');
    expect(result!.content).toContain('- Point 2');
  });

  it('limits key points to 12', () => {
    const points = Array.from({ length: 20 }, (_, i) => `Point ${i + 1}`);
    const result = buildThreadContextSystemMessage({
      summary: 'Test',
      keyPointsJson: JSON.stringify(points),
      retrieved: [],
      maxChars: 50000,
    });

    expect(result!.content).toContain('- Point 12');
    expect(result!.content).not.toContain('- Point 13');
  });

  it('includes retrieved messages with scores', () => {
    const retrieved: RetrievedThreadMessage[] = [
      { id: 'v1', score: 0.95, sequence: 5, role: 'user', content: 'What is the status?' },
      { id: 'v2', score: 0.85, sequence: 6, role: 'assistant', content: 'All tests pass.' },
    ];

    const result = buildThreadContextSystemMessage({
      summary: null,
      keyPointsJson: '[]',
      retrieved,
      maxChars: 5000,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('Relevant past messages');
    expect(result!.content).toContain('[0.950]');
    expect(result!.content).toContain('#5');
    expect(result!.content).toContain('What is the status?');
  });

  it('truncates content to maxChars', () => {
    const result = buildThreadContextSystemMessage({
      summary: 'A'.repeat(5000),
      keyPointsJson: '[]',
      retrieved: [],
      maxChars: 100,
    });

    expect(result).not.toBeNull();
    expect(result!.content.length).toBeLessThanOrEqual(200); // truncate + marker
    expect(result!.content).toContain('truncated');
  });

  it('includes injection warning', () => {
    const result = buildThreadContextSystemMessage({
      summary: 'Summary',
      keyPointsJson: '[]',
      retrieved: [],
      maxChars: 5000,
    });

    expect(result!.content).toContain('untrusted');
  });

  it('handles malformed keyPointsJson gracefully', () => {
    const result = buildThreadContextSystemMessage({
      summary: 'Summary',
      keyPointsJson: 'not-json',
      retrieved: [],
      maxChars: 5000,
    });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('Summary');
  });
});

describe('queryRelevantThreadMessages', () => {
  it('returns empty array when AI or VECTORIZE is missing', async () => {
    const result = await queryRelevantThreadMessages({
      env: { AI: undefined, VECTORIZE: undefined } as any,
      spaceId: 'ws-1',
      threadId: 'thread-1',
      query: 'test query',
      topK: 5,
      minScore: 0.3,
    });
    expect(result).toEqual([]);
  });

  it('returns empty array for empty query', async () => {
    const result = await queryRelevantThreadMessages({
      env: { AI: {}, VECTORIZE: {} } as any,
      spaceId: 'ws-1',
      threadId: 'thread-1',
      query: '   ',
      topK: 5,
      minScore: 0.3,
    });
    expect(result).toEqual([]);
  });

  it('queries vector store and filters by minScore', async () => {
    const mockAI = {
      run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })),
    };
    const mockVectorize = {
      query: vi.fn(async () => ({
        matches: [
          {
            id: 'v1',
            score: 0.9,
            metadata: { sequence: 5, role: 'user', content: 'relevant content', spaceId: 'ws-1', threadId: 'thread-1' },
          },
          {
            id: 'v2',
            score: 0.1, // below minScore
            metadata: { sequence: 6, role: 'assistant', content: 'irrelevant', spaceId: 'ws-1', threadId: 'thread-1' },
          },
        ],
      })),
    };

    const result = await queryRelevantThreadMessages({
      env: { AI: mockAI, VECTORIZE: mockVectorize } as any,
      spaceId: 'ws-1',
      threadId: 'thread-1',
      query: 'test query',
      topK: 5,
      minScore: 0.3,
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('v1');
    expect(result[0].score).toBe(0.9);
    expect(result[0].content).toBe('relevant content');
  });

  it('respects beforeSequence filter', async () => {
    const mockAI = {
      run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })),
    };
    const mockVectorize = {
      query: vi.fn(async () => ({
        matches: [
          { id: 'v1', score: 0.9, metadata: { sequence: 10, role: 'user', content: 'msg', spaceId: 'ws-1', threadId: 't1' } },
          { id: 'v2', score: 0.8, metadata: { sequence: 3, role: 'user', content: 'earlier', spaceId: 'ws-1', threadId: 't1' } },
        ],
      })),
    };

    const result = await queryRelevantThreadMessages({
      env: { AI: mockAI, VECTORIZE: mockVectorize } as any,
      spaceId: 'ws-1',
      threadId: 't1',
      query: 'test',
      topK: 5,
      minScore: 0.3,
      beforeSequence: 5,
    });

    expect(result).toHaveLength(1);
    expect(result[0].sequence).toBe(3);
  });

  it('excludes specified sequences', async () => {
    const mockAI = {
      run: vi.fn(async () => ({ data: [[0.1, 0.2]] })),
    };
    const mockVectorize = {
      query: vi.fn(async () => ({
        matches: [
          { id: 'v1', score: 0.9, metadata: { sequence: 5, role: 'user', content: 'msg', spaceId: 'ws-1', threadId: 't1' } },
          { id: 'v2', score: 0.8, metadata: { sequence: 3, role: 'user', content: 'earlier', spaceId: 'ws-1', threadId: 't1' } },
        ],
      })),
    };

    const result = await queryRelevantThreadMessages({
      env: { AI: mockAI, VECTORIZE: mockVectorize } as any,
      spaceId: 'ws-1',
      threadId: 't1',
      query: 'test',
      topK: 5,
      minScore: 0.3,
      excludeSequences: new Set([5]),
    });

    expect(result).toHaveLength(1);
    expect(result[0].sequence).toBe(3);
  });

  it('deduplicates by sequence', async () => {
    const mockAI = {
      run: vi.fn(async () => ({ data: [[0.1]] })),
    };
    const mockVectorize = {
      query: vi.fn(async () => ({
        matches: [
          { id: 'v1', score: 0.9, metadata: { sequence: 5, role: 'user', content: 'msg', spaceId: 'ws-1', threadId: 't1' } },
          { id: 'v2', score: 0.8, metadata: { sequence: 5, role: 'user', content: 'duplicate', spaceId: 'ws-1', threadId: 't1' } },
        ],
      })),
    };

    const result = await queryRelevantThreadMessages({
      env: { AI: mockAI, VECTORIZE: mockVectorize } as any,
      spaceId: 'ws-1',
      threadId: 't1',
      query: 'test',
      topK: 5,
      minScore: 0.3,
    });

    expect(result).toHaveLength(1);
  });

  it('respects topK limit', async () => {
    const mockAI = {
      run: vi.fn(async () => ({ data: [[0.1]] })),
    };
    const matches = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`,
      score: 0.9 - i * 0.01,
      metadata: { sequence: i, role: 'user', content: `msg ${i}`, spaceId: 'ws-1', threadId: 't1' },
    }));
    const mockVectorize = {
      query: vi.fn(async () => ({ matches })),
    };

    const result = await queryRelevantThreadMessages({
      env: { AI: mockAI, VECTORIZE: mockVectorize } as any,
      spaceId: 'ws-1',
      threadId: 't1',
      query: 'test',
      topK: 3,
      minScore: 0.3,
    });

    expect(result).toHaveLength(3);
  });
});

describe('constants', () => {
  it('THREAD_MESSAGE_VECTOR_KIND is thread_message', () => {
    expect(THREAD_MESSAGE_VECTOR_KIND).toBe('thread_message');
  });

  it('DEFAULT_MAX_MESSAGES_PER_THREAD_INDEX_JOB is 200', () => {
    expect(DEFAULT_MAX_MESSAGES_PER_THREAD_INDEX_JOB).toBe(200);
  });
});
