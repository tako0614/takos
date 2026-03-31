import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { assertEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockAppDeploymentService = {
  list: ((..._args: any[]) => undefined) as any,
  get: ((..._args: any[]) => undefined) as any,
  deployFromRepoRef: ((..._args: any[]) => undefined) as any,
  remove: ((..._args: any[]) => undefined) as any,
  rollback: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/services/platform/app-deployments'
import {
  APP_DEPLOYMENT_LIST,
  APP_DEPLOYMENT_GET,
  APP_DEPLOYMENT_DEPLOY_FROM_REPO,
  APP_DEPLOYMENT_REMOVE,
  APP_DEPLOYMENT_ROLLBACK,
  WORKSPACE_APP_DEPLOYMENT_TOOLS,
  WORKSPACE_APP_DEPLOYMENT_HANDLERS,
  appDeploymentListHandler,
  appDeploymentGetHandler,
  appDeploymentDeployFromRepoHandler,
  appDeploymentRemoveHandler,
  appDeploymentRollbackHandler,
} from '@/tools/builtin/space-app-deployments';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------


  Deno.test('workspace app deployment tool definitions - defines all five tools', () => {
  assertEquals(WORKSPACE_APP_DEPLOYMENT_TOOLS.length, 5);
    const names = WORKSPACE_APP_DEPLOYMENT_TOOLS.map((t) => t.name);
    assertStringIncludes(names, 'app_deployment_list');
    assertStringIncludes(names, 'app_deployment_get');
    assertStringIncludes(names, 'app_deployment_deploy_from_repo');
    assertStringIncludes(names, 'app_deployment_remove');
    assertStringIncludes(names, 'app_deployment_rollback');
})
  Deno.test('workspace app deployment tool definitions - all tools have workspace category', () => {
  for (const def of WORKSPACE_APP_DEPLOYMENT_TOOLS) {
      assertEquals(def.category, 'workspace');
    }
})
  Deno.test('workspace app deployment tool definitions - WORKSPACE_APP_DEPLOYMENT_HANDLERS maps all tools', () => {
  for (const def of WORKSPACE_APP_DEPLOYMENT_TOOLS) {
      assert(def.name in WORKSPACE_APP_DEPLOYMENT_HANDLERS);
    }
})
  Deno.test('workspace app deployment tool definitions - app_deployment_list has no required params', () => {
  assertEquals(APP_DEPLOYMENT_LIST.parameters.required, undefined);
})
  Deno.test('workspace app deployment tool definitions - app_deployment_get requires app_deployment_id', () => {
  assertEquals(APP_DEPLOYMENT_GET.parameters.required, ['app_deployment_id']);
})
  Deno.test('workspace app deployment tool definitions - app_deployment_deploy_from_repo requires repo_id and ref', () => {
  assertEquals(APP_DEPLOYMENT_DEPLOY_FROM_REPO.parameters.required, ['repo_id', 'ref']);
})
  Deno.test('workspace app deployment tool definitions - app_deployment_remove requires app_deployment_id', () => {
  assertEquals(APP_DEPLOYMENT_REMOVE.parameters.required, ['app_deployment_id']);
})
  Deno.test('workspace app deployment tool definitions - app_deployment_rollback requires app_deployment_id', () => {
  assertEquals(APP_DEPLOYMENT_ROLLBACK.parameters.required, ['app_deployment_id']);
})
// ---------------------------------------------------------------------------
// appDeploymentListHandler
// ---------------------------------------------------------------------------


  
  Deno.test('appDeploymentListHandler - returns a list of app deployments', async () => {
  mockAppDeploymentService.list = (async () => [
      { id: 'ad-1', name: 'My App', status: 'deployed' },
      { id: 'ad-2', name: 'Other App', status: 'pending' },
    ]) as any;

    const result = JSON.parse(await appDeploymentListHandler({}, makeContext()));

    assertEquals(result.app_deployments.length, 2);
    assertEquals(result.app_deployments[0].name, 'My App');
})
  Deno.test('appDeploymentListHandler - returns empty list when no deployments', async () => {
  mockAppDeploymentService.list = (async () => []) as any;

    const result = JSON.parse(await appDeploymentListHandler({}, makeContext()));
    assertEquals(result.app_deployments, []);
})
// ---------------------------------------------------------------------------
// appDeploymentGetHandler
// ---------------------------------------------------------------------------


  
  Deno.test('appDeploymentGetHandler - throws when app_deployment_id is empty', async () => {
  await await assertRejects(async () => { await 
      appDeploymentGetHandler({ app_deployment_id: '' }, makeContext()),
    ; }, 'app_deployment_id is required');
})
  Deno.test('appDeploymentGetHandler - throws when deployment not found', async () => {
  mockAppDeploymentService.get = (async () => null) as any;

    await await assertRejects(async () => { await 
      appDeploymentGetHandler({ app_deployment_id: 'ad-missing' }, makeContext()),
    ; }, 'App deployment not found');
})
  Deno.test('appDeploymentGetHandler - returns deployment details', async () => {
  mockAppDeploymentService.get = (async () => ({
      id: 'ad-1',
      name: 'My App',
      status: 'deployed',
    })) as any;

    const result = JSON.parse(
      await appDeploymentGetHandler({ app_deployment_id: 'ad-1' }, makeContext()),
    );
    assertEquals(result.app_deployment.id, 'ad-1');
    assertEquals(result.app_deployment.status, 'deployed');
})
// ---------------------------------------------------------------------------
// appDeploymentDeployFromRepoHandler
// ---------------------------------------------------------------------------


  
  Deno.test('appDeploymentDeployFromRepoHandler - throws when repo_id is empty', async () => {
  await await assertRejects(async () => { await 
      appDeploymentDeployFromRepoHandler({ repo_id: '', ref: 'main' }, makeContext()),
    ; }, 'repo_id is required');
})
  Deno.test('appDeploymentDeployFromRepoHandler - throws when ref is empty', async () => {
  await await assertRejects(async () => { await 
      appDeploymentDeployFromRepoHandler({ repo_id: 'r-1', ref: '' }, makeContext()),
    ; }, 'ref is required');
})
  Deno.test('appDeploymentDeployFromRepoHandler - throws when ref_type is invalid', async () => {
  await await assertRejects(async () => { await 
      appDeploymentDeployFromRepoHandler(
        { repo_id: 'r-1', ref: 'v1.0', ref_type: 'invalid' },
        makeContext(),
      ),
    ; }, 'ref_type must be one of');
})
  Deno.test('appDeploymentDeployFromRepoHandler - deploys from repo ref', async () => {
  mockAppDeploymentService.deployFromRepoRef = (async () => ({
      deployment_id: 'd-1',
      status: 'deploying',
    })) as any;

    const result = JSON.parse(
      await appDeploymentDeployFromRepoHandler(
        { repo_id: 'r-1', ref: 'main', ref_type: 'branch' },
        makeContext(),
      ),
    );

    assertEquals(result.success, true);
    assertEquals(result.data.deployment_id, 'd-1');
    assertSpyCallArgs(mockAppDeploymentService.deployFromRepoRef, 0, [
      'ws-test',
      'user-1',
      ({
        repoId: 'r-1',
        ref: 'main',
        refType: 'branch',
      }),
    ]);
})
  Deno.test('appDeploymentDeployFromRepoHandler - defaults ref_type to branch', async () => {
  mockAppDeploymentService.deployFromRepoRef = (async () => ({ status: 'ok' })) as any;

    await appDeploymentDeployFromRepoHandler(
      { repo_id: 'r-1', ref: 'main' },
      makeContext(),
    );

    assertSpyCallArgs(mockAppDeploymentService.deployFromRepoRef, 0, [
      'ws-test',
      'user-1',
      ({ refType: 'branch' }),
    ]);
})
  Deno.test('appDeploymentDeployFromRepoHandler - passes approval flags', async () => {
  mockAppDeploymentService.deployFromRepoRef = (async () => ({ status: 'ok' })) as any;

    await appDeploymentDeployFromRepoHandler(
      {
        repo_id: 'r-1',
        ref: 'main',
        approve_oauth_auto_env: true,
        approve_source_change: true,
      },
      makeContext(),
    );

    assertSpyCallArgs(mockAppDeploymentService.deployFromRepoRef, 0, [
      'ws-test',
      'user-1',
      ({
        approveOauthAutoEnv: true,
        approveSourceChange: true,
      }),
    ]);
})
// ---------------------------------------------------------------------------
// appDeploymentRemoveHandler
// ---------------------------------------------------------------------------


  
  Deno.test('appDeploymentRemoveHandler - throws when app_deployment_id is empty', async () => {
  await await assertRejects(async () => { await 
      appDeploymentRemoveHandler({ app_deployment_id: '' }, makeContext()),
    ; }, 'app_deployment_id is required');
})
  Deno.test('appDeploymentRemoveHandler - removes deployment and returns success', async () => {
  mockAppDeploymentService.remove = (async () => undefined) as any;

    const result = JSON.parse(
      await appDeploymentRemoveHandler({ app_deployment_id: 'ad-1' }, makeContext()),
    );

    assertEquals(result.success, true);
    assertEquals(result.app_deployment_id, 'ad-1');
})
// ---------------------------------------------------------------------------
// appDeploymentRollbackHandler
// ---------------------------------------------------------------------------


  
  Deno.test('appDeploymentRollbackHandler - throws when app_deployment_id is empty', async () => {
  await await assertRejects(async () => { await 
      appDeploymentRollbackHandler({ app_deployment_id: '' }, makeContext()),
    ; }, 'app_deployment_id is required');
})
  Deno.test('appDeploymentRollbackHandler - performs rollback', async () => {
  mockAppDeploymentService.rollback = (async () => ({
      deployment_id: 'd-rollback',
      status: 'deploying',
    })) as any;

    const result = JSON.parse(
      await appDeploymentRollbackHandler({ app_deployment_id: 'ad-1' }, makeContext()),
    );

    assertEquals(result.success, true);
    assertEquals(result.data.deployment_id, 'd-rollback');
})
  Deno.test('appDeploymentRollbackHandler - passes approval flags', async () => {
  mockAppDeploymentService.rollback = (async () => ({ status: 'ok' })) as any;

    await appDeploymentRollbackHandler(
      { app_deployment_id: 'ad-1', approve_oauth_auto_env: true },
      makeContext(),
    );

    assertSpyCallArgs(mockAppDeploymentService.rollback, 0, [
      'ws-test',
      'user-1',
      'ad-1',
      { approveOauthAutoEnv: true },
    ]);
})