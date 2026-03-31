import { Command } from 'commander';
import { CliCommandExit } from '../src/lib/command-exit.ts';
import { registerDeployCommand } from '../src/commands/deploy.ts';

import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { stub } from 'jsr:@std/testing/mock';

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerDeployCommand(program);
  return program;
}

function hasRemovedMessage(logSpy: ReturnType<typeof stub<typeof console, 'log'>>): boolean {
  return logSpy.calls.some(({ args }) => {
    const text = String(args[0] ?? '');
    return /removed|not available|takos apply/i.test(text);
  });
}

Deno.test('deploy command - exits with a removed message', async () => {
  const program = createProgram();
  const logSpy = stub(console, 'log', () => {});

  try {
    await assertRejects(
      async () => {
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
      },
      CliCommandExit,
    );

    assertEquals(hasRemovedMessage(logSpy), true);
  } finally {
    logSpy.restore();
  }
});

Deno.test('deploy status command - exits with a removed message', async () => {
  const program = createProgram();
  const logSpy = stub(console, 'log', () => {});

  try {
    await assertRejects(
      async () => {
        await program.parseAsync([
          'node',
          'takos',
          'deploy',
          'status',
          '--repo',
          'repo-1',
          'appdep-1',
        ], { from: 'node' });
      },
      CliCommandExit,
    );

    assertEquals(hasRemovedMessage(logSpy), true);
  } finally {
    logSpy.restore();
  }
});

Deno.test('deploy rollback command - exits with a removed message', async () => {
  const program = createProgram();
  const logSpy = stub(console, 'log', () => {});

  try {
    await assertRejects(
      async () => {
        await program.parseAsync([
          'node',
          'takos',
          'deploy',
          'rollback',
          '--repo',
          'repo-1',
          'appdep-1',
        ], { from: 'node' });
      },
      CliCommandExit,
    );

    assertEquals(hasRemovedMessage(logSpy), true);
  } finally {
    logSpy.restore();
  }
});
