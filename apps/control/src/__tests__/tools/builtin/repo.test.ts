import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert';

const mockSelectAll = ((..._args: any[]) => undefined) as any;
const mockSelectGet = ((..._args: any[]) => undefined) as any;
const mockUpdateWhere = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  repoListHandler,
  repoStatusHandler,
  repoSwitchHandler,
  REPO_LIST,
  REPO_STATUS,
  REPO_SWITCH,
  REPO_TOOLS,
} from '@/tools/builtin/repo';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: ['repo.read'],
    sessionId: 'session-1',
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


  
    Deno.test('repo tools - definitions - REPO_LIST has correct properties', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(REPO_LIST.name, 'repo_list');
      assertEquals(REPO_LIST.category, 'container');
})
    Deno.test('repo tools - definitions - REPO_STATUS has correct properties', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(REPO_STATUS.name, 'repo_status');
      assertEquals(REPO_STATUS.category, 'container');
})
    Deno.test('repo tools - definitions - REPO_SWITCH requires repo_id', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(REPO_SWITCH.name, 'repo_switch');
      assertEquals(REPO_SWITCH.parameters.required, ['repo_id']);
})
    Deno.test('repo tools - definitions - REPO_TOOLS exports all three tools', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(REPO_TOOLS.length, 3);
      assertEquals(REPO_TOOLS.map(t => t.name), ['repo_list', 'repo_status', 'repo_switch']);
})  
  
    Deno.test('repo tools - repoListHandler - throws when no container session is active', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await await assertRejects(async () => { await 
        repoListHandler({}, makeContext({ sessionId: undefined })),
      ; }, /container/i);
})
    Deno.test('repo tools - repoListHandler - returns empty message when no repos mounted', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectAll = (async () => []) as any;

      const result = await repoListHandler({}, makeContext());
      assertStringIncludes(result, 'No repositories are mounted');
})
    Deno.test('repo tools - repoListHandler - lists mounted repositories', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectAll = (async () => [
        {
          repoId: 'repo-1',
          branch: 'main',
          mountPath: '/',
          isPrimary: true,
          repoName: 'my-project',
        },
        {
          repoId: 'repo-2',
          branch: 'develop',
          mountPath: '/libs',
          isPrimary: false,
          repoName: 'lib-shared',
        },
      ]) as any;

      const result = await repoListHandler({}, makeContext());

      assertStringIncludes(result, 'my-project');
      assertStringIncludes(result, 'repo-1');
      assertStringIncludes(result, '[primary]');
      assertStringIncludes(result, 'lib-shared');
      assertStringIncludes(result, 'develop');
})  
  
    Deno.test('repo tools - repoStatusHandler - throws when no container session is active', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await await assertRejects(async () => { await 
        repoStatusHandler({}, makeContext({ sessionId: undefined })),
      ; }, /container/i);
})
    Deno.test('repo tools - repoStatusHandler - returns no active repository message', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectGet = (async () => null) as any;

      const result = await repoStatusHandler({}, makeContext());
      assertStringIncludes(result, 'No active repository');
})
    Deno.test('repo tools - repoStatusHandler - shows the active repository', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectGet = (async () => ({
        repoId: 'repo-1',
        branch: 'main',
        mountPath: '/',
        repoName: 'my-project',
      })) as any;

      const result = await repoStatusHandler({}, makeContext());

      assertStringIncludes(result, 'Active repository');
      assertStringIncludes(result, 'my-project');
      assertStringIncludes(result, 'repo-1');
      assertStringIncludes(result, 'main');
})  
  
    Deno.test('repo tools - repoSwitchHandler - throws when no container session is active', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await await assertRejects(async () => { await 
        repoSwitchHandler({ repo_id: 'repo-1' }, makeContext({ sessionId: undefined })),
      ; }, /container/i);
})
    Deno.test('repo tools - repoSwitchHandler - throws when repo_id is missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await await assertRejects(async () => { await 
        repoSwitchHandler({}, makeContext()),
      ; }, 'repo_id is required');
})
    Deno.test('repo tools - repoSwitchHandler - throws when repo_id is not a string', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await await assertRejects(async () => { await 
        repoSwitchHandler({ repo_id: 123 }, makeContext()),
      ; }, 'repo_id is required');
})
    Deno.test('repo tools - repoSwitchHandler - throws when repository is not mounted', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectGet = (async () => null) as any;

      await await assertRejects(async () => { await 
        repoSwitchHandler({ repo_id: 'repo-unknown' }, makeContext()),
      ; }, 'not mounted');
})
    Deno.test('repo tools - repoSwitchHandler - switches the active repository', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectGet = (async () => ({
        id: 'sr-1',
        repoId: 'repo-2',
        branch: 'develop',
        mountPath: '/libs',
        repoName: 'lib-shared',
      })) as any;
      mockUpdateWhere = (async () => ({})) as any;

      const result = await repoSwitchHandler(
        { repo_id: 'repo-2' },
        makeContext(),
      );

      assertStringIncludes(result, 'switched to');
      assertStringIncludes(result, 'lib-shared');
      assertStringIncludes(result, 'repo-2');
})  