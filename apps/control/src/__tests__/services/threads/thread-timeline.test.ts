import type { Env } from '@/types';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  listThreadMessages: ((..._args: any[]) => undefined) as any,
  isValidOpaqueId: ((..._args: any[]) => undefined) as any,
  logError: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-service'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/db-guards'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import { getThreadTimeline } from '@/services/threads/thread-timeline';

function makeRun(overrides: Partial<{
  id: string;
  status: string;
  session_id: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'run-1',
    thread_id: 'thread-1',
    space_id: 'ws-1',
    session_id: overrides.session_id ?? null,
    parent_run_id: null,
    child_thread_id: null,
    root_thread_id: 'thread-1',
    root_run_id: 'run-1',
    agent_type: 'default',
    status: overrides.status ?? 'completed',
    input: '{}',
    output: null,
    error: null,
    usage: '{}',
    worker_id: null,
    worker_heartbeat: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-03-01T00:00:00.000Z',
  };
}

function makeEnv(): Env {
  return { DB: {} } as Env;
}

function makeDrizzleMock(sessionRow?: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = (() => chain);
  chain.where = (() => chain);
  chain.get = (async () => sessionRow ?? null);
  return {
    select: (() => chain),
  };
}


  Deno.test('getThreadTimeline - returns messages, total, and no active run or pending session diff', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  const messages = [
      { id: 'msg-1', thread_id: 'thread-1', role: 'user', content: 'hi', sequence: 0, created_at: '2026-03-01' },
    ];
    mocks.listThreadMessages = (async () => ({
      messages,
      total: 1,
      runs: [makeRun({ status: 'completed' })],
    })) as any;
    mocks.getDb = (() => makeDrizzleMock()) as any;

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    assertEquals(result.messages, messages);
    assertEquals(result.total, 1);
    assertEquals(result.limit, 100);
    assertEquals(result.offset, 0);
    assertEquals(result.activeRun, null);
    assertEquals(result.pendingSessionDiff, null);
})
  Deno.test('getThreadTimeline - identifies an active run when a run is queued', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.listThreadMessages = (async () => ({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-active', status: 'queued' })],
    })) as any;

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    assertNotEquals(result.activeRun, null);
    assertEquals(result.activeRun!.id, 'run-active');
    assertEquals(result.pendingSessionDiff, null);
})
  Deno.test('getThreadTimeline - identifies an active run when a run is running', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.listThreadMessages = (async () => ({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-running', status: 'running' })],
    })) as any;

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    assertNotEquals(result.activeRun, null);
    assertEquals(result.activeRun!.id, 'run-running');
})
  Deno.test('getThreadTimeline - returns pendingSessionDiff when completed run has an active session', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.listThreadMessages = (async () => ({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-1', status: 'completed', session_id: 'session-1' })],
    })) as any;

    const sessionRow = {
      id: 'session-1',
      status: 'active',
      repoId: 'repo-1',
      branch: 'main',
    };
    mocks.getDb = (() => makeDrizzleMock(sessionRow)) as any;

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    assertEquals(result.activeRun, null);
    assertEquals(result.pendingSessionDiff, {
      sessionId: 'session-1',
      sessionStatus: 'active',
      git_mode: true,
    });
})
  Deno.test('getThreadTimeline - sets git_mode to false when session has no repoId', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.listThreadMessages = (async () => ({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-1', status: 'completed', session_id: 'session-1' })],
    })) as any;

    const sessionRow = {
      id: 'session-1',
      status: 'active',
      repoId: null,
      branch: null,
    };
    mocks.getDb = (() => makeDrizzleMock(sessionRow)) as any;

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    assertNotEquals(result.pendingSessionDiff, null);
    assertEquals(result.pendingSessionDiff!.git_mode, false);
})
  Deno.test('getThreadTimeline - does not return pendingSessionDiff when session is discarded', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.listThreadMessages = (async () => ({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-1', status: 'completed', session_id: 'session-1' })],
    })) as any;

    const sessionRow = {
      id: 'session-1',
      status: 'discarded',
      repoId: 'repo-1',
      branch: 'main',
    };
    mocks.getDb = (() => makeDrizzleMock(sessionRow)) as any;

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    assertEquals(result.pendingSessionDiff, null);
})
  Deno.test('getThreadTimeline - does not check session when there is an active run', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.listThreadMessages = (async () => ({
      messages: [],
      total: 0,
      runs: [
        makeRun({ id: 'run-running', status: 'running', session_id: 'session-1' }),
        makeRun({ id: 'run-completed', status: 'completed', session_id: 'session-2' }),
      ],
    })) as any;

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    assertNotEquals(result.activeRun, null);
    assertEquals(result.pendingSessionDiff, null);
    // Should not have queried for session
    assertSpyCalls(mocks.getDb, 0);
})
  Deno.test('getThreadTimeline - does not check session when session_id is invalid', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.isValidOpaqueId = (() => false) as any;
    mocks.listThreadMessages = (async () => ({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-1', status: 'completed', session_id: 'invalid!!' })],
    })) as any;

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    assertEquals(result.pendingSessionDiff, null);
    assertSpyCalls(mocks.getDb, 0);
})
  Deno.test('getThreadTimeline - handles session lookup error gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.listThreadMessages = (async () => ({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-1', status: 'completed', session_id: 'session-1' })],
    })) as any;

    const drizzle = {
      select: () => ({
        from: () => ({
          where: () => ({
            get: (async () => { throw new Error('DB error'); }),
          }),
        }),
      }),
    };
    mocks.getDb = (() => drizzle) as any;

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    assertEquals(result.pendingSessionDiff, null);
    assert(mocks.logError.calls.length > 0);
})
  Deno.test('getThreadTimeline - does not set pendingSessionDiff when no completed run has a session', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.isValidOpaqueId = (() => true) as any;
  mocks.listThreadMessages = (async () => ({
      messages: [],
      total: 0,
      runs: [
        makeRun({ id: 'run-1', status: 'completed', session_id: null }),
        makeRun({ id: 'run-2', status: 'failed', session_id: 'session-1' }),
      ],
    })) as any;

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    assertEquals(result.pendingSessionDiff, null);
})