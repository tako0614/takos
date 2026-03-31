import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  checkWorkspaceAccess: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
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
  const get = (async () => options.selectGet);
  const all = (async () => options.selectAll ?? []);
  const chainable = { get, all, limit: (function(this: any) { return this; }), offset: (function(this: any) { return this; }), orderBy: (function(this: any) { return this; }) };
  const where = (() => chainable);
  const from = (() => ({ where, get, all, orderBy: (() => chainable) }));
  const select = (() => ({ from }));

  const returningGet = (async () => options.insertGet);
  const returning = (() => ({ get: returningGet }));
  const values = (() => ({ returning }));
  const insert = (() => ({ values }));

  const set = (() => ({ where: (() => ({ returning: (() => ({ get: ((..._args: any[]) => undefined) as any })) })) }));
  const update = (() => ({ set }));

  return { select, insert, update, from, where, get, all };
}


  Deno.test('thread access fallback guards (issue 186) - rejects invalid IDs before DB query', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await assertEquals(await checkThreadAccess({} as D1Database, 'bad id', 'user-1'), null);
    assertSpyCalls(mocks.getDb, 0);
})
  Deno.test('thread access fallback guards (issue 186) - returns thread access when thread exists and user has workspace access', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    mocks.getDb = (() => drizzleMock) as any;
    mocks.checkWorkspaceAccess = (async () => ({
      workspace: { id: 'ws-1' },
      member: { role: 'owner' },
    })) as any;

    const result = await checkThreadAccess({} as D1Database, 'thread-1', 'user-1');

    assertEquals(result, {
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
})
  Deno.test('thread access fallback guards (issue 186) - returns null when thread not found in DB', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzleMock = createDrizzleMock({ selectGet: undefined });
    mocks.getDb = (() => drizzleMock) as any;

    const result = await checkThreadAccess({} as D1Database, 'thread-1', 'user-1');

    assertEquals(result, null);
})
  Deno.test('thread access fallback guards (issue 186) - returns null when user has no workspace access', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    mocks.getDb = (() => drizzleMock) as any;
    mocks.checkWorkspaceAccess = (async () => null) as any;

    const result = await checkThreadAccess({} as D1Database, 'thread-1', 'user-1');

    assertEquals(result, null);
})
  Deno.test('thread access fallback guards (issue 186) - lists thread messages via Drizzle query', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    const allMessages = (async () => [messageRow]);
    const countGet = (async () => ({ count: 1 }));
    const allRuns = (async () => [runRow]);

    let callIdx = 0;
    const drizzleMock = {
      select: () => {
        callIdx++;
        if (callIdx === 1) {
          // messages select
          return {
            from: (() => ({
              where: (() => ({
                orderBy: (() => ({
                  limit: (() => ({
                    offset: (() => ({
                      all: allMessages,
                    })),
                  })),
                })),
              })),
            })),
          };
        }
        if (callIdx === 2) {
          // count select
          return {
            from: (() => ({
              where: (() => ({
                get: countGet,
              })),
            })),
          };
        }
        // runs select
        return {
          from: (() => ({
            where: (() => ({
              orderBy: (() => ({
                limit: (() => ({
                  all: allRuns,
                })),
              })),
            })),
          })),
        };
      },
    };
    mocks.getDb = (() => drizzleMock) as any;

    const result = await listThreadMessages({} as never, {} as D1Database, 'thread-1', 100, 0);

    assertEquals(result, {
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
})
  Deno.test('thread access fallback guards (issue 186) - creates a thread via Drizzle insert', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    mocks.getDb = (() => drizzleMock) as any;

    const result = await createThread({} as D1Database, 'ws-1', { title: 'Hello' });

    assertObjectMatch(result, {
      space_id: 'ws-1',
      title: 'Hello',
      status: 'active',
      summary: null,
      key_points: '[]',
      retrieval_index: -1,
      context_window: 50,
    });
})