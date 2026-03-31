import { Command } from 'commander';
import { CliCommandExit } from '../src/lib/command-exit.ts';

import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { stub, assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const endpointMocks = {
  const saveApiUrlMock = ((..._args: any[]) => undefined) as any;
  const getConfigMock = () => ({ apiUrl: 'https://takos.jp' });
  const isContainerModeMock = () => false;

  return {
    saveApiUrlMock,
    getConfigMock,
    isContainerModeMock,
  };
};

// [Deno] vi.mock removed - manually stub imports from '../src/lib/config.ts'
import { registerEndpointCommand, resolveEndpointTarget } from '../src/commands/endpoint.ts';


  Deno.test('resolveEndpointTarget - maps preset names to canonical URLs', () => {
  assertEquals(resolveEndpointTarget('prod'), 'https://takos.jp');
    assertEquals(resolveEndpointTarget('production'), 'https://takos.jp');
    assertEquals(resolveEndpointTarget('test'), 'https://test.takos.jp');
    assertEquals(resolveEndpointTarget('staging'), 'https://test.takos.jp');
})
  Deno.test('resolveEndpointTarget - uses explicit URL as-is', () => {
  assertEquals(resolveEndpointTarget('https://api.takos.dev'), 'https://api.takos.dev');
})

  Deno.test('endpoint command - updates endpoint to test preset', async () => {
  endpointMocks.saveApiUrlMock;
    endpointMocks.getConfigMock;
    endpointMocks.getConfigMock = (() => ({ apiUrl: 'https://takos.jp' })) as any;
    endpointMocks.isContainerModeMock;
    endpointMocks.isContainerModeMock = (() => false) as any;
  const program = new Command();
    registerEndpointCommand(program);

    await program.parseAsync(['node', 'takos', 'endpoint', 'use', 'test']);

    assertSpyCallArgs(endpointMocks.saveApiUrlMock, 0, ['https://test.takos.jp']);
})
  Deno.test('endpoint command - updates endpoint to prod preset', async () => {
  endpointMocks.saveApiUrlMock;
    endpointMocks.getConfigMock;
    endpointMocks.getConfigMock = (() => ({ apiUrl: 'https://takos.jp' })) as any;
    endpointMocks.isContainerModeMock;
    endpointMocks.isContainerModeMock = (() => false) as any;
  const program = new Command();
    registerEndpointCommand(program);

    await program.parseAsync(['node', 'takos', 'endpoint', 'use', 'prod']);

    assertSpyCallArgs(endpointMocks.saveApiUrlMock, 0, ['https://takos.jp']);
})
  Deno.test('endpoint command - shows current endpoint', async () => {
  endpointMocks.saveApiUrlMock;
    endpointMocks.getConfigMock;
    endpointMocks.getConfigMock = (() => ({ apiUrl: 'https://takos.jp' })) as any;
    endpointMocks.isContainerModeMock;
    endpointMocks.isContainerModeMock = (() => false) as any;
  const logSpy = stub(console, 'log') = () => {} as any;
    endpointMocks.getConfigMock = (() => ({ apiUrl: 'https://test.takos.jp' })) as any;

    const program = new Command();
    registerEndpointCommand(program);

    await program.parseAsync(['node', 'takos', 'endpoint', 'show']);

    assertSpyCallArgs(logSpy, 0, ['https://test.takos.jp']);
    logSpy.restore();
})
  Deno.test('endpoint command - fails when running in container mode', async () => {
  endpointMocks.saveApiUrlMock;
    endpointMocks.getConfigMock;
    endpointMocks.getConfigMock = (() => ({ apiUrl: 'https://takos.jp' })) as any;
    endpointMocks.isContainerModeMock;
    endpointMocks.isContainerModeMock = (() => false) as any;
  endpointMocks.isContainerModeMock = (() => true) as any;
    const program = new Command();
    registerEndpointCommand(program);

    await await assertRejects(async () => { await program.parseAsync(['node', 'takos', 'endpoint', 'use', 'test']); }, CliCommandExit);
    assertSpyCalls(endpointMocks.saveApiUrlMock, 0);
})