import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils')>()),
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
}));

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

describe('agent task read-model routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkWorkspaceAccess.mockResolvedValue({
      workspace: { id: 'ws-1' },
      member: { role: 'owner' },
    });
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
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => {
        const resultIndex = selectCallIndex++;
        const chain: any = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          offset: vi.fn(() => chain),
          all: vi.fn(async () => selectResults[resultIndex] ?? []),
          get: vi.fn(async () => (selectResults[resultIndex] ?? [])[0] ?? undefined),
        };
        return chain;
      }),
    });
  });

  it('returns latest run summary and resume target for each task', async () => {
    const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/spaces/ws-1/agent-tasks'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      tasks: Array<{
        thread_title?: string | null;
        latest_run?: { run_id: string; status: string; artifact_count: number } | null;
        resume_target?: { thread_id: string; run_id: string | null; reason: string } | null;
      }>;
    };

    expect(payload.tasks[0]).toMatchObject({
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
  });
});
