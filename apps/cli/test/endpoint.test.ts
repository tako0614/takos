import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { CliCommandExit } from '../src/lib/command-exit.js';

const endpointMocks = vi.hoisted(() => {
  const saveApiUrlMock = vi.fn();
  const getConfigMock = vi.fn(() => ({ apiUrl: 'https://takos.jp' }));
  const isContainerModeMock = vi.fn(() => false);

  return {
    saveApiUrlMock,
    getConfigMock,
    isContainerModeMock,
  };
});

vi.mock('../src/lib/config.js', () => ({
  saveApiUrl: endpointMocks.saveApiUrlMock,
  getConfig: endpointMocks.getConfigMock,
  isContainerMode: endpointMocks.isContainerModeMock,
}));

import { registerEndpointCommand, resolveEndpointTarget } from '../src/commands/endpoint.js';

describe('resolveEndpointTarget', () => {
  it('maps preset names to canonical URLs', () => {
    expect(resolveEndpointTarget('prod')).toBe('https://takos.jp');
    expect(resolveEndpointTarget('production')).toBe('https://takos.jp');
    expect(resolveEndpointTarget('test')).toBe('https://test.takos.jp');
    expect(resolveEndpointTarget('staging')).toBe('https://test.takos.jp');
  });

  it('uses explicit URL as-is', () => {
    expect(resolveEndpointTarget('https://api.takos.dev')).toBe('https://api.takos.dev');
  });
});

describe('endpoint command', () => {
  beforeEach(() => {
    endpointMocks.saveApiUrlMock.mockReset();
    endpointMocks.getConfigMock.mockReset();
    endpointMocks.getConfigMock.mockReturnValue({ apiUrl: 'https://takos.jp' });
    endpointMocks.isContainerModeMock.mockReset();
    endpointMocks.isContainerModeMock.mockReturnValue(false);
  });

  it('updates endpoint to test preset', async () => {
    const program = new Command();
    registerEndpointCommand(program);

    await program.parseAsync(['node', 'takos', 'endpoint', 'use', 'test']);

    expect(endpointMocks.saveApiUrlMock).toHaveBeenCalledWith('https://test.takos.jp');
  });

  it('updates endpoint to prod preset', async () => {
    const program = new Command();
    registerEndpointCommand(program);

    await program.parseAsync(['node', 'takos', 'endpoint', 'use', 'prod']);

    expect(endpointMocks.saveApiUrlMock).toHaveBeenCalledWith('https://takos.jp');
  });

  it('shows current endpoint', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    endpointMocks.getConfigMock.mockReturnValue({ apiUrl: 'https://test.takos.jp' });

    const program = new Command();
    registerEndpointCommand(program);

    await program.parseAsync(['node', 'takos', 'endpoint', 'show']);

    expect(logSpy).toHaveBeenCalledWith('https://test.takos.jp');
    logSpy.mockRestore();
  });

  it('fails when running in container mode', async () => {
    endpointMocks.isContainerModeMock.mockReturnValue(true);
    const program = new Command();
    registerEndpointCommand(program);

    await expect(program.parseAsync(['node', 'takos', 'endpoint', 'use', 'test']))
      .rejects
      .toBeInstanceOf(CliCommandExit);
    expect(endpointMocks.saveApiUrlMock).not.toHaveBeenCalled();
  });
});
