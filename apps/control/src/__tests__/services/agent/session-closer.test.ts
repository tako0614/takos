import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  callRuntimeRequest: vi.fn(),
  SnapshotManager: vi.fn(),
  generateId: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
  sessions: { id: 'id', baseSnapshotId: 'baseSnapshotId', status: 'status', headSnapshotId: 'headSnapshotId', updatedAt: 'updatedAt' },
  accounts: { id: 'id', headSnapshotId: 'headSnapshotId', updatedAt: 'updatedAt' },
  accountMetadata: { accountId: 'accountId', key: 'key', value: 'value', createdAt: 'createdAt', updatedAt: 'updatedAt' },
  files: { accountId: 'accountId', path: 'path', sha256: 'sha256', id: 'id', size: 'size', origin: 'origin', kind: 'kind', visibility: 'visibility', createdAt: 'createdAt', updatedAt: 'updatedAt' },
  runs: { id: 'id', error: 'error' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
}));

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: mocks.callRuntimeRequest,
}));

vi.mock('@/services/sync/snapshot', () => ({
  SnapshotManager: mocks.SnapshotManager,
}));

vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils')>()),
  generateId: mocks.generateId,
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

import { autoCloseSession, type SessionCloserDeps } from '@/services/agent/session-closer';

function createMockDeps(overrides?: Partial<SessionCloserDeps>): SessionCloserDeps {
  return {
    env: {
      RUNTIME_HOST: { fetch: vi.fn() },
    } as any,
    db: {} as any,
    context: {
      spaceId: 'ws-1',
      threadId: 'thread-1',
      runId: 'run-1',
      userId: 'user-1',
    },
    checkCancellation: vi.fn(async () => false),
    emitEvent: vi.fn(async () => {}),
    getCurrentSessionId: vi.fn(async () => 'session-1'),
    ...overrides,
  };
}

function createDbMock() {
  const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const insertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
  });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn(async () => ({ baseSnapshotId: 'snap-1', status: 'running', error: '' })),
          all: vi.fn(async () => []),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({ set: updateSet }),
    insert: vi.fn().mockReturnValue({ values: insertValues }),
    delete: vi.fn().mockReturnValue({ where: deleteWhere }),
  };
}

describe('autoCloseSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateId.mockReturnValue('gen-id');
  });

  it('does nothing when no session exists', async () => {
    const deps = createMockDeps({
      getCurrentSessionId: vi.fn(async () => null),
    });

    await autoCloseSession(deps, 'completed');

    expect(mocks.callRuntimeRequest).not.toHaveBeenCalled();
  });

  it('does nothing when RUNTIME_HOST is missing', async () => {
    const deps = createMockDeps({
      env: {} as any,
    });

    await autoCloseSession(deps, 'completed');

    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining('RUNTIME_HOST'),
      expect.any(Object),
    );
  });

  it('marks session as discarded on failure status', async () => {
    const dbMock = createDbMock();
    mocks.getDb.mockReturnValue(dbMock);
    mocks.callRuntimeRequest.mockResolvedValue(new Response('ok', { status: 200 }));

    const deps = createMockDeps();
    await autoCloseSession(deps, 'failed');

    expect(dbMock.update).toHaveBeenCalled();
    expect(deps.emitEvent).toHaveBeenCalledWith('progress', expect.objectContaining({
      session_action: 'discarded',
    }));
  });

  it('destroys the runtime session in cleanup', async () => {
    const dbMock = createDbMock();
    mocks.getDb.mockReturnValue(dbMock);
    mocks.callRuntimeRequest.mockResolvedValue(new Response('ok', { status: 200 }));

    const deps = createMockDeps();
    await autoCloseSession(deps, 'failed');

    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(
      deps.env,
      '/session/destroy',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ session_id: 'session-1' }),
      }),
    );
  });

  it('commits snapshot on successful completion', async () => {
    const dbMock = createDbMock();
    mocks.getDb.mockReturnValue(dbMock);

    const mockSnapshotManager = {
      writeBlob: vi.fn(async (content: string) => ({
        hash: `hash-${content.slice(0, 5)}`,
        size: content.length,
      })),
      createSnapshot: vi.fn(async () => ({ id: 'new-snap-1' })),
    };
    mocks.SnapshotManager.mockImplementation(() => mockSnapshotManager);

    mocks.callRuntimeRequest.mockImplementation(async (_env, path) => {
      if (path === '/session/snapshot') {
        return new Response(JSON.stringify({
          files: [
            { path: 'src/index.ts', content: 'export {}', size: 9 },
          ],
        }), { status: 200 });
      }
      return new Response('ok', { status: 200 });
    });

    const deps = createMockDeps();
    await autoCloseSession(deps, 'completed');

    expect(mockSnapshotManager.writeBlob).toHaveBeenCalled();
    expect(mockSnapshotManager.createSnapshot).toHaveBeenCalled();
    expect(deps.emitEvent).toHaveBeenCalledWith('progress', expect.objectContaining({
      session_action: 'stopped',
    }));
  });

  it('handles snapshot fetch failure gracefully', async () => {
    const dbMock = createDbMock();
    mocks.getDb.mockReturnValue(dbMock);

    mocks.callRuntimeRequest.mockImplementation(async (_env, path) => {
      if (path === '/session/snapshot') {
        return new Response('error', { status: 500 });
      }
      return new Response('ok', { status: 200 });
    });

    const deps = createMockDeps();
    await autoCloseSession(deps, 'completed');

    // Should still mark session as stopped even if snapshot fails
    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to get snapshot'),
      expect.any(Object),
    );
  });

  it('emits error event when auto-close fails', async () => {
    const dbMock = createDbMock();
    // Make getDb throw on first call to simulate commit failure
    let callCount = 0;
    mocks.getDb.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error('DB connection failed');
      }
      return dbMock;
    });

    const deps = createMockDeps();
    await autoCloseSession(deps, 'completed');

    expect(mocks.logError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to auto-close session'),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('handles cancellation during snapshot fetch', async () => {
    const dbMock = createDbMock();
    mocks.getDb.mockReturnValue(dbMock);

    const deps = createMockDeps({
      checkCancellation: vi.fn(async () => true),
    });

    mocks.callRuntimeRequest.mockRejectedValue(new Error('Run cancelled while fetching auto-close snapshot'));

    await autoCloseSession(deps, 'completed');

    // Should handle the error gracefully
    expect(mocks.logError).toHaveBeenCalled();
  });

  it('handles session not running gracefully', async () => {
    const dbMock = createDbMock();
    // Override to return a non-running session
    dbMock.select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn(async () => ({ baseSnapshotId: 'snap-1', status: 'stopped', error: '' })),
          all: vi.fn(async () => []),
        }),
      }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    mocks.callRuntimeRequest.mockResolvedValue(new Response('ok', { status: 200 }));

    const deps = createMockDeps();
    await autoCloseSession(deps, 'completed');

    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining('Session not running'),
      expect.any(Object),
    );
  });
});
