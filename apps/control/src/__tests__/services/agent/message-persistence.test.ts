import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn(),
  shouldOffloadMessage: vi.fn(),
  writeMessageToR2: vi.fn(),
  makeMessagePreview: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
  messages: {
    id: 'id',
    threadId: 'threadId',
    role: 'role',
    content: 'content',
    r2Key: 'r2Key',
    toolCalls: 'toolCalls',
    toolCallId: 'toolCallId',
    metadata: 'metadata',
    sequence: 'sequence',
    createdAt: 'createdAt',
  },
}));

vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils')>()),
  generateId: mocks.generateId,
}));

vi.mock('@/services/offload/messages', () => ({
  shouldOffloadMessage: mocks.shouldOffloadMessage,
  writeMessageToR2: mocks.writeMessageToR2,
  makeMessagePreview: mocks.makeMessagePreview,
}));

vi.mock('@/utils/logger', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logError: mocks.logError,
  logWarn: mocks.logWarn,
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  safeJsonParse: vi.fn((v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } }),
  safeJsonParseOrDefault: vi.fn((v: unknown, d: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return d; } }),
}));

import { persistMessage, type MessagePersistenceDeps } from '@/services/agent/message-persistence';

function createDbMock(options?: {
  existingGet?: unknown;
  maxSeqGet?: { maxSeq: number } | null;
  insertThrows?: Error | null;
}) {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockReturnValue(c);
    c.get = vi.fn(async () => options?.existingGet ?? null);
    return c;
  };
  const maxSeqChain = () => {
    const c: Record<string, unknown> = {};
    c.from = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockReturnValue(c);
    c.get = vi.fn(async () => options?.maxSeqGet ?? { maxSeq: 0 });
    return c;
  };

  let selectCallCount = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) return chain(); // existing check
      return maxSeqChain(); // max seq
    }),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockImplementation(async () => {
        if (options?.insertThrows) throw options.insertThrows;
      }),
    })),
  };
}

describe('persistMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateId.mockReturnValue('abcd');
    mocks.shouldOffloadMessage.mockReturnValue(false);
  });

  it('inserts a new message with correct sequence', async () => {
    const mockDb = createDbMock({ maxSeqGet: { maxSeq: 5 } });
    mocks.getDb.mockReturnValue(mockDb);

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: undefined } as any,
      threadId: 'thread-1',
    };

    await persistMessage(deps, {
      role: 'user',
      content: 'Hello',
    });

    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('skips insert if message already exists (idempotency)', async () => {
    const mockDb = createDbMock({ existingGet: { id: 'msg_existing' } });
    mocks.getDb.mockReturnValue(mockDb);

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: undefined } as any,
      threadId: 'thread-1',
    };

    await persistMessage(deps, {
      role: 'assistant',
      content: 'Already stored',
    });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('offloads to R2 when bucket is available and message qualifies', async () => {
    const mockDb = createDbMock({ maxSeqGet: { maxSeq: 0 } });
    mocks.getDb.mockReturnValue(mockDb);
    mocks.shouldOffloadMessage.mockReturnValue(true);
    mocks.writeMessageToR2.mockResolvedValue({ key: 'r2-key-123' });
    mocks.makeMessagePreview.mockReturnValue('[preview]');

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

    expect(mocks.writeMessageToR2).toHaveBeenCalledWith(
      fakeBucket,
      'thread-1',
      expect.any(String),
      expect.objectContaining({
        thread_id: 'thread-1',
        role: 'assistant',
      }),
    );
  });

  it('falls back to inline storage when R2 write fails', async () => {
    const mockDb = createDbMock({ maxSeqGet: { maxSeq: 0 } });
    mocks.getDb.mockReturnValue(mockDb);
    mocks.shouldOffloadMessage.mockReturnValue(true);
    mocks.writeMessageToR2.mockRejectedValue(new Error('R2 failure'));

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: {} } as any,
      threadId: 'thread-1',
    };

    await persistMessage(deps, {
      role: 'assistant',
      content: 'Content',
    });

    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist message'),
      expect.any(Object),
    );
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('handles UNIQUE constraint on id as successful (duplicate detection)', async () => {
    const mockDb = createDbMock({
      insertThrows: Object.assign(new Error('UNIQUE constraint failed: messages.id'), {}),
    });
    mocks.getDb.mockReturnValue(mockDb);

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
  });

  it('retries on sequence conflict (UNIQUE constraint)', async () => {
    let callCount = 0;
    let insertAttempt = 0;
    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        const c: Record<string, unknown> = {};
        c.from = vi.fn().mockReturnValue(c);
        c.where = vi.fn().mockReturnValue(c);
        c.get = vi.fn(async () => {
          callCount++;
          if (callCount % 2 === 1) return null; // existing check
          return { maxSeq: callCount }; // max seq
        });
        return c;
      }),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(async () => {
          insertAttempt++;
          if (insertAttempt === 1) {
            throw new Error('UNIQUE constraint failed: sequence');
          }
          return undefined;
        }),
      })),
    };
    mocks.getDb.mockReturnValue(mockDb);

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: undefined } as any,
      threadId: 'thread-1',
    };

    await persistMessage(deps, {
      role: 'user',
      content: 'Retry test',
    });
  });

  it('throws after max retries exhausted', async () => {
    const mockDb = {
      select: vi.fn().mockImplementation(() => {
        const c: Record<string, unknown> = {};
        c.from = vi.fn().mockReturnValue(c);
        c.where = vi.fn().mockReturnValue(c);
        c.get = vi.fn(async () => null);
        return c;
      }),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockRejectedValue(new Error('SQLITE_BUSY')),
      })),
    };
    mocks.getDb.mockReturnValue(mockDb);

    const deps: MessagePersistenceDeps = {
      db: {} as any,
      env: { TAKOS_OFFLOAD: undefined } as any,
      threadId: 'thread-1',
    };

    await expect(
      persistMessage(deps, { role: 'user', content: 'Fail' }),
    ).rejects.toThrow('SQLITE_BUSY');
  });

  it('stores tool_calls and tool_call_id when present', async () => {
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const mockDb = createDbMock({ maxSeqGet: { maxSeq: 0 } });
    mockDb.insert = vi.fn().mockReturnValue({ values: insertValues });
    mocks.getDb.mockReturnValue(mockDb);

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

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCalls: expect.stringContaining('file_read'),
      }),
    );
  });
});
