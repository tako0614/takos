import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('@/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils')>();
  return {
    ...actual,
    checkWorkspaceAccess: mocks.checkWorkspaceAccess,
  };
});

import { checkThreadAccess, createThread, listThreadMessages } from '@/services/threads/thread-service';

/**
 * Creates a chainable mock Drizzle client supporting the common patterns:
 *   select().from().where().get()
 *   select().from().where().orderBy().limit().offset().all()
 *   insert().values().returning().get()
 */
function createDrizzleMock(options: {
  selectGet?: unknown;
  selectAll?: unknown[];
  insertGet?: unknown;
} = {}) {
  const get = vi.fn().mockResolvedValue(options.selectGet);
  const all = vi.fn().mockResolvedValue(options.selectAll ?? []);
  const chainable = { get, all, limit: vi.fn().mockReturnThis(), offset: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis() };
  const where = vi.fn().mockReturnValue(chainable);
  const from = vi.fn().mockReturnValue({ where, get, all, orderBy: vi.fn().mockReturnValue(chainable) });
  const select = vi.fn().mockReturnValue({ from });

  const returningGet = vi.fn().mockResolvedValue(options.insertGet);
  const returning = vi.fn().mockReturnValue({ get: returningGet });
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });

  const set = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockReturnValue({ get: vi.fn() }) }) });
  const update = vi.fn().mockReturnValue({ set });

  return { select, insert, update, from, where, get, all };
}

describe('thread access fallback guards (issue 186)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid IDs before DB query', async () => {
    await expect(checkThreadAccess({} as D1Database, 'bad id', 'user-1')).resolves.toBeNull();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('returns thread access when thread exists and user has workspace access', async () => {
    const drizzleMock = createDrizzleMock({
      selectGet: {
        id: 'thread-1',
        accountId: 'ws-1',
        title: 'Hello',
        locale: null,
        status: 'active',
        summary: null,
        keyPoints: '[]',
        retrievalIndex: -1,
        contextWindow: 50,
        createdAt: '2026-02-13T00:00:00.000Z',
        updatedAt: '2026-02-13T00:00:00.000Z',
      },
    });
    mocks.getDb.mockReturnValue(drizzleMock);
    mocks.checkWorkspaceAccess.mockResolvedValue({
      workspace: { id: 'ws-1' },
      member: { role: 'owner' },
    });

    const result = await checkThreadAccess({} as D1Database, 'thread-1', 'user-1');

    expect(result).toEqual({
      thread: {
        id: 'thread-1',
        space_id: 'ws-1',
        title: 'Hello',
        locale: null,
        status: 'active',
        summary: null,
        key_points: '[]',
        retrieval_index: -1,
        context_window: 50,
        created_at: '2026-02-13T00:00:00.000Z',
        updated_at: '2026-02-13T00:00:00.000Z',
      },
      role: 'owner',
    });
  });

  it('returns null when thread not found in DB', async () => {
    const drizzleMock = createDrizzleMock({ selectGet: undefined });
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await checkThreadAccess({} as D1Database, 'thread-1', 'user-1');

    expect(result).toBeNull();
  });

  it('returns null when user has no workspace access', async () => {
    const drizzleMock = createDrizzleMock({
      selectGet: {
        id: 'thread-1',
        accountId: 'ws-1',
        title: 'Hello',
        locale: null,
        status: 'active',
        summary: null,
        keyPoints: '[]',
        retrievalIndex: -1,
        contextWindow: 50,
        createdAt: '2026-02-13T00:00:00.000Z',
        updatedAt: '2026-02-13T00:00:00.000Z',
      },
    });
    mocks.getDb.mockReturnValue(drizzleMock);
    mocks.checkWorkspaceAccess.mockResolvedValue(null);

    const result = await checkThreadAccess({} as D1Database, 'thread-1', 'user-1');

    expect(result).toBeNull();
  });

  it('lists thread messages via Drizzle query', async () => {
    const messageRow = {
      id: 'msg-1',
      threadId: 'thread-1',
      role: 'user',
      content: 'hello',
      r2Key: null,
      toolCalls: null,
      toolCallId: null,
      metadata: '{}',
      sequence: 1,
      createdAt: '2026-03-06T10:00:00.000Z',
    };
    const runRow = {
      id: 'run-1',
      threadId: 'thread-1',
      accountId: 'ws-1',
      sessionId: null,
      parentRunId: null,
      childThreadId: null,
      rootThreadId: 'thread-1',
      rootRunId: 'run-1',
      agentType: 'default',
      status: 'completed',
      input: '{}',
      output: null,
      error: null,
      usage: '{}',
      workerId: null,
      workerHeartbeat: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-03-06T10:01:00.000Z',
    };

    // Build a more elaborate mock that handles different .from() calls
    const allMessages = vi.fn().mockResolvedValue([messageRow]);
    const countGet = vi.fn().mockResolvedValue({ count: 1 });
    const allRuns = vi.fn().mockResolvedValue([runRow]);

    let callIdx = 0;
    const drizzleMock = {
      select: vi.fn().mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) {
          // messages select
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    offset: vi.fn().mockReturnValue({
                      all: allMessages,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (callIdx === 2) {
          // count select
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                get: countGet,
              }),
            }),
          };
        }
        // runs select
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  all: allRuns,
                }),
              }),
            }),
          }),
        };
      }),
    };
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await listThreadMessages({} as never, {} as D1Database, 'thread-1', 100, 0);

    expect(result).toEqual({
      messages: [
        {
          id: 'msg-1',
          thread_id: 'thread-1',
          role: 'user',
          content: 'hello',
          tool_calls: null,
          tool_call_id: null,
          metadata: '{}',
          sequence: 1,
          created_at: '2026-03-06T10:00:00.000Z',
        },
      ],
      total: 1,
      runs: [
        {
          id: 'run-1',
          thread_id: 'thread-1',
          space_id: 'ws-1',
          session_id: null,
          parent_run_id: null,
          child_thread_id: null,
          root_thread_id: 'thread-1',
          root_run_id: 'run-1',
          agent_type: 'default',
          status: 'completed',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          worker_id: null,
          worker_heartbeat: null,
          started_at: null,
          completed_at: null,
          created_at: '2026-03-06T10:01:00.000Z',
        },
      ],
    });
  });

  it('creates a thread via Drizzle insert', async () => {
    const insertedRow = {
      id: 'new-thread-id',
      accountId: 'ws-1',
      title: 'Hello',
      locale: null,
      status: 'active',
      summary: null,
      keyPoints: '[]',
      retrievalIndex: -1,
      contextWindow: 50,
      createdAt: '2026-03-06T00:00:00.000Z',
      updatedAt: '2026-03-06T00:00:00.000Z',
    };
    const drizzleMock = createDrizzleMock({ insertGet: insertedRow });
    mocks.getDb.mockReturnValue(drizzleMock);

    const result = await createThread({} as D1Database, 'ws-1', { title: 'Hello' });

    expect(result).toMatchObject({
      space_id: 'ws-1',
      title: 'Hello',
      status: 'active',
      summary: null,
      key_points: '[]',
      retrieval_index: -1,
      context_window: 50,
    });
  });
});
