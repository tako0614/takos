import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  cliExit: vi.fn(),
  loadAppManifest: vi.fn(),
  resolveAppManifestPath: vi.fn(),
  resolveSpaceId: vi.fn(),
  resolveAccountId: vi.fn(),
  resolveApiToken: vi.fn(),
  confirmPrompt: vi.fn(),
}));

vi.mock('../src/lib/api.js', () => ({
  api: mocks.api,
}));

vi.mock('../src/lib/command-exit.js', () => ({
  cliExit: mocks.cliExit,
}));

vi.mock('../src/lib/app-manifest.js', () => ({
  loadAppManifest: mocks.loadAppManifest,
  resolveAppManifestPath: mocks.resolveAppManifestPath,
}));

vi.mock('../src/lib/cli-utils.js', () => ({
  resolveSpaceId: mocks.resolveSpaceId,
  resolveAccountId: mocks.resolveAccountId,
  resolveApiToken: mocks.resolveApiToken,
  confirmPrompt: mocks.confirmPrompt,
}));

import { registerApplyCommand } from '../src/commands/apply.js';
import { registerPlanCommand } from '../src/commands/plan.js';

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

describe('plan/apply provider option', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAppManifestPath.mockResolvedValue('/repo/.takos/app.yml');
    mocks.loadAppManifest.mockResolvedValue(manifest);
    mocks.resolveSpaceId.mockReturnValue('space-1');
    mocks.resolveAccountId.mockReturnValue('account-id');
    mocks.resolveApiToken.mockReturnValue('api-token');
    mocks.confirmPrompt.mockResolvedValue(true);
    mocks.cliExit.mockImplementation((code: number) => {
      throw new Error(`cliExit:${code}`);
    });
  });

  it('passes provider in plan API payload', async () => {
    mocks.api.mockResolvedValue({
      ok: true,
      data: {
        group: { id: 'group-1', name: 'sample-app' },
        diff: noChangeDiff,
        translationReport,
      },
    });

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

    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(mocks.api).toHaveBeenCalledWith(
      '/api/spaces/space-1/groups/plan',
      expect.objectContaining({
        method: 'POST',
        body: {
          group_name: 'sample-app',
          env: 'production',
          provider: 'aws',
          manifest,
        },
      }),
    );
  });

  it('passes provider in both plan and apply API payloads', async () => {
    mocks.api
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
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
      });

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

    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.api).toHaveBeenNthCalledWith(1, '/api/spaces/space-1/groups/plan', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        group_name: 'sample-app',
        env: 'staging',
        provider: 'gcp',
        manifest,
      }),
    }));
    expect(mocks.api).toHaveBeenNthCalledWith(2, '/api/spaces/space-1/groups/apply', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        group_name: 'sample-app',
        env: 'staging',
        provider: 'gcp',
        manifest,
      }),
    }));
  });
});
