import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User, Run } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils')>()),
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
}));

import runs from '@/routes/runs';

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
    created_at: '2026-02-21T00:00:00.000Z',
    updated_at: '2026-02-21T00:00:00.000Z',
  };
}

function createApp(user: User) {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api', runs);
  return app;
}

describe('run observation endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const runEvents = [
      {
        id: 10,
        runId: 'run-1',
        type: 'thinking',
        data: '{"message":"thinking"}',
        createdAt: '2026-02-27T00:00:00.000Z',
      },
      {
        id: 11,
        runId: 'run-1',
        type: 'completed',
        data: '{"result":"ok"}',
        createdAt: '2026-02-27T00:00:01.000Z',
      },
    ];

    // Production code uses Drizzle chains:
    //   checkRunAccess: db.select().from(runs).where(...).get() -> run row
    //   loadRunObservation: db.select({...}).from(runEvents).where(...).orderBy(...).all() -> events
    const runRow = {
      id: 'run-1',
      threadId: 'thread-1',
      accountId: 'ws-1',
      sessionId: null,
      parentRunId: null,
      agentType: 'default',
      status: 'running',
      input: '{}',
      output: null,
      error: null,
      usage: '{}',
      workerId: null,
      workerHeartbeat: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-02-27T00:00:00.000Z',
    };

    let selectCallIndex = 0;
    const drizzleDb = {
      select: vi.fn(() => {
        const idx = selectCallIndex++;
        const chain: Record<string, unknown> = {};
        chain.from = vi.fn().mockReturnValue(chain);
        chain.where = vi.fn().mockReturnValue(chain);
        chain.orderBy = vi.fn().mockReturnValue(chain);
        chain.limit = vi.fn().mockReturnValue(chain);
        chain.get = vi.fn().mockResolvedValue(idx === 0 ? runRow : null);
        chain.all = vi.fn().mockResolvedValue(idx === 1 ? runEvents : []);
        return chain;
      }),
    };

    mocks.getDb.mockReturnValue(drizzleDb);
    mocks.checkWorkspaceAccess.mockResolvedValue({
      workspace: { id: 'ws-1' },
      member: { role: 'owner' },
    });
  });

  it('derives run status from timeline for /events', async () => {
    const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/runs/run-1/events?last_event_id=1'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      events: Array<{ id: number; event_id: string; run_id: string; type: string; data: string; created_at: string }>;
      run_status: Run['status'];
    };

    expect(payload.run_status).toBe('completed');
    expect(payload.events).toHaveLength(2);
    expect(payload.events[0]).toMatchObject({
      id: 10,
      event_id: '10',
      run_id: 'run-1',
      type: 'thinking',
      data: '{"message":"thinking"}',
    });
  });

  it('uses after parameter equivalently on /replay', async () => {
    const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/runs/run-1/replay?after=1'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { run_status: Run['status'] };
    expect(payload.run_status).toBe('completed');
  });
});
