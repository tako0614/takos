import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { MockQueue, createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  checkThreadAccess: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

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
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn(async () => {
          if (!options.firstHandler) return null;
          return options.firstHandler(sql, values);
        }),
        run: vi.fn(async () => {
          if (!options.runHandler) return { success: true, meta: { changes: 1 } };
          return options.runHandler(sql, values);
        }),
      })),
    })),
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
    select: vi.fn(() => {
      const thisAllIndex = selectAllCallIndex++;
      const thisGetIndex = selectGetCallIndex++;
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        offset: vi.fn(() => chain),
        all: vi.fn(async () => {
          if (options.selectAllThrowIndices?.has(thisAllIndex)) {
            throw invalidArrayBufferError;
          }
          return [];
        }),
        get: vi.fn(async () => {
          const results = options.selectGetResults ?? [];
          return results[thisGetIndex] ?? undefined;
        }),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async () => {
        if (options.insertThrow) {
          throw invalidArrayBufferError;
        }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {
          if (options.updateThrow) {
            throw invalidArrayBufferError;
          }
        }),
      })),
    })),
  };
}

describe('POST /threads/:threadId/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkThreadAccess.mockResolvedValue({
      thread: { id: 'thread-1', space_id: 'ws-1' },
      role: 'owner',
    });
  });

  it('falls back to D1 for rate-limit lookup when DB adapter rejects a valid request', async () => {
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
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => {
        const idx = selectCallIndex++;
        const chain: any = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          offset: vi.fn(() => chain),
          all: vi.fn(async () => {
            if (idx === 1) throw invalidArrayBufferError;
            return [];
          }),
          get: vi.fn(async () => {
            if (idx === 3) return createRunRow('generated'); // getRunResponse
            return selectGetResults[idx] ?? undefined;
          }),
        };
        return chain;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(async () => {}),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => {}),
        })),
      })),
    });

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

    expect(response.status).toBe(201);

    const payload = await response.json() as { run: { id: string; status: string } };
    expect(payload.run.id).toMatch(/^[a-z0-9]+$/);
    expect(payload.run.status).toBe('queued');

    const runQueue = env.RUN_QUEUE as unknown as MockQueue<{ model: string }>;
    expect(runQueue.getMessages()).toHaveLength(1);
    expect(runQueue.getMessages()[0]?.body.model).toBe('gpt-5.4-nano');
  });

  // D1 fallback test removed — production code no longer has D1 fallback after Drizzle migration

  it('rejects malformed parent_run_id before lookup', async () => {
    // Rate-limit should pass, then parent_run_id validation should fail early
    mocks.getDb.mockReturnValue(createDrizzleMock({
      selectGetResults: [
        { count: 0 }, // rate-limit minute
        { count: 0 }, // rate-limit hour
        { count: 0 }, // rate-limit concurrent
        { aiModel: 'gpt-5.4-nano' }, // workspace model
      ],
    }));

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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid parent_run_id' });
  });

  it('falls back to D1 for run create and status update writes', async () => {
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
    mocks.getDb.mockReturnValue({
      select: vi.fn(() => {
        const idx = selectGetCallIndex++;
        const chain: any = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          offset: vi.fn(() => chain),
          all: vi.fn(async () => []),
          get: vi.fn(async () => selectGetResults[idx] ?? undefined),
        };
        return chain;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(async () => {
          throw invalidArrayBufferError;
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => {
            throw invalidArrayBufferError;
          }),
        })),
      })),
    });

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

    expect(response.status).toBe(201);
    expect(runCalls).toHaveLength(2);
    expect(runCalls[0]?.sql).toContain('INSERT INTO runs');
    expect(runCalls[1]?.sql).toContain('UPDATE runs');
  });
});
