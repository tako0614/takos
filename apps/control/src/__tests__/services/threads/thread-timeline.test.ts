import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listThreadMessages: vi.fn(),
  isValidOpaqueId: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('@/services/threads/threads', () => ({
  listThreadMessages: mocks.listThreadMessages,
}));

vi.mock('@/shared/utils/db-guards', () => ({
  isValidOpaqueId: mocks.isValidOpaqueId,
}));

vi.mock('@/shared/utils/logger', () => ({
  logError: mocks.logError,
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

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
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.get = vi.fn().mockResolvedValue(sessionRow ?? null);
  return {
    select: vi.fn().mockReturnValue(chain),
  };
}

describe('getThreadTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isValidOpaqueId.mockReturnValue(true);
  });

  it('returns messages, total, and no active run or pending session diff', async () => {
    const messages = [
      { id: 'msg-1', thread_id: 'thread-1', role: 'user', content: 'hi', sequence: 0, created_at: '2026-03-01' },
    ];
    mocks.listThreadMessages.mockResolvedValue({
      messages,
      total: 1,
      runs: [makeRun({ status: 'completed' })],
    });
    mocks.getDb.mockReturnValue(makeDrizzleMock());

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    expect(result.messages).toEqual(messages);
    expect(result.total).toBe(1);
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
    expect(result.activeRun).toBeNull();
    expect(result.pendingSessionDiff).toBeNull();
  });

  it('identifies an active run when a run is queued', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-active', status: 'queued' })],
    });

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    expect(result.activeRun).not.toBeNull();
    expect(result.activeRun!.id).toBe('run-active');
    expect(result.pendingSessionDiff).toBeNull();
  });

  it('identifies an active run when a run is running', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-running', status: 'running' })],
    });

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    expect(result.activeRun).not.toBeNull();
    expect(result.activeRun!.id).toBe('run-running');
  });

  it('returns pendingSessionDiff when completed run has an active session', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-1', status: 'completed', session_id: 'session-1' })],
    });

    const sessionRow = {
      id: 'session-1',
      status: 'active',
      repoId: 'repo-1',
      branch: 'main',
    };
    mocks.getDb.mockReturnValue(makeDrizzleMock(sessionRow));

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    expect(result.activeRun).toBeNull();
    expect(result.pendingSessionDiff).toEqual({
      sessionId: 'session-1',
      sessionStatus: 'active',
      git_mode: true,
    });
  });

  it('sets git_mode to false when session has no repoId', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-1', status: 'completed', session_id: 'session-1' })],
    });

    const sessionRow = {
      id: 'session-1',
      status: 'active',
      repoId: null,
      branch: null,
    };
    mocks.getDb.mockReturnValue(makeDrizzleMock(sessionRow));

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    expect(result.pendingSessionDiff).not.toBeNull();
    expect(result.pendingSessionDiff!.git_mode).toBe(false);
  });

  it('does not return pendingSessionDiff when session is discarded', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-1', status: 'completed', session_id: 'session-1' })],
    });

    const sessionRow = {
      id: 'session-1',
      status: 'discarded',
      repoId: 'repo-1',
      branch: 'main',
    };
    mocks.getDb.mockReturnValue(makeDrizzleMock(sessionRow));

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    expect(result.pendingSessionDiff).toBeNull();
  });

  it('does not check session when there is an active run', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [],
      total: 0,
      runs: [
        makeRun({ id: 'run-running', status: 'running', session_id: 'session-1' }),
        makeRun({ id: 'run-completed', status: 'completed', session_id: 'session-2' }),
      ],
    });

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    expect(result.activeRun).not.toBeNull();
    expect(result.pendingSessionDiff).toBeNull();
    // Should not have queried for session
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('does not check session when session_id is invalid', async () => {
    mocks.isValidOpaqueId.mockReturnValue(false);
    mocks.listThreadMessages.mockResolvedValue({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-1', status: 'completed', session_id: 'invalid!!' })],
    });

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    expect(result.pendingSessionDiff).toBeNull();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('handles session lookup error gracefully', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [],
      total: 0,
      runs: [makeRun({ id: 'run-1', status: 'completed', session_id: 'session-1' })],
    });

    const drizzle = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            get: vi.fn().mockRejectedValue(new Error('DB error')),
          })),
        })),
      })),
    };
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    expect(result.pendingSessionDiff).toBeNull();
    expect(mocks.logError).toHaveBeenCalled();
  });

  it('does not set pendingSessionDiff when no completed run has a session', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [],
      total: 0,
      runs: [
        makeRun({ id: 'run-1', status: 'completed', session_id: null }),
        makeRun({ id: 'run-2', status: 'failed', session_id: 'session-1' }),
      ],
    });

    const result = await getThreadTimeline(makeEnv(), 'thread-1', 100, 0);

    expect(result.pendingSessionDiff).toBeNull();
  });
});
