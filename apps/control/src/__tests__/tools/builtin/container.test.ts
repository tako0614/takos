import type { ToolContext, ContainerStartFailure } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Drizzle-chainable mock
// ---------------------------------------------------------------------------

import { assertEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockSelectGet = ((..._args: any[]) => undefined) as any;
const mockSelectAll = ((..._args: any[]) => undefined) as any;
const mockInsert = async () => ({});
const mockUpdateResult = () => ({ meta: { changes: 1 } });

function createDrizzleMock() {
  return {
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        innerJoin: () => chain,
        get: async () => mockSelectGet(),
        all: async () => mockSelectAll(),
        _table: null as unknown,
      };
      return chain;
    },
    insert: () => ({
      values: () => ({
        run: mockInsert,
        returning: async () => [{}],
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => mockUpdateResult(),
        run: async () => ({}),
      }),
    }),
    delete: () => ({
      where: async () => ({}),
    }),
  };
}

// [Deno] vi.mock removed - manually stub imports from '@/db'
const mockRuntimeManager = {
  setRepositories: ((..._args: any[]) => undefined) as any,
  initSession: async () => ({ branch: 'main', file_count: 5 }),
  getSnapshot: async () => ({ files: [] }),
  syncSnapshotToRepo: async () => ({ committed: true, commitHash: 'abc123', error: undefined }),
};

