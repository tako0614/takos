import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext, ContainerStartFailure } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Drizzle-chainable mock
// ---------------------------------------------------------------------------

const mockSelectGet = vi.fn();
const mockSelectAll = vi.fn();
const mockInsert = vi.fn(async () => ({}));
const mockUpdateResult = vi.fn(() => ({ meta: { changes: 1 } }));

function createDrizzleMock() {
  return {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        get: vi.fn(async () => mockSelectGet()),
        all: vi.fn(async () => mockSelectAll()),
        _table: null as unknown,
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: mockInsert,
        returning: vi.fn(async () => [{}]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => mockUpdateResult()),
        run: vi.fn(async () => ({})),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => ({})),
    })),
  };
}

vi.mock('@/db', () => {
  const mock = createDrizzleMock();
  return {
    getDb: () => mock,
    sessions: { id: 'id', status: 'status', accountId: 'account_id', repoId: 'repo_id', branch: 'branch', lastHeartbeat: 'last_heartbeat', createdAt: 'created_at', updatedAt: 'updated_at', userAccountId: 'user_account_id', baseSnapshotId: 'base_snapshot_id' },
    sessionRepos: { id: 'id', sessionId: 'session_id', repoId: 'repo_id', branch: 'branch', mountPath: 'mount_path', isPrimary: 'is_primary', createdAt: 'created_at' },
    repositories: { id: 'id', name: 'name', accountId: 'account_id', defaultBranch: 'default_branch', createdAt: 'created_at' },
    runs: { id: 'id', sessionId: 'session_id' },
    accounts: { id: 'id', name: 'name', email: 'email' },
  };
});

const mockRuntimeManager = {
  setRepositories: vi.fn(),
  initSession: vi.fn(async () => ({ branch: 'main', file_count: 5 })),
  getSnapshot: vi.fn(async () => ({ files: [] })),
  syncSnapshotToRepo: vi.fn(async () => ({ committed: true, commitHash: 'abc123', error: undefined })),
};

vi.mock('@/services/sync', () => ({
  RuntimeSessionManager: vi.fn(() => mockRuntimeManager),
}));

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: vi.fn(async () => new Response(JSON.stringify({ files: [], file_count: 0 }), { status: 200 })),
}));

vi.mock('@/services/source/repos', () => ({
  createRepository: vi.fn(async () => ({
    id: 'repo-new',
    name: 'main',
    default_branch: 'main',
  })),
  RepositoryCreationError: class extends Error { constructor(msg: string) { super(msg); } },
}));

vi.mock('@/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils')>();
  return {
    ...actual,
    generateId: vi.fn(() => 'generated-id'),
  };
});

vi.mock('@/shared/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils/logger')>();
  return {
    ...actual,
    logDebug: vi.fn(),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
    logError: vi.fn(),
  };
});

