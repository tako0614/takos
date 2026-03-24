import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  getConfig: vi.fn(),
  validateAppManifest: vi.fn(),
  cliExit: vi.fn((code?: number) => {
    throw new Error(`cliExit:${code ?? 0}`);
  }),
  execFile: vi.fn(),
}));

vi.mock('../src/lib/api.js', () => ({
  api: mocks.api,
}));

vi.mock('../src/lib/config.js', () => ({
  getConfig: mocks.getConfig,
}));

vi.mock('../src/lib/app-manifest.js', () => ({
  validateAppManifest: mocks.validateAppManifest,
}));

vi.mock('../src/lib/command-exit.js', () => ({
  cliExit: mocks.cliExit,
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
}));

import { registerDeployCommand } from '../src/commands/deploy.js';

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerDeployCommand(program);
  return program;
}

describe('deploy command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockReturnValue({ spaceId: 'space-1' });
    mocks.validateAppManifest.mockResolvedValue({
      manifestPath: '/repo/.takos/app.yml',
      manifest: {
        metadata: { name: 'sample-app' },
        spec: { version: '1.0.0', services: {} },
      },
    });
    mocks.api.mockResolvedValue({
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
    });
  });

  it('posts repo/ref JSON to app deployments API', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'takos',
      'deploy',
      '--repo',
      'repo-1',
      '--ref',
      'main',
      '--ref-type',
      'branch',
    ], { from: 'node' });

    expect(mocks.api).toHaveBeenCalledWith('/api/spaces/space-1/app-deployments', expect.objectContaining({
      method: 'POST',
      body: {
        repo_id: 'repo-1',
        ref: 'main',
        ref_type: 'branch',
        approve_oauth_auto_env: false,
        approve_source_change: false,
      },
      timeout: 120_000,
    }));

    logSpy.mockRestore();
  });

  it('falls back to the current branch when --ref is omitted', async () => {
    mocks.execFile.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (err: unknown, stdout?: string) => void) => {
      cb(null, 'feature/current\n');
    });

    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync([
      'node',
      'takos',
      'deploy',
      '--repo',
      'repo-1',
    ], { from: 'node' });

    expect(mocks.api).toHaveBeenCalledWith('/api/spaces/space-1/app-deployments', expect.objectContaining({
      body: expect.objectContaining({
        repo_id: 'repo-1',
        ref: 'feature/current',
      }),
    }));

    logSpy.mockRestore();
  });

  it('requires --repo', async () => {
    const program = createProgram();

    await expect(program.parseAsync([
      'node',
      'takos',
      'deploy',
      '--ref',
      'main',
    ], { from: 'node' })).rejects.toThrow(/required option '--repo <id>' not specified/);
  });
});
