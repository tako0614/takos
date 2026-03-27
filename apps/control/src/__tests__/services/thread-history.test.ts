import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listThreadMessages: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/threads/thread-service', async () => {
  const actual = await vi.importActual<typeof import('@/services/threads/thread-service')>('@/services/threads/thread-service');
  return {
    ...actual,
    listThreadMessages: mocks.listThreadMessages,
  };
});

import { getThreadHistory } from '@/services/threads/thread-history';

function makeDbMock(selectAllResults: unknown[], selectGetResults: unknown[] = []) {
  let allIndex = 0;
  let getIndex = 0;
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

describe('getThreadHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assembles a parent-centric root snapshot across child threads', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          thread_id: 'thread-1',
          role: 'user',
          content: 'start',
          tool_calls: null,
          tool_call_id: null,
          metadata: '{}',
          sequence: 1,
          created_at: '2026-03-10T00:00:00.000Z',
        },
      ],
      total: 1,
      runs: [],
    });

    mocks.getDb.mockReturnValue(makeDbMock([
      [ // thread-local runs
        {
          id: 'run-active',
          threadId: 'thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: null,
          childThreadId: null,
          rootThreadId: 'thread-1',
          rootRunId: 'run-active',
          agentType: 'default',
          status: 'running',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-10T00:01:00.000Z',
          completedAt: null,
          createdAt: '2026-03-10T00:01:00.000Z',
        },
        {
          id: 'run-failed',
          threadId: 'thread-1',
          accountId: 'ws-1',
          sessionId: 'session-1',
          parentRunId: null,
          childThreadId: null,
          rootThreadId: 'thread-1',
          rootRunId: 'run-failed',
          agentType: 'reviewer',
          status: 'failed',
          input: '{}',
          output: null,
          error: 'boom',
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-09T23:58:00.000Z',
          completedAt: '2026-03-09T23:59:00.000Z',
          createdAt: '2026-03-09T23:58:00.000Z',
        },
      ],
      [ // root-tree runs
        {
          id: 'run-child',
          threadId: 'child-thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: 'run-active',
          childThreadId: 'child-thread-1',
          rootThreadId: 'thread-1',
          rootRunId: 'run-active',
          agentType: 'implementer',
          status: 'running',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-10T00:02:00.000Z',
          completedAt: null,
          createdAt: '2026-03-10T00:02:00.000Z',
        },
        {
          id: 'run-active',
          threadId: 'thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: null,
          childThreadId: null,
          rootThreadId: 'thread-1',
          rootRunId: 'run-active',
          agentType: 'default',
          status: 'running',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-10T00:01:00.000Z',
          completedAt: null,
          createdAt: '2026-03-10T00:01:00.000Z',
        },
        {
          id: 'run-failed',
          threadId: 'thread-1',
          accountId: 'ws-1',
          sessionId: 'session-1',
          parentRunId: null,
          childThreadId: null,
          rootThreadId: 'thread-1',
          rootRunId: 'run-failed',
          agentType: 'reviewer',
          status: 'failed',
          input: '{}',
          output: null,
          error: 'boom',
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-09T23:58:00.000Z',
          completedAt: '2026-03-09T23:59:00.000Z',
          createdAt: '2026-03-09T23:58:00.000Z',
        },
      ],
      [ // artifacts
        {
          id: 'artifact-1',
          runId: 'run-failed',
          type: 'report',
          title: 'Failure report',
          fileId: null,
          createdAt: '2026-03-09T23:59:10.000Z',
        },
      ],
      [ // runEvents
        {
          id: 1,
          runId: 'run-failed',
          type: 'run.failed',
          data: '{"error":"boom"}',
          createdAt: '2026-03-09T23:59:00.000Z',
        },
        {
          id: 2,
          runId: 'run-child',
          type: 'progress',
          data: '{"message":"still working"}',
          createdAt: '2026-03-10T00:02:30.000Z',
        },
      ],
      [ // agentTasks
        {
          id: 'task-1',
          title: 'Investigate',
          status: 'in_progress',
          priority: 'high',
          updatedAt: '2026-03-10T00:03:00.000Z',
        },
      ],
    ]));

    const result = await getThreadHistory({ DB: {} } as Env, 'thread-1', {
      limit: 100,
      offset: 0,
    });

    expect(result.focus).toEqual({
      latest_run_id: 'run-child',
      latest_active_run_id: 'run-child',
      latest_failed_run_id: 'run-failed',
      latest_completed_run_id: null,
      resume_run_id: 'run-child',
    });
    expect(result.taskContext).toEqual({
      id: 'task-1',
      title: 'Investigate',
      status: 'in_progress',
      priority: 'high',
    });
    expect(result.runs.map((entry) => entry.run.id)).toEqual(['run-failed', 'run-active', 'run-child']);
    expect(result.runs[0]).toMatchObject({
      run: { id: 'run-failed', status: 'failed' },
      artifact_count: 1,
    });
    expect(result.runs[1]).toMatchObject({
      run: { id: 'run-active', status: 'running' },
      child_thread_id: 'child-thread-1',
      child_run_count: 1,
      child_runs: [{
        run_id: 'run-child',
        thread_id: 'child-thread-1',
      }],
    });
    expect(result.runs[2]).toMatchObject({
      run: {
        id: 'run-child',
        thread_id: 'child-thread-1',
        root_thread_id: 'thread-1',
      },
      latest_event_at: '2026-03-10T00:02:30.000Z',
    });
    expect(result.activeRun?.id).toBe('run-child');
  });

  it('can return a root-run scoped snapshot without reloading messages', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [
        {
          id: 'msg-1',
          thread_id: 'thread-1',
          role: 'user',
          content: 'start',
          tool_calls: null,
          tool_call_id: null,
          metadata: '{}',
          sequence: 1,
          created_at: '2026-03-10T00:00:00.000Z',
        },
      ],
      total: 1,
      runs: [],
    });

    mocks.getDb.mockReturnValue(makeDbMock([
      [ // thread-local runs
        {
          id: 'run-root',
          threadId: 'thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: null,
          childThreadId: null,
          rootThreadId: 'thread-1',
          rootRunId: 'run-root',
          agentType: 'default',
          status: 'running',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-10T00:01:00.000Z',
          completedAt: null,
          createdAt: '2026-03-10T00:01:00.000Z',
        },
      ],
      [ // root-tree runs
        {
          id: 'run-child',
          threadId: 'child-thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: 'run-root',
          childThreadId: 'child-thread-1',
          rootThreadId: 'thread-1',
          rootRunId: 'run-root',
          agentType: 'reviewer',
          status: 'running',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-10T00:02:00.000Z',
          completedAt: null,
          createdAt: '2026-03-10T00:02:00.000Z',
        },
        {
          id: 'run-root',
          threadId: 'thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: null,
          childThreadId: null,
          rootThreadId: 'thread-1',
          rootRunId: 'run-root',
          agentType: 'default',
          status: 'running',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-10T00:01:00.000Z',
          completedAt: null,
          createdAt: '2026-03-10T00:01:00.000Z',
        },
        {
          id: 'run-other',
          threadId: 'thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: null,
          childThreadId: null,
          rootThreadId: 'thread-1',
          rootRunId: 'run-other',
          agentType: 'default',
          status: 'failed',
          input: '{}',
          output: null,
          error: 'boom',
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-09T23:59:00.000Z',
          completedAt: '2026-03-10T00:00:00.000Z',
          createdAt: '2026-03-09T23:59:00.000Z',
        },
      ],
      [], // artifacts
      [], // runEvents
      [], // agentTasks
    ]));

    const result = await getThreadHistory({ DB: {} } as Env, 'thread-1', {
      limit: 100,
      offset: 0,
      includeMessages: false,
      rootRunId: 'run-root',
    });

    expect(mocks.listThreadMessages).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
    expect(result.runs.map((entry) => entry.run.id)).toEqual(['run-root', 'run-child']);
    expect(result.focus.resume_run_id).toBe('run-child');
  });

  it('defaults a child thread request to its own delegated subtree', async () => {
    mocks.listThreadMessages.mockResolvedValue({
      messages: [],
      total: 0,
      runs: [],
    });

    mocks.getDb.mockReturnValue(makeDbMock([
      [ // thread-local runs
        {
          id: 'run-child',
          threadId: 'child-thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: 'run-root',
          childThreadId: 'child-thread-1',
          rootThreadId: 'thread-1',
          rootRunId: 'run-root',
          agentType: 'implementer',
          status: 'running',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-10T00:02:00.000Z',
          completedAt: null,
          createdAt: '2026-03-10T00:02:00.000Z',
        },
      ],
      [ // root-tree runs
        {
          id: 'run-grandchild',
          threadId: 'grandchild-thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: 'run-child',
          childThreadId: 'grandchild-thread-1',
          rootThreadId: 'thread-1',
          rootRunId: 'run-root',
          agentType: 'reviewer',
          status: 'queued',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: null,
          completedAt: null,
          createdAt: '2026-03-10T00:03:00.000Z',
        },
        {
          id: 'run-child',
          threadId: 'child-thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: 'run-root',
          childThreadId: 'child-thread-1',
          rootThreadId: 'thread-1',
          rootRunId: 'run-root',
          agentType: 'implementer',
          status: 'running',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-10T00:02:00.000Z',
          completedAt: null,
          createdAt: '2026-03-10T00:02:00.000Z',
        },
        {
          id: 'run-sibling',
          threadId: 'sibling-thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: 'run-root',
          childThreadId: 'sibling-thread-1',
          rootThreadId: 'thread-1',
          rootRunId: 'run-root',
          agentType: 'researcher',
          status: 'running',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-10T00:02:30.000Z',
          completedAt: null,
          createdAt: '2026-03-10T00:02:30.000Z',
        },
        {
          id: 'run-root',
          threadId: 'thread-1',
          accountId: 'ws-1',
          sessionId: null,
          parentRunId: null,
          childThreadId: null,
          rootThreadId: 'thread-1',
          rootRunId: 'run-root',
          agentType: 'default',
          status: 'running',
          input: '{}',
          output: null,
          error: null,
          usage: '{}',
          workerId: null,
          workerHeartbeat: null,
          startedAt: '2026-03-10T00:01:00.000Z',
          completedAt: null,
          createdAt: '2026-03-10T00:01:00.000Z',
        },
      ],
      [], // artifacts
      [], // runEvents
      [], // agentTasks
    ]));

    const result = await getThreadHistory({ DB: {} } as Env, 'child-thread-1', {
      limit: 100,
      offset: 0,
      includeMessages: false,
    });

    expect(result.runs.map((entry) => entry.run.id)).toEqual(['run-child', 'run-grandchild']);
    expect(result.focus.resume_run_id).toBe('run-grandchild');
    expect(result.runs[0]?.child_runs).toEqual([expect.objectContaining({
      run_id: 'run-grandchild',
    })]);
  });
});
