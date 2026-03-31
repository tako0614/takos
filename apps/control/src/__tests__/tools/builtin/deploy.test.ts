import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// [Deno] vi.mock removed - manually stub imports from '@/services/source/apps'
import { deployFrontendHandler, DEPLOY_FRONTEND, DEPLOY_TOOLS } from '@/tools/builtin/deploy';
import { deployFrontendFromWorkspace } from '@/services/source/apps';

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

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


  
    Deno.test('deploy tools - DEPLOY_FRONTEND definition - has the correct name and required params', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(DEPLOY_FRONTEND.name, 'deploy_frontend');
      assertEquals(DEPLOY_FRONTEND.category, 'deploy');
      assertEquals(DEPLOY_FRONTEND.parameters.required, ['app_name']);
})  
  
    Deno.test('deploy tools - DEPLOY_TOOLS - exports the deploy_frontend tool', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(DEPLOY_TOOLS.length, 1);
      assertEquals(DEPLOY_TOOLS[0].name, 'deploy_frontend');
})  
  
    Deno.test('deploy tools - deployFrontendHandler - deploys from workspace with defaults', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  deployFrontendFromWorkspace = (async () => ({
        appName: 'my-app',
        uploaded: 5,
        url: 'https://my-app.takos.dev',
      })) as any;

      const result = await deployFrontendHandler(
        { app_name: 'my-app' },
        makeContext(),
      );

      assertStringIncludes(result, 'Frontend deployed.');
      assertStringIncludes(result, 'App: my-app');
      assertStringIncludes(result, 'Files: 5');
      assertStringIncludes(result, 'URL: https://my-app.takos.dev');

      assertSpyCallArgs(deployFrontendFromWorkspace, 0, [
        expect.anything(),
        ({
          spaceId: 'ws-test',
          appName: 'my-app',
          distPath: 'dist',
          clear: false,
          description: null,
          icon: null,
        }),
      ]);
})
    Deno.test('deploy tools - deployFrontendHandler - uses caller spaceId even if not in args', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  deployFrontendFromWorkspace = (async () => ({
        appName: 'app',
        uploaded: 1,
        url: 'https://app.takos.dev',
      })) as any;

      await deployFrontendHandler(
        { app_name: 'app' },
        makeContext({ spaceId: 'enforced-space' }),
      );

      assertSpyCallArgs(deployFrontendFromWorkspace, 0, [
        expect.anything(),
        ({ spaceId: 'enforced-space' }),
      ]);
})
    Deno.test('deploy tools - deployFrontendHandler - passes custom dist_path, clear, description, icon', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  deployFrontendFromWorkspace = (async () => ({
        appName: 'app',
        uploaded: 10,
        url: 'https://app.takos.dev',
      })) as any;

      await deployFrontendHandler(
        {
          app_name: 'app',
          dist_path: 'build/out',
          clear: true,
          description: 'My desc',
          icon: '🚀',
        },
        makeContext(),
      );

      assertSpyCallArgs(deployFrontendFromWorkspace, 0, [
        expect.anything(),
        ({
          distPath: 'build/out',
          clear: true,
          description: 'My desc',
          icon: '🚀',
        }),
      ]);
})
    Deno.test('deploy tools - deployFrontendHandler - trims app_name whitespace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  deployFrontendFromWorkspace = (async () => ({
        appName: 'trimmed',
        uploaded: 1,
        url: 'https://trimmed.takos.dev',
      })) as any;

      await deployFrontendHandler(
        { app_name: '  trimmed  ' },
        makeContext(),
      );

      assertSpyCallArgs(deployFrontendFromWorkspace, 0, [
        expect.anything(),
        ({ appName: 'trimmed' }),
      ]);
})  