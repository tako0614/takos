import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createBaseContext } from '../../context.js';
import type { Step } from '../../types.js';
import { StepRunner } from '../../scheduler/step.js';

async function withProcessPlatform<T>(
  platform: NodeJS.Platform,
  run: () => Promise<T>
): Promise<T> {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!platformDescriptor) {
    throw new Error('Unable to read process.platform descriptor');
  }

  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await run();
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor);
  }
}

describe('step output parsing', () => {
  it('parses legacy and simple outputs while ignoring malformed lines', async () => {
    const stdout = [
      '::set-output name=legacy::from-legacy',
      '::set-output name=legacy_empty::',
      'simple_output=from-simple',
      'legacy=from-simple-duplicate',
      'not-valid=value',
      'empty=',
    ].join('\n');

    const runner = new StepRunner({
      shellExecutor: async () => ({
        exitCode: 0,
        stdout,
        stderr: '',
      }),
    });

    const step: Step = { id: 'parse-outputs', run: 'echo output' };
    const result = await runner.runStep(step, createBaseContext());

    expect(result.outputs).toEqual({
      legacy: 'from-legacy',
      legacy_empty: '',
      simple_output: 'from-simple',
      empty: '',
    });
  });

  it('handles long legacy output lines', async () => {
    const longName = 'A'.repeat(20_000);
    const stdout = `::set-output name=${longName}::value`;

    const runner = new StepRunner({
      shellExecutor: async () => ({
        exitCode: 0,
        stdout,
        stderr: '',
      }),
    });

    const step: Step = { id: 'long-outputs', run: 'echo output' };
    const result = await runner.runStep(step, createBaseContext());

    expect(result.outputs[longName]).toBe('value');
  });

  it('reads command-file outputs and supports empty initial GitHub vars', async () => {
    const capturedEnv: Array<Record<string, string> | undefined> = [];
    const runner = new StepRunner({
      shellExecutor: async (_command, options) => {
        capturedEnv.push(options.env);
        const outputFile = options.env?.GITHUB_OUTPUT;
        expect(outputFile).toBeTruthy();
        appendFileSync(outputFile!, 'from_file=hello\n');
        appendFileSync(outputFile!, 'multi<<EOF\nline1\nline2\nEOF\n');
        return {
          exitCode: 0,
          stdout: 'from_stdout=ok',
          stderr: '',
        };
      },
    });

    const context = createBaseContext({ env: {} });
    const step: Step = { id: 'command-file-outputs', run: 'echo output' };
    const result = await runner.runStep(step, context);

    expect(result.outputs).toEqual({
      from_stdout: 'ok',
      from_file: 'hello',
      multi: 'line1\nline2',
    });

    const firstEnv = capturedEnv[0];
    expect(firstEnv?.GITHUB_ENV).toBeTruthy();
    expect(firstEnv?.GITHUB_OUTPUT).toBeTruthy();
    expect(firstEnv?.GITHUB_PATH).toBeTruthy();
  });

  it('parses command-file heredoc outputs written with CRLF line endings', async () => {
    const runner = new StepRunner({
      shellExecutor: async (_command, options) => {
        const outputFile = options.env?.GITHUB_OUTPUT;
        expect(outputFile).toBeTruthy();
        appendFileSync(outputFile!, 'multi<<EOF\r\nline1\r\nline2\r\nEOF\r\n');
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
        };
      },
    });

    const context = createBaseContext({ env: {} });
    const step: Step = { id: 'command-file-outputs-crlf', run: 'echo output' };
    const result = await runner.runStep(step, context);

    expect(result.outputs).toEqual({
      multi: 'line1\nline2',
    });
    expect(result.outputs.multi.includes('\r')).toBe(false);
  });
});

describe('step default executors', () => {
  it('uses pwsh by default on win32', async () => {
    let observedShell: Step['shell'] | undefined;

    await withProcessPlatform('win32', async () => {
      const runner = new StepRunner({
        shellExecutor: async (_command, options) => {
          observedShell = options.shell;
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      });

      await runner.runStep({ id: 'win32-default-shell', run: 'echo ok' }, createBaseContext());
    });

    expect(observedShell).toBe('pwsh');
  });

  it('uses bash by default on non-win32 platforms', async () => {
    let observedShell: Step['shell'] | undefined;

    await withProcessPlatform('linux', async () => {
      const runner = new StepRunner({
        shellExecutor: async (_command, options) => {
          observedShell = options.shell;
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      });

      await runner.runStep({ id: 'non-win32-default-shell', run: 'echo ok' }, createBaseContext());
    });

    expect(observedShell).toBe('bash');
  });

  it('prioritizes explicit shell configuration over platform defaults', async () => {
    const observedShells: Array<Step['shell'] | undefined> = [];

    await withProcessPlatform('win32', async () => {
      const runner = new StepRunner({
        defaultShell: 'bash',
        shellExecutor: async (_command, options) => {
          observedShells.push(options.shell);
          return { exitCode: 0, stdout: '', stderr: '' };
        },
      });

      await runner.runStep({ id: 'configured-default-shell', run: 'echo ok' }, createBaseContext());
      await runner.runStep(
        { id: 'step-explicit-shell', run: 'echo ok', shell: 'cmd' },
        createBaseContext()
      );
    });

    expect(observedShells).toEqual(['bash', 'cmd']);
  });

  it('respects working directory and env for default shell executor', async () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), 'actions-engine-step-'));

    try {
      const runner = new StepRunner({
        workingDirectory,
        defaultShell: 'bash',
      });

      const step: Step = {
        id: 'default-shell',
        run: 'echo "cwd=$PWD"; echo "from_env=$TAKOS_TEST_ENV"',
        env: {
          TAKOS_TEST_ENV: 'from-step',
        },
      };

      const result = await runner.runStep(step, createBaseContext());

      expect(result.conclusion).toBe('success');
      expect(result.outputs.cwd).toBe(workingDirectory);
      expect(result.outputs.from_env).toBe('from-step');
    } finally {
      rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it('returns failure when default shell executor times out', async () => {
    const runner = new StepRunner();
    const step: Step = {
      id: 'timeout-shell',
      run: 'node -e "setTimeout(() => {}, 5000)"',
      'timeout-minutes': 0.001,
    };

    const result = await runner.runStep(step, createBaseContext());

    expect(result.conclusion).toBe('failure');
    expect(result.error).toContain('Exit code: 124');
  });

  it('supports builtin checkout action without a custom resolver', async () => {
    const runner = new StepRunner();
    const context = createBaseContext();
    const step: Step = {
      id: 'builtin-checkout',
      uses: 'actions/checkout@v4',
    };

    const result = await runner.runStep(step, context);

    expect(result.conclusion).toBe('success');
    expect(result.outputs.path).toBe(context.github.workspace);
  });

  it('fails explicitly for unsupported default actions', async () => {
    const runner = new StepRunner();
    const step: Step = {
      id: 'unsupported-action',
      uses: 'actions/cache@v4',
    };

    const result = await runner.runStep(step, createBaseContext());

    expect(result.conclusion).toBe('failure');
    expect(result.error).toContain('Unsupported action: actions/cache@v4');
  });
});
