import { assertEquals, assertNotEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/llm'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/model-catalog'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/utils/logger'
import {
  buildThreadContextSystemMessage,
  queryRelevantThreadMessages,
  THREAD_MESSAGE_VECTOR_KIND,
  DEFAULT_MAX_MESSAGES_PER_THREAD_INDEX_JOB,
  type RetrievedThreadMessage,
} from '@/services/agent/thread-context';


  Deno.test('buildThreadContextSystemMessage - returns null when no content is available', () => {
  const result = buildThreadContextSystemMessage({
      summary: null,
      keyPointsJson: '[]',
      retrieved: [],
      maxChars: 5000,
    });
    assertEquals(result, null);
})
  Deno.test('buildThreadContextSystemMessage - includes summary when provided', () => {
  const result = buildThreadContextSystemMessage({
      summary: 'This thread is about fixing a bug.',
      keyPointsJson: '[]',
      retrieved: [],
      maxChars: 5000,
    });

    assertNotEquals(result, null);
    assertEquals(result!.role, 'system');
    assertStringIncludes(result!.content, '[THREAD_CONTEXT]');
    assertStringIncludes(result!.content, 'Summary:');
    assertStringIncludes(result!.content, 'This thread is about fixing a bug.');
    assertStringIncludes(result!.content, '[/THREAD_CONTEXT]');
})
  Deno.test('buildThreadContextSystemMessage - includes key points when provided', () => {
  const result = buildThreadContextSystemMessage({
      summary: null,
      keyPointsJson: JSON.stringify(['Point 1', 'Point 2']),
      retrieved: [],
      maxChars: 5000,
    });

    assertNotEquals(result, null);
    assertStringIncludes(result!.content, 'Key points:');
    assertStringIncludes(result!.content, '- Point 1');
    assertStringIncludes(result!.content, '- Point 2');
})
  Deno.test('buildThreadContextSystemMessage - limits key points to 12', () => {
  const points = Array.from({ length: 20 }, (_, i) => `Point ${i + 1}`);
    const result = buildThreadContextSystemMessage({
      summary: 'Test',
      keyPointsJson: JSON.stringify(points),
      retrieved: [],
      maxChars: 50000,
    });

    assertStringIncludes(result!.content, '- Point 12');
    assert(!(result!.content).includes('- Point 13'));
})
  Deno.test('buildThreadContextSystemMessage - includes retrieved messages with scores', () => {
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

    assertNotEquals(result, null);
    assertStringIncludes(result!.content, 'Relevant past messages');
    assertStringIncludes(result!.content, '[0.950]');
    assertStringIncludes(result!.content, '#5');
    assertStringIncludes(result!.content, 'What is the status?');
})
  Deno.test('buildThreadContextSystemMessage - truncates content to maxChars', () => {
  const result = buildThreadContextSystemMessage({
      summary: 'A'.repeat(5000),
      keyPointsJson: '[]',
      retrieved: [],
      maxChars: 100,
    });

    assertNotEquals(result, null);
    assert(result!.content.length <= 200); // truncate + marker
    assertStringIncludes(result!.content, 'truncated');
})
  Deno.test('buildThreadContextSystemMessage - includes injection warning', () => {
  const result = buildThreadContextSystemMessage({
      summary: 'Summary',
      keyPointsJson: '[]',
      retrieved: [],
      maxChars: 5000,
    });

    assertStringIncludes(result!.content, 'untrusted');
})
  Deno.test('buildThreadContextSystemMessage - handles malformed keyPointsJson gracefully', () => {
  const result = buildThreadContextSystemMessage({
      summary: 'Summary',
      keyPointsJson: 'not-json',
      retrieved: [],
      maxChars: 5000,
    });

    assertNotEquals(result, null);
    assertStringIncludes(result!.content, 'Summary');
})

  Deno.test('queryRelevantThreadMessages - returns empty array when AI or VECTORIZE is missing', async () => {
  const result = await queryRelevantThreadMessages({
      env: { AI: undefined, VECTORIZE: undefined } as any,
      spaceId: 'ws-1',
      threadId: 'thread-1',
      query: 'test query',
      topK: 5,
      minScore: 0.3,
    });
    assertEquals(result, []);
})
  Deno.test('queryRelevantThreadMessages - returns empty array for empty query', async () => {
  const result = await queryRelevantThreadMessages({
      env: { AI: {}, VECTORIZE: {} } as any,
      spaceId: 'ws-1',
      threadId: 'thread-1',
      query: '   ',
      topK: 5,
      minScore: 0.3,
    });
    assertEquals(result, []);
})
  Deno.test('queryRelevantThreadMessages - queries vector store and filters by minScore', async () => {
  const mockAI = {
      run: async () => ({ data: [[0.1, 0.2, 0.3]] }),
    };
    const mockVectorize = {
      query: async () => ({
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
      }),
    };

    const result = await queryRelevantThreadMessages({
      env: { AI: mockAI, VECTORIZE: mockVectorize } as any,
      spaceId: 'ws-1',
      threadId: 'thread-1',
      query: 'test query',
      topK: 5,
      minScore: 0.3,
    });

    assertEquals(result.length, 1);
    assertEquals(result[0].id, 'v1');
    assertEquals(result[0].score, 0.9);
    assertEquals(result[0].content, 'relevant content');
})
  Deno.test('queryRelevantThreadMessages - respects beforeSequence filter', async () => {
  const mockAI = {
      run: async () => ({ data: [[0.1, 0.2, 0.3]] }),
    };
    const mockVectorize = {
      query: async () => ({
        matches: [
          { id: 'v1', score: 0.9, metadata: { sequence: 10, role: 'user', content: 'msg', spaceId: 'ws-1', threadId: 't1' } },
          { id: 'v2', score: 0.8, metadata: { sequence: 3, role: 'user', content: 'earlier', spaceId: 'ws-1', threadId: 't1' } },
        ],
      }),
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

    assertEquals(result.length, 1);
    assertEquals(result[0].sequence, 3);
})
  Deno.test('queryRelevantThreadMessages - excludes specified sequences', async () => {
  const mockAI = {
      run: async () => ({ data: [[0.1, 0.2]] }),
    };
    const mockVectorize = {
      query: async () => ({
        matches: [
          { id: 'v1', score: 0.9, metadata: { sequence: 5, role: 'user', content: 'msg', spaceId: 'ws-1', threadId: 't1' } },
          { id: 'v2', score: 0.8, metadata: { sequence: 3, role: 'user', content: 'earlier', spaceId: 'ws-1', threadId: 't1' } },
        ],
      }),
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

    assertEquals(result.length, 1);
    assertEquals(result[0].sequence, 3);
})
  Deno.test('queryRelevantThreadMessages - deduplicates by sequence', async () => {
  const mockAI = {
      run: async () => ({ data: [[0.1]] }),
    };
    const mockVectorize = {
      query: async () => ({
        matches: [
          { id: 'v1', score: 0.9, metadata: { sequence: 5, role: 'user', content: 'msg', spaceId: 'ws-1', threadId: 't1' } },
          { id: 'v2', score: 0.8, metadata: { sequence: 5, role: 'user', content: 'duplicate', spaceId: 'ws-1', threadId: 't1' } },
        ],
      }),
    };

    const result = await queryRelevantThreadMessages({
      env: { AI: mockAI, VECTORIZE: mockVectorize } as any,
      spaceId: 'ws-1',
      threadId: 't1',
      query: 'test',
      topK: 5,
      minScore: 0.3,
    });

    assertEquals(result.length, 1);
})
  Deno.test('queryRelevantThreadMessages - respects topK limit', async () => {
  const mockAI = {
      run: async () => ({ data: [[0.1]] }),
    };
    const matches = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i}`,
      score: 0.9 - i * 0.01,
      metadata: { sequence: i, role: 'user', content: `msg ${i}`, spaceId: 'ws-1', threadId: 't1' },
    }));
    const mockVectorize = {
      query: async () => ({ matches }),
    };

    const result = await queryRelevantThreadMessages({
      env: { AI: mockAI, VECTORIZE: mockVectorize } as any,
      spaceId: 'ws-1',
      threadId: 't1',
      query: 'test',
      topK: 3,
      minScore: 0.3,
    });

    assertEquals(result.length, 3);
})

  Deno.test('constants - THREAD_MESSAGE_VECTOR_KIND is thread_message', () => {
  assertEquals(THREAD_MESSAGE_VECTOR_KIND, 'thread_message');
})
  Deno.test('constants - DEFAULT_MAX_MESSAGES_PER_THREAD_INDEX_JOB is 200', () => {
  assertEquals(DEFAULT_MAX_MESSAGES_PER_THREAD_INDEX_JOB, 200);
})