import {
  CONTAINER_START,
  CONTAINER_COMMIT,
  CREATE_REPOSITORY,
  CONTAINER_TOOLS,
  CONTAINER_HANDLERS,
  containerStartHandler,
  containerStatusHandler,
  containerCommitHandler,
  containerStopHandler,
  createRepositoryHandler,
} from '@/tools/builtin/container';
import { RuntimeSessionManager } from '@/services/sync';
import { callRuntimeRequest } from '@/services/execution/runtime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  let lastFailure: ContainerStartFailure | undefined;
  let sessionId: string | undefined = overrides.sessionId;
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {
      RUNTIME_HOST: { fetch: vi.fn() },
      GIT_OBJECTS: {},
    } as unknown as Env,
    db: {} as D1Database,
    storage: {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(async () => ({ objects: [] })),
    } as unknown as ToolContext['storage'],
    get sessionId() { return sessionId; },
    setSessionId: vi.fn((id: string | undefined) => { sessionId = id; }),
    getLastContainerStartFailure: vi.fn(() => lastFailure),
    setLastContainerStartFailure: vi.fn((f: ContainerStartFailure | undefined) => { lastFailure = f; }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('container tool definitions', () => {
  it('defines all five container tools', () => {
    expect(CONTAINER_TOOLS).toHaveLength(5);
    const names = CONTAINER_TOOLS.map((t) => t.name);
    expect(names).toContain('container_start');
    expect(names).toContain('container_status');
    expect(names).toContain('container_commit');
    expect(names).toContain('container_stop');
    expect(names).toContain('create_repository');
  });

  it('all tools have container category', () => {
    for (const def of CONTAINER_TOOLS) {
      expect(def.category).toBe('container');
    }
  });

  it('CONTAINER_HANDLERS maps all tools', () => {
    const handlerKeys = Object.keys(CONTAINER_HANDLERS);
    expect(handlerKeys).toHaveLength(5);
    expect(handlerKeys).toContain('container_start');
    expect(handlerKeys).toContain('container_status');
    expect(handlerKeys).toContain('container_commit');
    expect(handlerKeys).toContain('container_stop');
    expect(handlerKeys).toContain('create_repository');
  });

  it('container_start has optional repo_id parameter', () => {
    expect(CONTAINER_START.parameters.properties).toHaveProperty('repo_id');
    expect(CONTAINER_START.parameters.required).toEqual([]);
  });

  it('container_commit has optional message parameter', () => {
    expect(CONTAINER_COMMIT.parameters.properties).toHaveProperty('message');
  });

  it('create_repository has optional name parameter', () => {
    expect(CREATE_REPOSITORY.parameters.properties).toHaveProperty('name');
    expect(CREATE_REPOSITORY.parameters.required).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// container_start handler
// ---------------------------------------------------------------------------

describe('containerStartHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeManager.setRepositories.mockClear();
    mockRuntimeManager.initSession.mockReset();
    mockRuntimeManager.initSession.mockResolvedValue({ branch: 'main', file_count: 5 });
  });

  it('returns already running message if session is active', async () => {
    // When sessionId is set and DB says session is running
    mockSelectGet.mockResolvedValue({ status: 'running', repoId: 'repo-1', branch: 'main' });

    const ctx = makeContext({ sessionId: 'session-existing' });
    const result = await containerStartHandler({}, ctx);

    expect(result).toContain('already running');
    expect(result).toContain('session-existing');
  });

  it('starts new session when no existing session', async () => {
    // First call: session lookup returns null (no existing session)
    // Then: repo lookup by name returns a repo
    // Then: multi-repo lookup .all() returns the repo
    mockSelectGet.mockResolvedValue({ id: 'repo-1', name: 'main', defaultBranch: 'main' });
    mockSelectAll.mockResolvedValue([{ id: 'repo-1', name: 'main', defaultBranch: 'main' }]);

    const ctx = makeContext({ sessionId: undefined });
    const result = await containerStartHandler({}, ctx);

    expect(result).toContain('Container started in Git mode');
    expect(result).toContain('file_read');
    expect(result).toContain('container_commit');
    expect(ctx.setSessionId).toHaveBeenCalled();
    expect(RuntimeSessionManager).toHaveBeenCalled();
    expect(mockRuntimeManager.setRepositories).toHaveBeenCalled();
    expect(mockRuntimeManager.initSession).toHaveBeenCalled();
  });

  it('creates session with explicit repo_id', async () => {
    // repo lookup by id (from inArray) returns the repo
    mockSelectGet.mockResolvedValue(null); // no existing session
    mockSelectAll.mockResolvedValue([{ id: 'repo-explicit', name: 'my-project', defaultBranch: 'develop' }]);

    const ctx = makeContext({ sessionId: undefined });
    const result = await containerStartHandler({ repo_id: 'repo-explicit' }, ctx);

    expect(result).toContain('Container started in Git mode');
    expect(result).toContain('my-project');
  });

  it('throws when no repository found in workspace', async () => {
    // Lookup by name returns null, lookup by oldest returns null
    mockSelectGet.mockResolvedValue(undefined);

    const ctx = makeContext({ sessionId: undefined });
    await expect(containerStartHandler({}, ctx)).rejects.toThrow('No repository found');
  });

  it('throws when RUNTIME_HOST is missing', async () => {
    mockSelectGet.mockResolvedValue({ id: 'repo-1', name: 'main', defaultBranch: 'main' });

    const ctx = makeContext({
      sessionId: undefined,
      env: { RUNTIME_HOST: undefined, GIT_OBJECTS: {} } as unknown as Env,
    });

    await expect(containerStartHandler({}, ctx)).rejects.toThrow('RUNTIME_HOST binding is required');
  });

  it('stores failure info when initSession fails', async () => {
    mockSelectGet.mockResolvedValue({ id: 'repo-1', name: 'main', defaultBranch: 'main' });
    mockSelectAll.mockResolvedValue([{ id: 'repo-1', name: 'main', defaultBranch: 'main' }]);
    mockRuntimeManager.initSession.mockRejectedValue(new Error('Runtime connection failed'));

    const ctx = makeContext({ sessionId: undefined });
    await expect(containerStartHandler({}, ctx)).rejects.toThrow('Runtime connection failed');

    expect(ctx.setLastContainerStartFailure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Runtime connection failed' }),
    );
  });

  it('clears previous failure on successful start', async () => {
    mockSelectGet.mockResolvedValue({ id: 'repo-1', name: 'main', defaultBranch: 'main' });
    mockSelectAll.mockResolvedValue([{ id: 'repo-1', name: 'main', defaultBranch: 'main' }]);

    const ctx = makeContext({ sessionId: undefined });
    // Simulate an existing failure
    (ctx as any).setLastContainerStartFailure({ message: 'old failure' });

    await containerStartHandler({}, ctx);

    // setLastContainerStartFailure should be called with undefined to clear
    expect(ctx.setLastContainerStartFailure).toHaveBeenCalledWith(undefined);
  });

  it('throws when repos from different workspace are specified', async () => {
    // inArray lookup returns empty - repo not found
    mockSelectGet.mockResolvedValue(null);
    mockSelectAll.mockResolvedValue([]);

    const ctx = makeContext({ sessionId: undefined });
    await expect(
      containerStartHandler({ repo_id: 'foreign-repo' }, ctx),
    ).rejects.toThrow('not found');
  });

  it('rejects multiple primary repos in mounts', async () => {
    mockSelectGet.mockResolvedValue(null);
    mockSelectAll.mockResolvedValue([
      { id: 'repo-a', name: 'alpha', defaultBranch: 'main' },
      { id: 'repo-b', name: 'beta', defaultBranch: 'main' },
    ]);

    const ctx = makeContext({ sessionId: undefined });
    await expect(
      containerStartHandler({
        mounts: [
          { repo_id: 'repo-a', is_primary: true },
          { repo_id: 'repo-b', is_primary: true },
        ],
      }, ctx),
    ).rejects.toThrow('Only one primary');
  });

  it('output includes file count from initSession', async () => {
    mockSelectGet.mockResolvedValue({ id: 'repo-1', name: 'main', defaultBranch: 'main' });
    mockSelectAll.mockResolvedValue([{ id: 'repo-1', name: 'main', defaultBranch: 'main' }]);
    mockRuntimeManager.initSession.mockResolvedValue({ branch: 'develop', file_count: 42 });

    const ctx = makeContext({ sessionId: undefined });
    const result = await containerStartHandler({}, ctx);

    expect(result).toContain('Files: 42');
  });
});

// ---------------------------------------------------------------------------
// container_status handler
// ---------------------------------------------------------------------------

describe('containerStatusHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports no container running when sessionId is absent', async () => {
    const ctx = makeContext({ sessionId: undefined });

    const result = await containerStatusHandler({}, ctx);

    expect(result).toContain('No container is running');
  });

  it('includes failure details when last start failed', async () => {
    const ctx = makeContext({ sessionId: undefined });
    // Manually set the failure
    (ctx as any).setLastContainerStartFailure({ message: 'init boom', sessionId: 'sess-dead' });
    // Update the mock to return the failure
    const failure = { message: 'init boom', sessionId: 'sess-dead' };
    ctx.getLastContainerStartFailure = vi.fn(() => failure);

    const result = await containerStatusHandler({}, ctx);

    expect(result).toContain('container_start failed');
    expect(result).toContain('init boom');
  });
});

