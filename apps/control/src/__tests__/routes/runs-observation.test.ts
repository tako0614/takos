import { Hono } from 'hono';
import type { Env, User, Run } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  checkWorkspaceAccess: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
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


  Deno.test('run observation endpoints - derives run status from timeline for /events', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
      select: () => {
        const idx = selectCallIndex++;
        const chain: Record<string, unknown> = {};
        chain.from = (() => chain);
        chain.where = (() => chain);
        chain.orderBy = (() => chain);
        chain.limit = (() => chain);
        chain.get = (async () => idx === 0 ? runRow : null);
        chain.all = (async () => idx === 1 ? runEvents : []);
        return chain;
      },
    };

    mocks.getDb = (() => drizzleDb) as any;
    mocks.checkWorkspaceAccess = (async () => ({
      workspace: { id: 'ws-1' },
      member: { role: 'owner' },
    })) as any;
  const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/runs/run-1/events?last_event_id=1'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const payload = await response.json() as {
      events: Array<{ id: number; event_id: string; run_id: string; type: string; data: string; created_at: string }>;
      run_status: Run['status'];
    };

    assertEquals(payload.run_status, 'completed');
    assertEquals(payload.events.length, 2);
    assertObjectMatch(payload.events[0], {
      id: 10,
      event_id: '10',
      run_id: 'run-1',
      type: 'thinking',
      data: '{"message":"thinking"}',
    });
})
  Deno.test('run observation endpoints - uses after parameter equivalently on /replay', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
      select: () => {
        const idx = selectCallIndex++;
        const chain: Record<string, unknown> = {};
        chain.from = (() => chain);
        chain.where = (() => chain);
        chain.orderBy = (() => chain);
        chain.limit = (() => chain);
        chain.get = (async () => idx === 0 ? runRow : null);
        chain.all = (async () => idx === 1 ? runEvents : []);
        return chain;
      },
    };

    mocks.getDb = (() => drizzleDb) as any;
    mocks.checkWorkspaceAccess = (async () => ({
      workspace: { id: 'ws-1' },
      member: { role: 'owner' },
    })) as any;
  const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/runs/run-1/replay?after=1'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    const payload = await response.json() as { run_status: Run['status'] };
    assertEquals(payload.run_status, 'completed');
})