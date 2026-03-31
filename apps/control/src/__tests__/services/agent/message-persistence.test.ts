import { assert, assertRejects } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: ((..._args: any[]) => undefined) as any,
  shouldOffloadMessage: ((..._args: any[]) => undefined) as any,
  writeMessageToR2: ((..._args: any[]) => undefined) as any,
  makeMessagePreview: ((..._args: any[]) => undefined) as any,
  logError: ((..._args: any[]) => undefined) as any,
  logWarn: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/offload/messages'
// [Deno] vi.mock removed - manually stub imports from '@/utils/logger'
import { persistMessage, type MessagePersistenceDeps } from '@/services/agent/message-persistence';

function createDbMock(options?: {
  existingGet?: unknown;
  maxSeqGet?: { maxSeq: number } | null;
  insertThrows?: Error | null;
}) {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = (() => c);
    c.where = (() => c);
    c.get = async () => options?.existingGet ?? null;
    return c;
  };
  const maxSeqChain = () => {
    const c: Record<string, unknown> = {};
    c.from = (() => c);
    c.where = (() => c);
    c.get = async () => options?.maxSeqGet ?? { maxSeq: 0 };
    return c;
  };

  let selectCallCount = 0;
  return {
    select: () => {
      selectCallCount++;
      if (selectCallCount === 1) return chain(); // existing check
      return maxSeqChain(); // max seq
    },
    insert: () => ({
      values: async () => {
        if (options?.insertThrows) throw options.insertThrows;
      },
    }),
  };
}


  Deno.test('persistMessage - inserts a new message with correct sequence', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'abcd') as any;
    mocks.shouldOffloadMessage = (() => false) as any;
  const mockDb = createDbMock({ maxSeqGet: { maxSeq: 5 } });
    mocks.getDb = (() => mockDb) as any;

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: undefined } as any,
      threadId: 'thread-1',
    };

    await persistMessage(deps, {
      role: 'user',
      content: 'Hello',
    });

    assert(mockDb.insert.calls.length > 0);
})
  Deno.test('persistMessage - skips insert if message already exists (idempotency)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'abcd') as any;
    mocks.shouldOffloadMessage = (() => false) as any;
  const mockDb = createDbMock({ existingGet: { id: 'msg_existing' } });
    mocks.getDb = (() => mockDb) as any;

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: undefined } as any,
      threadId: 'thread-1',
    };

    await persistMessage(deps, {
      role: 'assistant',
      content: 'Already stored',
    });

    assertSpyCalls(mockDb.insert, 0);
})
  Deno.test('persistMessage - offloads to R2 when bucket is available and message qualifies', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'abcd') as any;
    mocks.shouldOffloadMessage = (() => false) as any;
  const mockDb = createDbMock({ maxSeqGet: { maxSeq: 0 } });
    mocks.getDb = (() => mockDb) as any;
    mocks.shouldOffloadMessage = (() => true) as any;
    mocks.writeMessageToR2 = (async () => ({ key: 'r2-key-123' })) as any;
    mocks.makeMessagePreview = (() => '[preview]') as any;

    const fakeBucket = {};
    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: fakeBucket } as any,
      threadId: 'thread-1',
    };

    await persistMessage(deps, {
      role: 'assistant',
      content: 'Long content to offload',
    });

    assertSpyCallArgs(mocks.writeMessageToR2, 0, [
      fakeBucket,
      'thread-1',
      /* expect.any(String) */ {} as any,
      ({
        thread_id: 'thread-1',
        role: 'assistant',
      }),
    ]);
})
  Deno.test('persistMessage - falls back to inline storage when R2 write fails', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'abcd') as any;
    mocks.shouldOffloadMessage = (() => false) as any;
  const mockDb = createDbMock({ maxSeqGet: { maxSeq: 0 } });
    mocks.getDb = (() => mockDb) as any;
    mocks.shouldOffloadMessage = (() => true) as any;
    mocks.writeMessageToR2 = (async () => { throw new Error('R2 failure'); }) as any;

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: {} } as any,
      threadId: 'thread-1',
    };

    await persistMessage(deps, {
      role: 'assistant',
      content: 'Content',
    });

    assertSpyCallArgs(mocks.logWarn, 0, [
      expect.stringContaining('Failed to persist message'),
      /* expect.any(Object) */ {} as any,
    ]);
    assert(mockDb.insert.calls.length > 0);
})
  Deno.test('persistMessage - handles UNIQUE constraint on id as successful (duplicate detection)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'abcd') as any;
    mocks.shouldOffloadMessage = (() => false) as any;
  const mockDb = createDbMock({
      insertThrows: Object.assign(new Error('UNIQUE constraint failed: messages.id'), {}),
    });
    mocks.getDb = (() => mockDb) as any;

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: undefined } as any,
      threadId: 'thread-1',
    };

    // Should not throw for duplicate ID
    await persistMessage(deps, {
      role: 'user',
      content: 'Hello',
    });
})
  Deno.test('persistMessage - retries on sequence conflict (UNIQUE constraint)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'abcd') as any;
    mocks.shouldOffloadMessage = (() => false) as any;
  let callCount = 0;
    let insertAttempt = 0;
    const mockDb = {
      select: () => {
        const c: Record<string, unknown> = {};
        c.from = (() => c);
        c.where = (() => c);
        c.get = async () => {
          callCount++;
          if (callCount % 2 === 1) return null; // existing check
          return { maxSeq: callCount }; // max seq
        };
        return c;
      },
      insert: () => ({
        values: async () => {
          insertAttempt++;
          if (insertAttempt === 1) {
            throw new Error('UNIQUE constraint failed: sequence');
          }
          return undefined;
        },
      }),
    };
    mocks.getDb = (() => mockDb) as any;

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: undefined } as any,
      threadId: 'thread-1',
    };

    await persistMessage(deps, {
      role: 'user',
      content: 'Retry test',
    });
})
  Deno.test('persistMessage - throws after max retries exhausted', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'abcd') as any;
    mocks.shouldOffloadMessage = (() => false) as any;
  const mockDb = {
      select: () => {
        const c: Record<string, unknown> = {};
        c.from = (() => c);
        c.where = (() => c);
        c.get = async () => null;
        return c;
      },
      insert: () => ({
        values: (async () => { throw new Error('SQLITE_BUSY'); }),
      }),
    };
    mocks.getDb = (() => mockDb) as any;

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: undefined } as any,
      threadId: 'thread-1',
    };

    await await assertRejects(async () => { await 
      persistMessage(deps, { role: 'user', content: 'Fail' }),
    ; }, 'SQLITE_BUSY');
})
  Deno.test('persistMessage - stores tool_calls and tool_call_id when present', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'abcd') as any;
    mocks.shouldOffloadMessage = (() => false) as any;
  const insertValues = (async () => undefined);
    const mockDb = createDbMock({ maxSeqGet: { maxSeq: 0 } });
    mockDb.insert = (() => ({ values: insertValues }));
    mocks.getDb = (() => mockDb) as any;

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: undefined } as any,
      threadId: 'thread-1',
    };

    await persistMessage(deps, {
      role: 'assistant',
      content: 'calling tool',
      tool_calls: [{ id: 'tc1', name: 'file_read', arguments: { path: '/test' } }],
    });

    assertSpyCallArgs(insertValues, 0, [
      ({
        toolCalls: expect.stringContaining('file_read'),
      }),
    ]);
})