// ---------------------------------------------------------------------------
// container_stop handler
// ---------------------------------------------------------------------------

describe('containerStopHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns message when no container is running', async () => {
    const ctx = makeContext({ sessionId: undefined });

    const result = await containerStopHandler({}, ctx);

    expect(result).toContain('No container is running');
  });

  it('stops running container and discards changes', async () => {
    // session lookup returns running
    mockSelectGet.mockResolvedValue({ status: 'running' });
    mockUpdateResult.mockReturnValue({ meta: { changes: 1 } });

    const ctx = makeContext({ sessionId: 'session-active' });
    const result = await containerStopHandler({}, ctx);

    expect(result).toContain('Container stopped');
    expect(result).toContain('DISCARDED');
    expect(ctx.setSessionId).toHaveBeenCalledWith(undefined);
  });

  it('returns early when session not found in DB', async () => {
    mockSelectGet.mockResolvedValue(null);

    const ctx = makeContext({ sessionId: 'session-ghost' });
    const result = await containerStopHandler({}, ctx);

    expect(result).toContain('not found');
  });

  it('returns early when session is not running', async () => {
    mockSelectGet.mockResolvedValue({ status: 'stopped' });

    const ctx = makeContext({ sessionId: 'session-old' });
    const result = await containerStopHandler({}, ctx);

    expect(result).toContain('not running');
    expect(result).toContain('stopped');
  });

  it('includes custom reason in output', async () => {
    mockSelectGet.mockResolvedValue({ status: 'running' });
    mockUpdateResult.mockReturnValue({ meta: { changes: 1 } });

    const ctx = makeContext({ sessionId: 'session-active' });
    const result = await containerStopHandler({ reason: 'User wants to restart' }, ctx);

    expect(result).toContain('User wants to restart');
  });

  it('handles concurrent state change (0 update changes)', async () => {
    mockSelectGet.mockResolvedValue({ status: 'running' });
    mockUpdateResult.mockReturnValue({ meta: { changes: 0 } });

    const ctx = makeContext({ sessionId: 'session-race' });
    const result = await containerStopHandler({}, ctx);

    expect(result).toContain('state changed');
  });
});

