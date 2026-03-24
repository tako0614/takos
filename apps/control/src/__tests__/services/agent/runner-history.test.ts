import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, R2Bucket } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  queryRelevantThreadMessages: vi.fn(),
  buildThreadContextSystemMessage: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/agent/thread-context', () => ({
  queryRelevantThreadMessages: mocks.queryRelevantThreadMessages,
  buildThreadContextSystemMessage: mocks.buildThreadContextSystemMessage,
}));

import { buildConversationHistory } from '@/services/agent/runner';

function makeDbMock(selectGetResults: unknown[], selectAllResults: unknown[]) {
  let getIndex = 0;
  let allIndex = 0;
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockReturnValue(c);
    c.orderBy = vi.fn().mockReturnValue(c);
    c.limit = vi.fn().mockReturnValue(c);
    c.all = vi.fn(async () => selectAllResults[allIndex++] ?? []);
    c.get = vi.fn(async () => selectGetResults[getIndex++] ?? null);
    return c;
  };
  return {
    select: vi.fn().mockImplementation(() => chain()),
  };
}

describe('buildConversationHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRelevantThreadMessages.mockResolvedValue([]);
    mocks.buildThreadContextSystemMessage.mockReturnValue(null);
  });

  it('builds delegated child context from the structured delegation packet', async () => {
    mocks.getDb.mockReturnValue(makeDbMock(
      [
        {
          summary: null,
          keyPoints: '[]',
        },
        {
          parentRunId: 'parent-run',
          input: JSON.stringify({
            delegation: {
              task: 'Implement the fix',
              goal: 'Improve sub-agent autonomy',
              deliverable: 'A passing test suite and code changes',
              constraints: ['Do not change unrelated files'],
              context: ['The parent already isolated the bug'],
              acceptance_criteria: ['All targeted tests pass'],
              product_hint: 'takos',
              locale: 'ja',
              parent_run_id: 'parent-run',
              parent_thread_id: 'thread-1',
              root_thread_id: 'thread-1',
              thread_summary: 'Parent is fixing agent delegation',
              thread_key_points: ['sub-agent should receive explicit context'],
            },
          }),
        },
      ],
      [
        [],
      ],
    ));

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'child-thread-1',
      runId: 'child-run',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-mini',
    });

    expect(history).toEqual([
      {
        role: 'system',
        content: expect.stringContaining('Delegated execution context:'),
      },
      {
        role: 'user',
        content: expect.stringContaining('Implement the fix'),
      },
    ]);
    expect(history[0]?.content).toContain('Product hint: takos');
    expect(history[0]?.content).toContain('Constraints:');
    expect(history[0]?.content).toContain('Acceptance criteria:');
  });
});
