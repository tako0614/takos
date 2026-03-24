import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';
import type { ContainerStartFailure, ToolContext } from '@/tools/types';

/**
 * Drizzle-chainable mock for getDb.
 * Production code uses: db.select({...}).from(table).where(...).get()
 * and db.insert(table).values({...}), db.update(table).set({...}).where(...)
 */
const mockSelectResults = {
  session: vi.fn(),       // session lookup by id
  repository: vi.fn(),    // single repo lookup
  repositories: vi.fn(),  // multi-repo lookup
};

function createDrizzleMock() {
  return {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn((table: unknown) => {
          (chain as Record<string, unknown>)._table = table;
          return chain;
        }),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        get: vi.fn(async () => {
          // Route to the correct mock based on call pattern
          // The production code calls select then from(sessions) or from(repositories)
          const table = (chain as Record<string, unknown>)._table as any;
          const tableName = table?.$$name ?? table?.[Symbol.for('drizzle:Name')] ?? '';
          if (typeof tableName === 'string' && tableName === 'sessions') {
            return mockSelectResults.session();
          }
          return mockSelectResults.repository();
        }),
        all: vi.fn(async () => {
          const result = mockSelectResults.repositories();
          return Array.isArray(result) ? result : result ? [result] : [];
        }),
        _table: null as unknown,
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: vi.fn(async () => ({})),
        returning: vi.fn(async () => [{}]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => ({})),
        run: vi.fn(async () => ({})),
      })),
    })),
  };
}

const mockRuntimeManager = {
  setRepositories: vi.fn(),
  initSession: vi.fn(),
};

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: () => createDrizzleMock(),
  };
});

vi.mock('@/services/sync', () => ({
  createRuntimeSessionManager: vi.fn(() => mockRuntimeManager),
}));

vi.mock('@/utils', () => ({
  generateId: vi.fn(),
}));

import { generateId } from '@/utils';
import { containerStartHandler } from '@/tools/builtin/container/handlers/start';
import { requireContainer } from '@/tools/builtin/file/session';

function makeContext(initialFailure?: ContainerStartFailure): ToolContext {
  let sessionId: string | undefined;
  let lastFailure = initialFailure;

  return {
    spaceId: 'ws_test',
    threadId: 'thread_test',
    runId: 'run_test',
    userId: 'user_test',
    capabilities: [],
    env: {
      RUNTIME_HOST: 'runtime.example.internal',
    } as unknown as Env,
    db: {} as D1Database,
    get sessionId() {
      return sessionId;
    },
    setSessionId: vi.fn((nextSessionId: string | undefined) => {
      sessionId = nextSessionId;
    }),
    getLastContainerStartFailure: () => lastFailure,
    setLastContainerStartFailure: vi.fn((failure: ContainerStartFailure | undefined) => {
      lastFailure = failure;
    }),
  };
}

describe('container_start error propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // session lookup returns null (no existing session)
    mockSelectResults.session.mockReturnValue(null);
    // single repo lookup returns the default repo
    mockSelectResults.repository.mockReturnValue({
      id: 'repo_main',
      name: 'main',
      defaultBranch: 'main',
    });
    // multi-repo lookup returns the default repo
    mockSelectResults.repositories.mockReturnValue([{
      id: 'repo_main',
      name: 'main',
      defaultBranch: 'main',
    }]);

    mockRuntimeManager.setRepositories.mockReset();
    mockRuntimeManager.initSession.mockReset();
  });

  it('stores the failed container_start root cause for follow-up tools', async () => {
    vi.mocked(generateId)
      .mockReturnValueOnce('session_failed')
      .mockReturnValueOnce('session_repo_1');
    mockRuntimeManager.initSession.mockRejectedValue(
      new Error('Failed to init runtime session: boom')
    );

    const context = makeContext();

    await expect(containerStartHandler({}, context)).rejects.toThrow(
      'Failed to init runtime session: boom'
    );

    expect(context.sessionId).toBeUndefined();
    expect(context.getLastContainerStartFailure()).toEqual({
      message: 'Failed to init runtime session: boom',
      sessionId: 'session_failed',
    });

    expect(() => requireContainer(context)).toThrowError(
      'No container is running because the most recent container_start failed.\n\nLast start error: Failed to init runtime session: boom\nFailed session ID: session_failed\n\nResolve that error and call container_start again before using file operations.'
    );
  });

  it('clears stale start failures after a successful container_start', async () => {
    vi.mocked(generateId)
      .mockReturnValueOnce('session_running')
      .mockReturnValueOnce('session_repo_1');
    mockRuntimeManager.initSession.mockResolvedValue({
      success: true,
      file_count: 12,
      session_dir: '/workspace',
      work_dir: '/workspace',
      git_mode: true,
      branch: 'main',
    });

    const context = makeContext({
      message: 'Previous failure',
      sessionId: 'session_old',
    });

    const result = await containerStartHandler({}, context);

    expect(result).toContain('Session ID: session_running');
    expect(context.sessionId).toBe('session_running');
    expect(context.getLastContainerStartFailure()).toBeUndefined();
  });
});
