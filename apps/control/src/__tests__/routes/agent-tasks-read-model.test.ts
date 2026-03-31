import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  checkWorkspaceAccess: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
import agentTasks from '@/routes/agent-tasks';

type Vars = { user: User };
type HonoEnv = { Bindings: Env; Variables: Vars };

function createUser(id: string, username: string): User {
  return {
    id,
    email: `${username}@example.com`,
    name: username,
    username,
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-03-11T00:00:00.000Z',
    updated_at: '2026-03-11T00:00:00.000Z',
  };
}

function createApp(user: User) {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api', agentTasks);
  return app;
}


  Deno.test('agent task read-model routes - returns latest run summary and resume target for each task', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.checkWorkspaceAccess = (async () => ({
      workspace: { id: 'ws-1' },
      member: { role: 'owner' },
    })) as any;
    // Build drizzle-compatible mock that returns different data for each select() call.
    // Call order: 1) agentTasks, 2) threads, 3) runs, 4) artifacts
    const selectResults = [
      // 1. Agent tasks
      [
        {
          id: 'task-1',
          accountId: 'ws-1',
          createdByAccountId: 'user-1',
          threadId: 'thread-1',
          lastRunId: 'run-failed',
          title: 'Fix history UI',
          description: 'resume from the right run',
          status: 'in_progress',
          priority: 'high',
          agentType: 'default',
          model: 'gpt-5',
          plan: null,
          dueAt: null,
          startedAt: null,
          completedAt: null,
          createdAt: '2026-03-11T00:00:00.000Z',
          updatedAt: '2026-03-11T00:00:00.000Z',
        },
      ],
      // 2. Threads
      [
        { id: 'thread-1', title: 'Fix history UI' },
      ],
      // 3. Runs
      [
        {
          id: 'run-active',
          threadId: 'child-thread-1',
          rootThreadId: 'thread-1',
          status: 'running',
          agentType: 'default',
          startedAt: '2026-03-11T00:01:00.000Z',
          completedAt: null,
          createdAt: '2026-03-11T00:01:00.000Z',
          error: null,
        },
        {
          id: 'run-failed',
          threadId: 'thread-1',
          rootThreadId: 'thread-1',
          status: 'failed',
          agentType: 'default',
          startedAt: '2026-03-10T23:59:00.000Z',
          completedAt: '2026-03-11T00:00:00.000Z',
          createdAt: '2026-03-10T23:59:00.000Z',
          error: 'boom',
        },
      ],
      // 4. Artifacts
      [
        { runId: 'run-active' },
        { runId: 'run-active' },
      ],
    ];
    let selectCallIndex = 0;
    mocks.getDb = (() => ({
      select: () => {
        const resultIndex = selectCallIndex++;
        const chain: any = {
          from: () => chain,
          where: () => chain,
          orderBy: () => chain,
          limit: () => chain,
          offset: () => chain,
          all: async () => selectResults[resultIndex] ?? [],
          get: async () => (selectResults[resultIndex] ?? [])[0] ?? undefined,
        };
        return chain;
      },
    })) as any;
  const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/spaces/ws-1/agent-tasks'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const payload = await response.json() as {
      tasks: Array<{
        thread_title?: string | null;
        latest_run?: { run_id: string; status: string; artifact_count: number } | null;
        resume_target?: { thread_id: string; run_id: string | null; reason: string } | null;
      }>;
    };

    assertObjectMatch(payload.tasks[0], {
      thread_title: 'Fix history UI',
      latest_run: {
        run_id: 'run-active',
        status: 'running',
        artifact_count: 2,
      },
      resume_target: {
        thread_id: 'thread-1',
        run_id: 'run-active',
        reason: 'active',
      },
    });
})