// ---------------------------------------------------------------------------
// container_commit handler
// ---------------------------------------------------------------------------

describe('containerCommitHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntimeManager.getSnapshot.mockReset();
    mockRuntimeManager.getSnapshot.mockResolvedValue({ files: [] });
    mockRuntimeManager.syncSnapshotToRepo.mockReset();
    mockRuntimeManager.syncSnapshotToRepo.mockResolvedValue({ committed: true, commitHash: 'abc123', error: undefined });
  });

  it('throws when no session is running', async () => {
    const ctx = makeContext({ sessionId: undefined });

    await expect(containerCommitHandler({}, ctx)).rejects.toThrow(
      'No container is running',
    );
  });

  it('commits changes and stops the container', async () => {
    // checkSessionHealth mock: session found and healthy
    mockSelectGet.mockResolvedValue({
      id: 'session-active',
      status: 'running',
      lastHeartbeat: new Date().toISOString(),
      createdAt: new Date(Date.now() - 60000).toISOString(),
    });
    // .all() for mounted repos
    mockSelectAll.mockResolvedValue([{
      id: 'sr-1',
      repoId: 'repo-1',
      branch: 'main',
      mountPath: '',
      isPrimary: true,
      createdAt: new Date().toISOString(),
      repoName: 'main',
    }]);

    const ctx = makeContext({ sessionId: 'session-active' });
    const result = await containerCommitHandler({}, ctx);

    expect(result).toContain('pushed to git');
    expect(result).toContain('abc123');
    expect(ctx.setSessionId).toHaveBeenCalledWith(undefined);
    expect(mockRuntimeManager.getSnapshot).toHaveBeenCalled();
    expect(mockRuntimeManager.syncSnapshotToRepo).toHaveBeenCalled();
  });

  it('includes custom commit message in output', async () => {
    mockSelectGet.mockResolvedValue({
      id: 'session-active',
      status: 'running',
      lastHeartbeat: new Date().toISOString(),
      createdAt: new Date(Date.now() - 60000).toISOString(),
    });
    mockSelectAll.mockResolvedValue([{
      id: 'sr-1',
      repoId: 'repo-1',
      branch: 'main',
      mountPath: '',
      isPrimary: true,
      createdAt: new Date().toISOString(),
      repoName: 'main',
    }]);

    const ctx = makeContext({ sessionId: 'session-active' });
    const result = await containerCommitHandler({ message: 'fix: resolve bug' }, ctx);

    expect(result).toContain('fix: resolve bug');
  });

  it('reports no changes when syncSnapshotToRepo returns committed=false', async () => {
    mockSelectGet.mockResolvedValue({
      id: 'session-active',
      status: 'running',
      lastHeartbeat: new Date().toISOString(),
      createdAt: new Date(Date.now() - 60000).toISOString(),
    });
    mockSelectAll.mockResolvedValue([{
      id: 'sr-1',
      repoId: 'repo-1',
      branch: 'main',
      mountPath: '',
      isPrimary: true,
      createdAt: new Date().toISOString(),
      repoName: 'main',
    }]);
    mockRuntimeManager.syncSnapshotToRepo.mockResolvedValue({
      committed: false,
      commitHash: '',
      error: undefined,
    });

    const ctx = makeContext({ sessionId: 'session-active' });
    const result = await containerCommitHandler({}, ctx);

    expect(result).toContain('No changes to commit');
  });
});

// ---------------------------------------------------------------------------
// create_repository handler
// ---------------------------------------------------------------------------

describe('createRepositoryHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns existing repository message when one already exists', async () => {
    mockSelectGet.mockResolvedValue({ id: 'repo-existing', name: 'main' });

    const result = await createRepositoryHandler({}, makeContext());

    expect(result).toContain('already exists');
    expect(result).toContain('repo-existing');
  });

  it('creates a new repository when none exists', async () => {
    mockSelectGet.mockResolvedValue(null);

    const result = await createRepositoryHandler({}, makeContext());

    expect(result).toContain('Repository created successfully');
    expect(result).toContain('repo-new');
    expect(result).toContain('container_start');
  });

  it('uses custom name when provided', async () => {
    mockSelectGet.mockResolvedValue(null);

    const result = await createRepositoryHandler({ name: 'my-repo' }, makeContext());

    expect(result).toContain('Repository created successfully');
  });
});
