import { Command } from 'commander';

import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { stub, assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  api: ((..._args: any[]) => undefined) as any,
  getConfig: ((..._args: any[]) => undefined) as any,
  validateAppManifest: ((..._args: any[]) => undefined) as any,
  cliExit: (code?: number) => {
    throw new Error(`cliExit:${code ?? 0}`);
  },
  execFile: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '../src/lib/api.ts'
// [Deno] vi.mock removed - manually stub imports from '../src/lib/config.ts'
// [Deno] vi.mock removed - manually stub imports from '../src/lib/app-manifest.ts'
// [Deno] vi.mock removed - manually stub imports from '../src/lib/command-exit.ts'
// [Deno] vi.mock removed - manually stub imports from 'node:child_process'
import { registerDeployCommand } from '../src/commands/deploy.ts';

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerDeployCommand(program);
  return program;
}


  function hasRemovedMessage(logSpy: { mock: { calls: Array<Array<unknown>> } }) {
    return logSpy.calls.some(([message]) => {
      const text = String(message);
      return /deprecated|removed|not available|not supported/i.test(text);
    });
  }

  Deno.test('deploy command - fails deploy with an explicit removed error', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getConfig = (() => ({ spaceId: 'space-1' })) as any;
    mocks.validateAppManifest = (async () => ({
      manifestPath: '/repo/.takos/app.yml',
      manifest: {
        metadata: { name: 'sample-app' },
        spec: { version: '1.0.0', services: {} },
      },
    })) as any;
    mocks.api = (async () => ({
      ok: true,
      data: {
        success: true,
        data: {
          app_deployment_id: 'appdep-1',
          app_id: 'app-1',
          name: 'Sample App',
          version: '1.0.0',
          source: { commit_sha: 'sha-1' },
        },
      },
    })) as any;
  const program = createProgram();
    const logSpy = stub(console, 'log') = () => {} as any;

    await await assertRejects(async () => { await program.parseAsync([
      'node',
      'takos',
      'deploy',
      '--repo',
      'repo-1',
      '--ref',
      'main',
      '--ref-type',
      'branch',
    ], { from: 'node' }); }, /cliExit:1/);

    assertEquals(hasRemovedMessage(logSpy), true);
    assertSpyCalls(mocks.validateAppManifest, 0);
    assertSpyCalls(mocks.api, 0);
    logSpy.restore();
})
  Deno.test('deploy command - fails deploy status with an explicit removed error', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getConfig = (() => ({ spaceId: 'space-1' })) as any;
    mocks.validateAppManifest = (async () => ({
      manifestPath: '/repo/.takos/app.yml',
      manifest: {
        metadata: { name: 'sample-app' },
        spec: { version: '1.0.0', services: {} },
      },
    })) as any;
    mocks.api = (async () => ({
      ok: true,
      data: {
        success: true,
        data: {
          app_deployment_id: 'appdep-1',
          app_id: 'app-1',
          name: 'Sample App',
          version: '1.0.0',
          source: { commit_sha: 'sha-1' },
        },
      },
    })) as any;
  const program = createProgram();
    const logSpy = stub(console, 'log') = () => {} as any;

    await await assertRejects(async () => { await program.parseAsync([
      'node',
      'takos',
      'deploy',
      'status',
      '--repo',
      'repo-1',
      'appdep-1',
    ], { from: 'node' }); }, /cliExit:1/);

    assertEquals(hasRemovedMessage(logSpy), true);
    assertSpyCalls(mocks.api, 0);
    logSpy.restore();
})
  Deno.test('deploy command - fails deploy rollback with an explicit removed error', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getConfig = (() => ({ spaceId: 'space-1' })) as any;
    mocks.validateAppManifest = (async () => ({
      manifestPath: '/repo/.takos/app.yml',
      manifest: {
        metadata: { name: 'sample-app' },
        spec: { version: '1.0.0', services: {} },
      },
    })) as any;
    mocks.api = (async () => ({
      ok: true,
      data: {
        success: true,
        data: {
          app_deployment_id: 'appdep-1',
          app_id: 'app-1',
          name: 'Sample App',
          version: '1.0.0',
          source: { commit_sha: 'sha-1' },
        },
      },
    })) as any;
  const program = createProgram();
    const logSpy = stub(console, 'log') = () => {} as any;

    await await assertRejects(async () => { await program.parseAsync([
      'node',
      'takos',
      'deploy',
      'rollback',
      '--repo',
      'repo-1',
      'appdep-1',
    ], { from: 'node' }); }, /cliExit:1/);

    assertEquals(hasRemovedMessage(logSpy), true);
    assertSpyCalls(mocks.api, 0);
    logSpy.restore();
})