// [Deno] vi.mock removed - manually stub imports from '@/services/sync'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/source/repos'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
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
      RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
      GIT_OBJECTS: {},
    } as unknown as Env,
    db: {} as D1Database,
    storage: {
      put: ((..._args: any[]) => undefined) as any,
      get: ((..._args: any[]) => undefined) as any,
      delete: ((..._args: any[]) => undefined) as any,
      list: async () => ({ objects: [] }),
    } as unknown as ToolContext['storage'],
    get sessionId() { return sessionId; },
    setSessionId: (id: string | undefined) => { sessionId = id; },
    getLastContainerStartFailure: () => lastFailure,
    setLastContainerStartFailure: (f: ContainerStartFailure | undefined) => { lastFailure = f; },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------


  Deno.test('container tool definitions - defines all five container tools', () => {
  assertEquals(CONTAINER_TOOLS.length, 5);
    const names = CONTAINER_TOOLS.map((t) => t.name);
    assertStringIncludes(names, 'container_start');
    assertStringIncludes(names, 'container_status');
    assertStringIncludes(names, 'container_commit');
    assertStringIncludes(names, 'container_stop');
    assertStringIncludes(names, 'create_repository');
})
  Deno.test('container tool definitions - all tools have container category', () => {
  for (const def of CONTAINER_TOOLS) {
      assertEquals(def.category, 'container');
    }
})
  Deno.test('container tool definitions - CONTAINER_HANDLERS maps all tools', () => {
  const handlerKeys = Object.keys(CONTAINER_HANDLERS);
    assertEquals(handlerKeys.length, 5);
    assertStringIncludes(handlerKeys, 'container_start');
    assertStringIncludes(handlerKeys, 'container_status');
    assertStringIncludes(handlerKeys, 'container_commit');
    assertStringIncludes(handlerKeys, 'container_stop');
    assertStringIncludes(handlerKeys, 'create_repository');
})
  Deno.test('container tool definitions - container_start has optional repo_id parameter', () => {
  assert('repo_id' in CONTAINER_START.parameters.properties);
    assertEquals(CONTAINER_START.parameters.required, []);
})
  Deno.test('container tool definitions - container_commit has optional message parameter', () => {
  assert('message' in CONTAINER_COMMIT.parameters.properties);
})
  Deno.test('container tool definitions - create_repository has optional name parameter', () => {
  assert('name' in CREATE_REPOSITORY.parameters.properties);
    assertEquals(CREATE_REPOSITORY.parameters.required, []);
})
// ---------------------------------------------------------------------------
// container_start handler
// ---------------------------------------------------------------------------


  Deno.test('containerStartHandler - returns already running message if session is active', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.setRepositories;
    mockRuntimeManager.initSession;
    mockRuntimeManager.initSession = (async () => ({ branch: 'main', file_count: 5 })) as any;
  // When sessionId is set and DB says session is running
    mockSelectGet = (async () => ({ status: 'running', repoId: 'repo-1', branch: 'main' })) as any;

    const ctx = makeContext({ sessionId: 'session-existing' });
    const result = await containerStartHandler({}, ctx);

    assertStringIncludes(result, 'already running');
    assertStringIncludes(result, 'session-existing');
})
  Deno.test('containerStartHandler - starts new session when no existing session', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.setRepositories;
    mockRuntimeManager.initSession;
    mockRuntimeManager.initSession = (async () => ({ branch: 'main', file_count: 5 })) as any;
  // First call: session lookup returns null (no existing session)
    // Then: repo lookup by name returns a repo
    // Then: multi-repo lookup .all() returns the repo
    mockSelectGet = (async () => ({ id: 'repo-1', name: 'main', defaultBranch: 'main' })) as any;
    mockSelectAll = (async () => [{ id: 'repo-1', name: 'main', defaultBranch: 'main' }]) as any;

    const ctx = makeContext({ sessionId: undefined });
    const result = await containerStartHandler({}, ctx);

    assertStringIncludes(result, 'Container started in Git mode');
    assertStringIncludes(result, 'file_read');
    assertStringIncludes(result, 'container_commit');
    assert(ctx.setSessionId.calls.length > 0);
    assert(RuntimeSessionManager.calls.length > 0);
    assert(mockRuntimeManager.setRepositories.calls.length > 0);
    assert(mockRuntimeManager.initSession.calls.length > 0);
})
  Deno.test('containerStartHandler - creates session with explicit repo_id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.setRepositories;
    mockRuntimeManager.initSession;
    mockRuntimeManager.initSession = (async () => ({ branch: 'main', file_count: 5 })) as any;
  // repo lookup by id (from inArray) returns the repo
    mockSelectGet = (async () => null) as any; // no existing session
    mockSelectAll = (async () => [{ id: 'repo-explicit', name: 'my-project', defaultBranch: 'develop' }]) as any;

    const ctx = makeContext({ sessionId: undefined });
    const result = await containerStartHandler({ repo_id: 'repo-explicit' }, ctx);

    assertStringIncludes(result, 'Container started in Git mode');
    assertStringIncludes(result, 'my-project');
})
  Deno.test('containerStartHandler - throws when no repository found in workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.setRepositories;
    mockRuntimeManager.initSession;
    mockRuntimeManager.initSession = (async () => ({ branch: 'main', file_count: 5 })) as any;
  // Lookup by name returns null, lookup by oldest returns null
    mockSelectGet = (async () => undefined) as any;

    const ctx = makeContext({ sessionId: undefined });
    await await assertRejects(async () => { await containerStartHandler({}, ctx); }, 'No repository found');
})
  Deno.test('containerStartHandler - throws when RUNTIME_HOST is missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.setRepositories;
    mockRuntimeManager.initSession;
    mockRuntimeManager.initSession = (async () => ({ branch: 'main', file_count: 5 })) as any;
  mockSelectGet = (async () => ({ id: 'repo-1', name: 'main', defaultBranch: 'main' })) as any;

    const ctx = makeContext({
      sessionId: undefined,
      env: { RUNTIME_HOST: undefined, GIT_OBJECTS: {} } as unknown as Env,
    });

    await await assertRejects(async () => { await containerStartHandler({}, ctx); }, 'RUNTIME_HOST binding is required');
})
  Deno.test('containerStartHandler - stores failure info when initSession fails', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.setRepositories;
    mockRuntimeManager.initSession;
    mockRuntimeManager.initSession = (async () => ({ branch: 'main', file_count: 5 })) as any;
  mockSelectGet = (async () => ({ id: 'repo-1', name: 'main', defaultBranch: 'main' })) as any;
    mockSelectAll = (async () => [{ id: 'repo-1', name: 'main', defaultBranch: 'main' }]) as any;
    mockRuntimeManager.initSession = (async () => { throw new Error('Runtime connection failed'); }) as any;

    const ctx = makeContext({ sessionId: undefined });
    await await assertRejects(async () => { await containerStartHandler({}, ctx); }, 'Runtime connection failed');

    assertSpyCallArgs(ctx.setLastContainerStartFailure, 0, [
      ({ message: 'Runtime connection failed' }),
    ]);
})
  Deno.test('containerStartHandler - clears previous failure on successful start', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.setRepositories;
    mockRuntimeManager.initSession;
    mockRuntimeManager.initSession = (async () => ({ branch: 'main', file_count: 5 })) as any;
  mockSelectGet = (async () => ({ id: 'repo-1', name: 'main', defaultBranch: 'main' })) as any;
    mockSelectAll = (async () => [{ id: 'repo-1', name: 'main', defaultBranch: 'main' }]) as any;

    const ctx = makeContext({ sessionId: undefined });
    // Simulate an existing failure
    (ctx as any).setLastContainerStartFailure({ message: 'old failure' });

    await containerStartHandler({}, ctx);

    // setLastContainerStartFailure should be called with undefined to clear
    assertSpyCallArgs(ctx.setLastContainerStartFailure, 0, [undefined]);
})
  Deno.test('containerStartHandler - throws when repos from different workspace are specified', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.setRepositories;
    mockRuntimeManager.initSession;
    mockRuntimeManager.initSession = (async () => ({ branch: 'main', file_count: 5 })) as any;
  // inArray lookup returns empty - repo not found
    mockSelectGet = (async () => null) as any;
    mockSelectAll = (async () => []) as any;

    const ctx = makeContext({ sessionId: undefined });
    await await assertRejects(async () => { await 
      containerStartHandler({ repo_id: 'foreign-repo' }, ctx),
    ; }, 'not found');
})
  Deno.test('containerStartHandler - rejects multiple primary repos in mounts', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.setRepositories;
    mockRuntimeManager.initSession;
    mockRuntimeManager.initSession = (async () => ({ branch: 'main', file_count: 5 })) as any;
  mockSelectGet = (async () => null) as any;
    mockSelectAll = (async () => [
      { id: 'repo-a', name: 'alpha', defaultBranch: 'main' },
      { id: 'repo-b', name: 'beta', defaultBranch: 'main' },
    ]) as any;

    const ctx = makeContext({ sessionId: undefined });
    await await assertRejects(async () => { await 
      containerStartHandler({
        mounts: [
          { repo_id: 'repo-a', is_primary: true },
          { repo_id: 'repo-b', is_primary: true },
        ],
      }, ctx),
    ; }, 'Only one primary');
})
  Deno.test('containerStartHandler - output includes file count from initSession', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.setRepositories;
    mockRuntimeManager.initSession;
    mockRuntimeManager.initSession = (async () => ({ branch: 'main', file_count: 5 })) as any;
  mockSelectGet = (async () => ({ id: 'repo-1', name: 'main', defaultBranch: 'main' })) as any;
    mockSelectAll = (async () => [{ id: 'repo-1', name: 'main', defaultBranch: 'main' }]) as any;
    mockRuntimeManager.initSession = (async () => ({ branch: 'develop', file_count: 42 })) as any;

    const ctx = makeContext({ sessionId: undefined });
    const result = await containerStartHandler({}, ctx);

    assertStringIncludes(result, 'Files: 42');
})
// ---------------------------------------------------------------------------
// container_status handler
// ---------------------------------------------------------------------------


  
  Deno.test('containerStatusHandler - reports no container running when sessionId is absent', async () => {
  const ctx = makeContext({ sessionId: undefined });

    const result = await containerStatusHandler({}, ctx);

    assertStringIncludes(result, 'No container is running');
})
  Deno.test('containerStatusHandler - includes failure details when last start failed', async () => {
  const ctx = makeContext({ sessionId: undefined });
    // Manually set the failure
    (ctx as any).setLastContainerStartFailure({ message: 'init boom', sessionId: 'sess-dead' });
    // Update the mock to return the failure
    const failure = { message: 'init boom', sessionId: 'sess-dead' };
    ctx.getLastContainerStartFailure = () => failure;

    const result = await containerStatusHandler({}, ctx);

    assertStringIncludes(result, 'container_start failed');
    assertStringIncludes(result, 'init boom');
})
// ---------------------------------------------------------------------------
// container_stop handler
// ---------------------------------------------------------------------------


  
  Deno.test('containerStopHandler - returns message when no container is running', async () => {
  const ctx = makeContext({ sessionId: undefined });

    const result = await containerStopHandler({}, ctx);

    assertStringIncludes(result, 'No container is running');
})
  Deno.test('containerStopHandler - stops running container and discards changes', async () => {
  // session lookup returns running
    mockSelectGet = (async () => ({ status: 'running' })) as any;
    mockUpdateResult = (() => ({ meta: { changes: 1 } })) as any;

    const ctx = makeContext({ sessionId: 'session-active' });
    const result = await containerStopHandler({}, ctx);

    assertStringIncludes(result, 'Container stopped');
    assertStringIncludes(result, 'DISCARDED');
    assertSpyCallArgs(ctx.setSessionId, 0, [undefined]);
})
  Deno.test('containerStopHandler - returns early when session not found in DB', async () => {
  mockSelectGet = (async () => null) as any;

    const ctx = makeContext({ sessionId: 'session-ghost' });
    const result = await containerStopHandler({}, ctx);

    assertStringIncludes(result, 'not found');
})
  Deno.test('containerStopHandler - returns early when session is not running', async () => {
  mockSelectGet = (async () => ({ status: 'stopped' })) as any;

    const ctx = makeContext({ sessionId: 'session-old' });
    const result = await containerStopHandler({}, ctx);

    assertStringIncludes(result, 'not running');
    assertStringIncludes(result, 'stopped');
})
  Deno.test('containerStopHandler - includes custom reason in output', async () => {
  mockSelectGet = (async () => ({ status: 'running' })) as any;
    mockUpdateResult = (() => ({ meta: { changes: 1 } })) as any;

    const ctx = makeContext({ sessionId: 'session-active' });
    const result = await containerStopHandler({ reason: 'User wants to restart' }, ctx);

    assertStringIncludes(result, 'User wants to restart');
})
  Deno.test('containerStopHandler - handles concurrent state change (0 update changes)', async () => {
  mockSelectGet = (async () => ({ status: 'running' })) as any;
    mockUpdateResult = (() => ({ meta: { changes: 0 } })) as any;

    const ctx = makeContext({ sessionId: 'session-race' });
    const result = await containerStopHandler({}, ctx);

    assertStringIncludes(result, 'state changed');
})
// ---------------------------------------------------------------------------
// container_commit handler
// ---------------------------------------------------------------------------


  Deno.test('containerCommitHandler - throws when no session is running', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.getSnapshot;
    mockRuntimeManager.getSnapshot = (async () => ({ files: [] })) as any;
    mockRuntimeManager.syncSnapshotToRepo;
    mockRuntimeManager.syncSnapshotToRepo = (async () => ({ committed: true, commitHash: 'abc123', error: undefined })) as any;
  const ctx = makeContext({ sessionId: undefined });

    await await assertRejects(async () => { await containerCommitHandler({}, ctx); }, 
      'No container is running',
    );
})
  Deno.test('containerCommitHandler - commits changes and stops the container', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.getSnapshot;
    mockRuntimeManager.getSnapshot = (async () => ({ files: [] })) as any;
    mockRuntimeManager.syncSnapshotToRepo;
    mockRuntimeManager.syncSnapshotToRepo = (async () => ({ committed: true, commitHash: 'abc123', error: undefined })) as any;
  // checkSessionHealth mock: session found and healthy
    mockSelectGet = (async () => ({
      id: 'session-active',
      status: 'running',
      lastHeartbeat: new Date().toISOString(),
      createdAt: new Date(Date.now() - 60000).toISOString(),
    })) as any;
    // .all() for mounted repos
    mockSelectAll = (async () => [{
      id: 'sr-1',
      repoId: 'repo-1',
      branch: 'main',
      mountPath: '',
      isPrimary: true,
      createdAt: new Date().toISOString(),
      repoName: 'main',
    }]) as any;

    const ctx = makeContext({ sessionId: 'session-active' });
    const result = await containerCommitHandler({}, ctx);

    assertStringIncludes(result, 'pushed to git');
    assertStringIncludes(result, 'abc123');
    assertSpyCallArgs(ctx.setSessionId, 0, [undefined]);
    assert(mockRuntimeManager.getSnapshot.calls.length > 0);
    assert(mockRuntimeManager.syncSnapshotToRepo.calls.length > 0);
})
  Deno.test('containerCommitHandler - includes custom commit message in output', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.getSnapshot;
    mockRuntimeManager.getSnapshot = (async () => ({ files: [] })) as any;
    mockRuntimeManager.syncSnapshotToRepo;
    mockRuntimeManager.syncSnapshotToRepo = (async () => ({ committed: true, commitHash: 'abc123', error: undefined })) as any;
  mockSelectGet = (async () => ({
      id: 'session-active',
      status: 'running',
      lastHeartbeat: new Date().toISOString(),
      createdAt: new Date(Date.now() - 60000).toISOString(),
    })) as any;
    mockSelectAll = (async () => [{
      id: 'sr-1',
      repoId: 'repo-1',
      branch: 'main',
      mountPath: '',
      isPrimary: true,
      createdAt: new Date().toISOString(),
      repoName: 'main',
    }]) as any;

    const ctx = makeContext({ sessionId: 'session-active' });
    const result = await containerCommitHandler({ message: 'fix: resolve bug' }, ctx);

    assertStringIncludes(result, 'fix: resolve bug');
})
  Deno.test('containerCommitHandler - reports no changes when syncSnapshotToRepo returns committed=false', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockRuntimeManager.getSnapshot;
    mockRuntimeManager.getSnapshot = (async () => ({ files: [] })) as any;
    mockRuntimeManager.syncSnapshotToRepo;
    mockRuntimeManager.syncSnapshotToRepo = (async () => ({ committed: true, commitHash: 'abc123', error: undefined })) as any;
  mockSelectGet = (async () => ({
      id: 'session-active',
      status: 'running',
      lastHeartbeat: new Date().toISOString(),
      createdAt: new Date(Date.now() - 60000).toISOString(),
    })) as any;
    mockSelectAll = (async () => [{
      id: 'sr-1',
      repoId: 'repo-1',
      branch: 'main',
      mountPath: '',
      isPrimary: true,
      createdAt: new Date().toISOString(),
      repoName: 'main',
    }]) as any;
    mockRuntimeManager.syncSnapshotToRepo = (async () => ({
      committed: false,
      commitHash: '',
      error: undefined,
    })) as any;

    const ctx = makeContext({ sessionId: 'session-active' });
    const result = await containerCommitHandler({}, ctx);

    assertStringIncludes(result, 'No changes to commit');
})
// ---------------------------------------------------------------------------
// create_repository handler
// ---------------------------------------------------------------------------


  
  Deno.test('createRepositoryHandler - returns existing repository message when one already exists', async () => {
  mockSelectGet = (async () => ({ id: 'repo-existing', name: 'main' })) as any;

    const result = await createRepositoryHandler({}, makeContext());

    assertStringIncludes(result, 'already exists');
    assertStringIncludes(result, 'repo-existing');
})
  Deno.test('createRepositoryHandler - creates a new repository when none exists', async () => {
  mockSelectGet = (async () => null) as any;

    const result = await createRepositoryHandler({}, makeContext());

    assertStringIncludes(result, 'Repository created successfully');
    assertStringIncludes(result, 'repo-new');
    assertStringIncludes(result, 'container_start');
})
  Deno.test('createRepositoryHandler - uses custom name when provided', async () => {
  mockSelectGet = (async () => null) as any;

    const result = await createRepositoryHandler({ name: 'my-repo' }, makeContext());

    assertStringIncludes(result, 'Repository created successfully');
})