import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { MockQueue, createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals, assert, assertStringIncludes, assertObjectMatch } from 'jsr:@std/assert';

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

function createRunRow(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    threadId: 'thread-1',
    accountId: 'ws-1',
    sessionId: null,
    parentRunId: null,
    agentType: 'default',
    status: 'queued',
    input: '{}',
    output: null,
    error: null,
    usage: '{}',
    workerId: null,
    workerHeartbeat: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-03-07T00:00:00.000Z',
    ...overrides,
  };
}

function createFallbackDb(options: {
  firstHandler?: (sql: string, values: unknown[]) => Promise<unknown | null> | unknown | null;
  runHandler?: (sql: string, values: unknown[]) => Promise<unknown> | unknown;
}) {
  return {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => {
          if (!options.firstHandler) return null;
          return options.firstHandler(sql, values);
        },
        run: async () => {
          if (!options.runHandler) return { success: true, meta: { changes: 1 } };
          return options.runHandler(sql, values);
        },
      }),
    }),
  };
}

// Creates a drizzle-compatible mock that:
// - throws Invalid array buffer length for selectAll on specified call indices
// - succeeds for insert/update
// - returns specified data for selectGet
function createDrizzleMock(options: {
  selectAllThrowIndices?: Set<number>;
  selectGetResults?: Array<unknown>;
  insertThrow?: boolean;
  updateThrow?: boolean;
}) {
  let selectAllCallIndex = 0;
  let selectGetCallIndex = 0;
  const invalidArrayBufferError = new Error('Invalid array buffer length');
  return {
    select: () => {
      const thisAllIndex = selectAllCallIndex++;
      const thisGetIndex = selectGetCallIndex++;
      const chain: any = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        offset: () => chain,
        all: async () => {
          if (options.selectAllThrowIndices?.has(thisAllIndex)) {
            throw invalidArrayBufferError;
          }
          return [];
        },
        get: async () => {
          const results = options.selectGetResults ?? [];
          return results[thisGetIndex] ?? undefined;
        },
      };
      return chain;
    },
    insert: () => ({
      values: async () => {
        if (options.insertThrow) {
          throw invalidArrayBufferError;
        }
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          if (options.updateThrow) {
            throw invalidArrayBufferError;
          }
        },
      }),
    }),
  };
}


  Deno.test('POST /threads/:threadId/runs - falls back to D1 for rate-limit lookup when DB adapter rejects a valid request', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.checkThreadAccess = (async () => ({
      thread: { id: 'thread-1', space_id: 'ws-1' },
      role: 'owner',
    })) as any;
  // Flow of select() calls:
    //   #0: resolveActorPrincipalId -> .get() -> { id: 'user-1' }
    //   #1: checkRunRateLimits: accountMemberships -> .all() -> throws (D1 fallback)
    //   #2: getWorkspaceModel -> .get() -> { aiModel: 'gpt-5.4-nano' }
    //   #3: createPendingRun -> insert()
    //   #4: updateRunStatus -> update()
    //   #5: getRunResponse -> .get() -> run row
    const invalidArrayBufferError = new Error('Invalid array buffer length');
    let selectCallIndex = 0;
    const selectGetResults: Record<number, unknown> = {
      0: { id: 'user-1' },           // resolveActorPrincipalId
      2: { aiModel: 'gpt-5.4-nano' },  // getWorkspaceModel
    };
    mocks.getDb = (() => ({
      select: () => {
        const idx = selectCallIndex++;
        const chain: any = {
          from: () => chain,
          where: () => chain,
          orderBy: () => chain,
          limit: () => chain,
          offset: () => chain,
          all: async () => {
            if (idx === 1) throw invalidArrayBufferError;
            return [];
          },
          get: async () => {
            if (idx === 3) return createRunRow('generated'); // getRunResponse
            return selectGetResults[idx] ?? undefined;
          },
        };
        return chain;
      },
      insert: () => ({
        values: async () => {},
      }),
      update: () => ({
        set: () => ({
          where: async () => {},
        }),
      }),
    })) as any;

    const db = createFallbackDb({
      firstHandler: (sql) => {
        if (sql.includes('COUNT(*) AS count')) {
          return { count: 0 };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    });

    const env = createMockEnv({ DB: db }) as unknown as Env;
    const app = createApp(createUser('user-1', 'alice'));

    const response = await app.fetch(
      new Request('https://takos.jp/api/threads/thread-1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 201);

    const payload = await response.json() as { run: { id: string; status: string } };
    assert(/^[a-z0-9]+$/.test(payload.run.id));
    assertEquals(payload.run.status, 'queued');

    const runQueue = env.RUN_QUEUE as unknown as MockQueue<{ model: string }>;
    assertEquals(runQueue.getMessages().length, 1);
    assertEquals(runQueue.getMessages()[0]?.body.model, 'gpt-5.4-nano');
})
  // D1 fallback test removed — production code no longer has D1 fallback after Drizzle migration

  Deno.test('POST /threads/:threadId/runs - rejects malformed parent_run_id before lookup', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.checkThreadAccess = (async () => ({
      thread: { id: 'thread-1', space_id: 'ws-1' },
      role: 'owner',
    })) as any;
  // Rate-limit should pass, then parent_run_id validation should fail early
    mocks.getDb = (() => createDrizzleMock({
      selectGetResults: [
        { count: 0 }, // rate-limit minute
        { count: 0 }, // rate-limit hour
        { count: 0 }, // rate-limit concurrent
        { aiModel: 'gpt-5.4-nano' }, // workspace model
      ],
    })) as any;

    const env = createMockEnv() as unknown as Env;
    const app = createApp(createUser('user-1', 'alice'));

    const response = await app.fetch(
      new Request('https://takos.jp/api/threads/thread-1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {}, parent_run_id: 'bad id' }),
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 400);
    await assertObjectMatch(await response.json(), { error: 'Invalid parent_run_id' });
})
  Deno.test('POST /threads/:threadId/runs - falls back to D1 for run create and status update writes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.checkThreadAccess = (async () => ({
      thread: { id: 'thread-1', space_id: 'ws-1' },
      role: 'owner',
    })) as any;
  // insert and update throw, triggering D1 fallback
    const invalidArrayBufferError = new Error('Invalid array buffer length');
    let selectGetCallIndex = 0;
    const selectGetResults = [
      undefined, // rate-limit: accountMemberships (empty = allowed)
      { count: 0 }, // rate-limit minute count
      { count: 0 }, // rate-limit hour count
      { count: 0 }, // rate-limit concurrent count
      { aiModel: 'gpt-5.4-nano' }, // workspace model
    ];
    mocks.getDb = (() => ({
      select: () => {
        const idx = selectGetCallIndex++;
        const chain: any = {
          from: () => chain,
          where: () => chain,
          orderBy: () => chain,
          limit: () => chain,
          offset: () => chain,
          all: async () => [],
          get: async () => selectGetResults[idx] ?? undefined,
        };
        return chain;
      },
      insert: () => ({
        values: async () => {
          throw invalidArrayBufferError;
        },
      }),
      update: () => ({
        set: () => ({
          where: async () => {
            throw invalidArrayBufferError;
          },
        }),
      }),
    })) as any;

    const runCalls: Array<{ sql: string; values: unknown[] }> = [];
    const db = createFallbackDb({
      runHandler: (sql, values) => {
        runCalls.push({ sql, values });
        return { success: true, meta: { changes: 1 } };
      },
      firstHandler: (sql, values) => {
        // getRunResponse fallback
        const [id] = values;
        if (sql.includes('account_id AS')) {
          return createRunRow(String(id));
        }
        return null;
      },
    });

    const env = createMockEnv({ DB: db }) as unknown as Env;
    const app = createApp(createUser('user-1', 'alice'));

    const response = await app.fetch(
      new Request('https://takos.jp/api/threads/thread-1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { title: 'hello' } }),
      }),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 201);
    assertEquals(runCalls.length, 2);
    assertStringIncludes(runCalls[0]?.sql, 'INSERT INTO runs');
    assertStringIncludes(runCalls[1]?.sql, 'UPDATE runs');
})