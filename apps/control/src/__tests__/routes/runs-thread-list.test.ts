import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  checkThreadAccess: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/threads/thread-service', () => ({
  checkThreadAccess: mocks.checkThreadAccess,
}));

import runs from '@/routes/runs/routes';

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

function createRunRow(id: string, createdAt: string) {
  return {
    id,
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
    createdAt,
  };
}

describe('GET /threads/:threadId/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkThreadAccess.mockResolvedValue({
      thread: { id: 'thread-1', space_id: 'ws-1' },
      role: 'owner',
    });
  });

  it('returns 400 when cursor is invalid', async () => {
    // Drizzle chain mock (not actually called due to early return)
    const selectAll = vi.fn();
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.all = selectAll;
    chain.get = vi.fn();
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(chain),
    });

    const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/threads/thread-1/runs?cursor=not-a-date'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid cursor' });
    expect(selectAll).not.toHaveBeenCalled();
  });

  it('applies active_only/limit/cursor query and returns pagination metadata', async () => {
    const cursor = '2026-02-21T12:00:00.000Z';
    const rows = [
      createRunRow('run-2', '2026-02-21T11:00:00.000Z'),
      createRunRow('run-1', '2026-02-21T10:00:00.000Z'),
    ];
    // Production code: db.select().from(runs).where(...).orderBy(...).limit(...).all()
    const selectAll = vi.fn().mockResolvedValue(rows);
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.all = selectAll;
    chain.get = vi.fn();
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(chain),
    });

    const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request(`https://takos.jp/api/threads/thread-1/runs?active_only=1&limit=2&cursor=${encodeURIComponent(cursor)}`),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);

    const payload = await response.json() as {
      runs: Array<{ id: string }>;
      limit: number;
      active_only: boolean;
      cursor: string;
      next_cursor: string | null;
    };

    expect(payload.runs.map((run) => run.id)).toEqual(['run-2', 'run-1']);
    expect(payload.limit).toBe(2);
    expect(payload.active_only).toBe(true);
    expect(payload.cursor).toBe(cursor);
    expect(payload.next_cursor).toBe('2026-02-21T10:00:00.000Z,run-1');
    expect(selectAll).toHaveBeenCalledTimes(1);
  });

  it('supports composite cursor token with createdAt + run id for stable pagination', async () => {
    const cursor = '2026-02-21T12:00:00.000Z,run-10';
    const rows = [createRunRow('run-9', '2026-02-21T12:00:00.000Z')];
    const selectAll = vi.fn().mockResolvedValue(rows);
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    chain.all = selectAll;
    chain.get = vi.fn();
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue(chain),
    });

    const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request(`https://takos.jp/api/threads/thread-1/runs?limit=1&cursor=${encodeURIComponent(cursor)}`),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const payload = await response.json() as { cursor: string | null; next_cursor: string | null };
    expect(payload.cursor).toBe(cursor);
    expect(payload.next_cursor).toBe('2026-02-21T12:00:00.000Z,run-9');
    expect(selectAll).toHaveBeenCalledTimes(1);
  });
});
