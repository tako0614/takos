import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  checkThreadAccess: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/threads/thread-service'
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


  Deno.test('GET /threads/:threadId/runs - returns 400 when cursor is invalid', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.checkThreadAccess = (async () => ({
      thread: { id: 'thread-1', space_id: 'ws-1' },
      role: 'owner',
    })) as any;
  // Drizzle chain mock (not actually called due to early return)
    const selectAll = ((..._args: any[]) => undefined) as any;
    const chain: Record<string, unknown> = {};
    chain.from = (() => chain);
    chain.where = (() => chain);
    chain.orderBy = (() => chain);
    chain.limit = (() => chain);
    chain.all = selectAll;
    chain.get = ((..._args: any[]) => undefined) as any;
    mocks.getDb = (() => ({
      select: (() => chain),
    })) as any;

    const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/threads/thread-1/runs?cursor=not-a-date'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 400);
    await assertObjectMatch(await response.json(), { error: 'Invalid cursor' });
    assertSpyCalls(selectAll, 0);
})
  Deno.test('GET /threads/:threadId/runs - applies active_only/limit/cursor query and returns pagination metadata', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.checkThreadAccess = (async () => ({
      thread: { id: 'thread-1', space_id: 'ws-1' },
      role: 'owner',
    })) as any;
  const cursor = '2026-02-21T12:00:00.000Z';
    const rows = [
      createRunRow('run-2', '2026-02-21T11:00:00.000Z'),
      createRunRow('run-1', '2026-02-21T10:00:00.000Z'),
    ];
    // Production code: db.select().from(runs).where(...).orderBy(...).limit(...).all()
    const selectAll = (async () => rows);
    const chain: Record<string, unknown> = {};
    chain.from = (() => chain);
    chain.where = (() => chain);
    chain.orderBy = (() => chain);
    chain.limit = (() => chain);
    chain.all = selectAll;
    chain.get = ((..._args: any[]) => undefined) as any;
    mocks.getDb = (() => ({
      select: (() => chain),
    })) as any;

    const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request(`https://takos.jp/api/threads/thread-1/runs?active_only=1&limit=2&cursor=${encodeURIComponent(cursor)}`),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);

    const payload = await response.json() as {
      runs: Array<{ id: string }>;
      limit: number;
      active_only: boolean;
      cursor: string;
      next_cursor: string | null;
    };

    assertEquals(payload.runs.map((run) => run.id), ['run-2', 'run-1']);
    assertEquals(payload.limit, 2);
    assertEquals(payload.active_only, true);
    assertEquals(payload.cursor, cursor);
    assertEquals(payload.next_cursor, '2026-02-21T10:00:00.000Z,run-1');
    assertSpyCalls(selectAll, 1);
})
  Deno.test('GET /threads/:threadId/runs - supports composite cursor token with createdAt + run id for stable pagination', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.checkThreadAccess = (async () => ({
      thread: { id: 'thread-1', space_id: 'ws-1' },
      role: 'owner',
    })) as any;
  const cursor = '2026-02-21T12:00:00.000Z,run-10';
    const rows = [createRunRow('run-9', '2026-02-21T12:00:00.000Z')];
    const selectAll = (async () => rows);
    const chain: Record<string, unknown> = {};
    chain.from = (() => chain);
    chain.where = (() => chain);
    chain.orderBy = (() => chain);
    chain.limit = (() => chain);
    chain.all = selectAll;
    chain.get = ((..._args: any[]) => undefined) as any;
    mocks.getDb = (() => ({
      select: (() => chain),
    })) as any;

    const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request(`https://takos.jp/api/threads/thread-1/runs?limit=1&cursor=${encodeURIComponent(cursor)}`),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const payload = await response.json() as { cursor: string | null; next_cursor: string | null };
    assertEquals(payload.cursor, cursor);
    assertEquals(payload.next_cursor, '2026-02-21T12:00:00.000Z,run-9');
    assertSpyCalls(selectAll, 1);
})