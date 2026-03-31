import { Command } from 'commander';

import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  api: ((..._args: any[]) => undefined) as any,
  cliExit: ((..._args: any[]) => undefined) as any,
  loadAppManifest: ((..._args: any[]) => undefined) as any,
  resolveAppManifestPath: ((..._args: any[]) => undefined) as any,
  resolveSpaceId: ((..._args: any[]) => undefined) as any,
  resolveAccountId: ((..._args: any[]) => undefined) as any,
  resolveApiToken: ((..._args: any[]) => undefined) as any,
  confirmPrompt: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '../src/lib/api.ts'
// [Deno] vi.mock removed - manually stub imports from '../src/lib/command-exit.ts'
// [Deno] vi.mock removed - manually stub imports from '../src/lib/app-manifest.ts'
// [Deno] vi.mock removed - manually stub imports from '../src/lib/cli-utils.ts'
import { registerApplyCommand } from '../src/commands/apply.ts';
import { registerPlanCommand } from '../src/commands/plan.ts';

function createProgram(): Command {
  const program = new Command();
  registerPlanCommand(program);
  registerApplyCommand(program);
  program.exitOverride();
  return program;
}

const manifest = {
  metadata: { name: 'sample-app' },
  spec: {},
};

const translationReport = {
  provider: 'cloudflare',
  supported: true,
  requirements: [],
  resources: [],
  workloads: [],
  routes: [],
  unsupported: [],
};

const noChangeDiff = {
  hasChanges: false,
  entries: [],
  summary: {
    create: 0,
    update: 0,
    delete: 0,
    unchanged: 0,
  },
};

const applyData = {
  id: 'g-1',
  groupId: 'g-1',
  applied: [],
  skipped: [],
  diff: noChangeDiff,
  translationReport,
};


  Deno.test('plan/apply provider option - passes provider in plan API payload', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.resolveAppManifestPath = (async () => '/repo/.takos/app.yml') as any;
    mocks.loadAppManifest = (async () => manifest) as any;
    mocks.resolveSpaceId = (() => 'space-1') as any;
    mocks.resolveAccountId = (() => 'account-id') as any;
    mocks.resolveApiToken = (() => 'api-token') as any;
    mocks.confirmPrompt = (async () => true) as any;
    mocks.cliExit = (code: number) => {
      throw new Error(`cliExit:${code}`);
    } as any;
  mocks.api = (async () => ({
      ok: true,
      data: {
        group: { id: 'group-1', name: 'sample-app' },
        diff: noChangeDiff,
        translationReport,
      },
    })) as any;

    const program = createProgram();
    await program.parseAsync([
      'node',
      'takos',
      'plan',
      '--provider',
      'aws',
      '--env',
      'production',
    ]);

    assertSpyCalls(mocks.api, 1);
    assertSpyCallArgs(mocks.api, 0, [
      '/api/spaces/space-1/groups/plan',
      ({
        method: 'POST',
        body: {
          group_name: 'sample-app',
          env: 'production',
          provider: 'aws',
          manifest,
        },
      }),
    ]);
})
  Deno.test('plan/apply provider option - passes provider in both plan and apply API payloads', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.resolveAppManifestPath = (async () => '/repo/.takos/app.yml') as any;
    mocks.loadAppManifest = (async () => manifest) as any;
    mocks.resolveSpaceId = (() => 'space-1') as any;
    mocks.resolveAccountId = (() => 'account-id') as any;
    mocks.resolveApiToken = (() => 'api-token') as any;
    mocks.confirmPrompt = (async () => true) as any;
    mocks.cliExit = (code: number) => {
      throw new Error(`cliExit:${code}`);
    } as any;
  mocks.api
       = (async () => ({
        ok: true,
        data: {
          group: { id: 'group-1', name: 'sample-app' },
          diff: {
            ...noChangeDiff,
            hasChanges: true,
            entries: [{ name: 'x', category: 'resource', action: 'create' }],
          },
          translationReport,
        },
      })) as any
       = (async () => ({
        ok: true,
        data: {
          ...applyData,
          group: { id: 'group-1', name: 'sample-app' },
          applied: [{ name: 'x', category: 'resource', action: 'create', status: 'success' }],
          diff: {
            ...noChangeDiff,
            hasChanges: true,
            entries: [{ name: 'x', category: 'resource', action: 'create' }],
          },
        },
      })) as any;

    const program = createProgram();
    await program.parseAsync([
      'node',
      'takos',
      'apply',
      '--provider',
      'gcp',
      '--auto-approve',
      '--env',
      'staging',
    ]);

    assertSpyCalls(mocks.api, 2);
    assertSpyCallArgs(mocks.api, 0, ['/api/spaces/space-1/groups/plan', ({
      method: 'POST',
      body: ({
        group_name: 'sample-app',
        env: 'staging',
        provider: 'gcp',
        manifest,
      }),
    })]);
    assertSpyCallArgs(mocks.api, 1, ['/api/spaces/space-1/groups/apply', ({
      method: 'POST',
      body: ({
        group_name: 'sample-app',
        env: 'staging',
        provider: 'gcp',
        manifest,
      }),
    })]);
})