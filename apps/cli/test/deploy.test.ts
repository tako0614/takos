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

  function hasRemovedMessage(logSpy: { mock: { calls: Array<Array<unknown>> } }) {
    return logSpy.mock.calls.some(([message]) => {
      const text = String(message);
      return /deprecated|removed|not available|not supported/i.test(text);
    });
  }

  it('fails deploy with an explicit removed error', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(program.parseAsync([
      'node',
      'takos',
      'deploy',
      '--repo',
      'repo-1',
      '--ref',
      'main',
      '--ref-type',
      'branch',
    ], { from: 'node' })).rejects.toThrow(/cliExit:1/);

    expect(hasRemovedMessage(logSpy)).toBe(true);
    expect(mocks.validateAppManifest).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('fails deploy status with an explicit removed error', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(program.parseAsync([
      'node',
      'takos',
      'deploy',
      'status',
      '--repo',
      'repo-1',
      'appdep-1',
    ], { from: 'node' })).rejects.toThrow(/cliExit:1/);

    expect(hasRemovedMessage(logSpy)).toBe(true);
    expect(mocks.api).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('fails deploy rollback with an explicit removed error', async () => {
    const program = createProgram();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(program.parseAsync([
      'node',
      'takos',
      'deploy',
      'rollback',
      '--repo',
      'repo-1',
      'appdep-1',
    ], { from: 'node' })).rejects.toThrow(/cliExit:1/);

    expect(hasRemovedMessage(logSpy)).toBe(true);
    expect(mocks.api).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
