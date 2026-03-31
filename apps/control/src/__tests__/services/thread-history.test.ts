import type { Env } from '@/types';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  listThreadMessages: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-service'
import { getThreadHistory } from '@/services/threads/thread-history';

function makeDbMock(selectAllResults: unknown[], selectGetResults: unknown[] = []) {
  let allIndex = 0;
  let getIndex = 0;
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = (() => c);
    c.where = (() => c);
    c.orderBy = (() => c);
    c.limit = (() => c);
    c.all = async () => selectAllResults[allIndex++] ?? [];
    c.get = async () => selectGetResults[getIndex++] ?? null;
    return c;
  };
  return {
    select: () => chain(),
  };
}


  Deno.test('getThreadHistory - assembles a parent-centric root snapshot across child threads', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.listThreadMessages = (async () => ({
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
    })) as any;

    mocks.getDb = (() => makeDbMock([
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
    ])) as any;

    const result = await getThreadHistory({ DB: {} } as Env, 'thread-1', {
      limit: 100,
      offset: 0,
    });

    assertEquals(result.focus, {
      latest_run_id: 'run-child',
      latest_active_run_id: 'run-child',
      latest_failed_run_id: 'run-failed',
      latest_completed_run_id: null,
      resume_run_id: 'run-child',
    });
    assertEquals(result.taskContext, {
      id: 'task-1',
      title: 'Investigate',
      status: 'in_progress',
      priority: 'high',
    });
    assertEquals(result.runs.map((entry) => entry.run.id), ['run-failed', 'run-active', 'run-child']);
    assertObjectMatch(result.runs[0], {
      run: { id: 'run-failed', status: 'failed' },
      artifact_count: 1,
    });
    assertObjectMatch(result.runs[1], {
      run: { id: 'run-active', status: 'running' },
      child_thread_id: 'child-thread-1',
      child_run_count: 1,
      child_runs: [{
        run_id: 'run-child',
        thread_id: 'child-thread-1',
      }],
    });
    assertObjectMatch(result.runs[2], {
      run: {
        id: 'run-child',
        thread_id: 'child-thread-1',
        root_thread_id: 'thread-1',
      },
      latest_event_at: '2026-03-10T00:02:30.000Z',
    });
    assertEquals(result.activeRun?.id, 'run-child');
})
  Deno.test('getThreadHistory - can return a root-run scoped snapshot without reloading messages', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.listThreadMessages = (async () => ({
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
    })) as any;

    mocks.getDb = (() => makeDbMock([
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
    ])) as any;

    const result = await getThreadHistory({ DB: {} } as Env, 'thread-1', {
      limit: 100,
      offset: 0,
      includeMessages: false,
      rootRunId: 'run-root',
    });

    assertSpyCalls(mocks.listThreadMessages, 0);
    assertEquals(result.messages, []);
    assertEquals(result.runs.map((entry) => entry.run.id), ['run-root', 'run-child']);
    assertEquals(result.focus.resume_run_id, 'run-child');
})
  Deno.test('getThreadHistory - defaults a child thread request to its own delegated subtree', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.listThreadMessages = (async () => ({
      messages: [],
      total: 0,
      runs: [],
    })) as any;

    mocks.getDb = (() => makeDbMock([
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
    ])) as any;

    const result = await getThreadHistory({ DB: {} } as Env, 'child-thread-1', {
      limit: 100,
      offset: 0,
      includeMessages: false,
    });

    assertEquals(result.runs.map((entry) => entry.run.id), ['run-child', 'run-grandchild']);
    assertEquals(result.focus.resume_run_id, 'run-grandchild');
    assertEquals(result.runs[0]?.child_runs, [({
      run_id: 'run-grandchild',
    })]);
})