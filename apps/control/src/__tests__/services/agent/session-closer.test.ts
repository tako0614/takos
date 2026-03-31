import { assert } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  callRuntimeRequest: ((..._args: any[]) => undefined) as any,
  SnapshotManager: ((..._args: any[]) => undefined) as any,
  generateId: ((..._args: any[]) => undefined) as any,
  logError: ((..._args: any[]) => undefined) as any,
  logWarn: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/sync/snapshot'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/utils/logger'
import { autoCloseSession, type SessionCloserDeps } from '@/services/agent/session-closer';

function createMockDeps(overrides?: Partial<SessionCloserDeps>): SessionCloserDeps {
  return {
    env: {
      RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    } as any,
    db: {} as any,
    context: {
      spaceId: 'ws-1',
      threadId: 'thread-1',
      runId: 'run-1',
      userId: 'user-1',
    },
    checkCancellation: async () => false,
    emitEvent: async () => {},
    getCurrentSessionId: async () => 'session-1',
    ...overrides,
  };
}

function createDbMock() {
  const updateSet = (() => ({ where: (async () => undefined) }));
  const insertValues = (() => ({
    onConflictDoUpdate: (() => ({ returning: (async () => []) })),
  }));
  const deleteWhere = (async () => undefined);

  return {
    select: (() => ({
      from: (() => ({
        where: (() => ({
          get: async () => ({ baseSnapshotId: 'snap-1', status: 'running', error: '' }),
          all: async () => [],
        })),
      })),
    })),
    update: (() => ({ set: updateSet })),
    insert: (() => ({ values: insertValues })),
    delete: (() => ({ where: deleteWhere })),
  };
}


  Deno.test('autoCloseSession - does nothing when no session exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'gen-id') as any;
  const deps = createMockDeps({
      getCurrentSessionId: async () => null,
    });

    await autoCloseSession(deps, 'completed');

    assertSpyCalls(mocks.callRuntimeRequest, 0);
})
  Deno.test('autoCloseSession - does nothing when RUNTIME_HOST is missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'gen-id') as any;
  const deps = createMockDeps({
      env: {} as any,
    });

    await autoCloseSession(deps, 'completed');

    assertSpyCallArgs(mocks.logWarn, 0, [
      expect.stringContaining('RUNTIME_HOST'),
      /* expect.any(Object) */ {} as any,
    ]);
})
  Deno.test('autoCloseSession - marks session as discarded on failure status', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'gen-id') as any;
  const dbMock = createDbMock();
    mocks.getDb = (() => dbMock) as any;
    mocks.callRuntimeRequest = (async () => new Response('ok', { status: 200 })) as any;

    const deps = createMockDeps();
    await autoCloseSession(deps, 'failed');

    assert(dbMock.update.calls.length > 0);
    assertSpyCallArgs(deps.emitEvent, 0, ['progress', ({
      session_action: 'discarded',
    })]);
})
  Deno.test('autoCloseSession - destroys the runtime session in cleanup', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'gen-id') as any;
  const dbMock = createDbMock();
    mocks.getDb = (() => dbMock) as any;
    mocks.callRuntimeRequest = (async () => new Response('ok', { status: 200 })) as any;

    const deps = createMockDeps();
    await autoCloseSession(deps, 'failed');

    assertSpyCallArgs(mocks.callRuntimeRequest, 0, [
      deps.env,
      '/session/destroy',
      ({
        method: 'POST',
        body: ({ session_id: 'session-1' }),
      }),
    ]);
})
  Deno.test('autoCloseSession - commits snapshot on successful completion', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'gen-id') as any;
  const dbMock = createDbMock();
    mocks.getDb = (() => dbMock) as any;

    const mockSnapshotManager = {
      writeBlob: async (content: string) => ({
        hash: `hash-${content.slice(0, 5)}`,
        size: content.length,
      }),
      createSnapshot: async () => ({ id: 'new-snap-1' }),
    };
    mocks.SnapshotManager = () => mockSnapshotManager as any;

    mocks.callRuntimeRequest = async (_env, path) => {
      if (path === '/session/snapshot') {
        return new Response(JSON.stringify({
          files: [
            { path: 'src/index.ts', content: 'export {}', size: 9 },
          ],
        }), { status: 200 });
      }
      return new Response('ok', { status: 200 });
    } as any;

    const deps = createMockDeps();
    await autoCloseSession(deps, 'completed');

    assert(mockSnapshotManager.writeBlob.calls.length > 0);
    assert(mockSnapshotManager.createSnapshot.calls.length > 0);
    assertSpyCallArgs(deps.emitEvent, 0, ['progress', ({
      session_action: 'stopped',
    })]);
})
  Deno.test('autoCloseSession - handles snapshot fetch failure gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'gen-id') as any;
  const dbMock = createDbMock();
    mocks.getDb = (() => dbMock) as any;

    mocks.callRuntimeRequest = async (_env, path) => {
      if (path === '/session/snapshot') {
        return new Response('error', { status: 500 });
      }
      return new Response('ok', { status: 200 });
    } as any;

    const deps = createMockDeps();
    await autoCloseSession(deps, 'completed');

    // Should still mark session as stopped even if snapshot fails
    assertSpyCallArgs(mocks.logWarn, 0, [
      expect.stringContaining('Failed to get snapshot'),
      /* expect.any(Object) */ {} as any,
    ]);
})
  Deno.test('autoCloseSession - emits error event when auto-close fails', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'gen-id') as any;
  const dbMock = createDbMock();
    // Make getDb throw on first call to simulate commit failure
    let callCount = 0;
    mocks.getDb = () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('DB connection failed');
      }
      return dbMock;
    } as any;

    const deps = createMockDeps();
    await autoCloseSession(deps, 'completed');

    assertSpyCallArgs(mocks.logError, 0, [
      expect.stringContaining('Failed to auto-close session'),
      /* expect.any(String) */ {} as any,
      /* expect.any(Object) */ {} as any,
    ]);
})
  Deno.test('autoCloseSession - handles cancellation during snapshot fetch', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'gen-id') as any;
  const dbMock = createDbMock();
    mocks.getDb = (() => dbMock) as any;

    const deps = createMockDeps({
      checkCancellation: async () => true,
    });

    mocks.callRuntimeRequest = (async () => { throw new Error('Run cancelled while fetching auto-close snapshot'); }) as any;

    await autoCloseSession(deps, 'completed');

    // Should handle the error gracefully
    assert(mocks.logError.calls.length > 0);
})
  Deno.test('autoCloseSession - handles session not running gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'gen-id') as any;
  const dbMock = createDbMock();
    // Override to return a non-running session
    dbMock.select = (() => ({
      from: (() => ({
        where: (() => ({
          get: async () => ({ baseSnapshotId: 'snap-1', status: 'stopped', error: '' }),
          all: async () => [],
        })),
      })),
    }));
    mocks.getDb = (() => dbMock) as any;

    mocks.callRuntimeRequest = (async () => new Response('ok', { status: 200 })) as any;

    const deps = createMockDeps();
    await autoCloseSession(deps, 'completed');

    assertSpyCallArgs(mocks.logWarn, 0, [
      expect.stringContaining('Session not running'),
      /* expect.any(Object) */ {} as any,
    ]);
})