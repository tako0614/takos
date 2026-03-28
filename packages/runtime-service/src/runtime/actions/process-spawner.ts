import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { pushLog } from '../logging.js';
import { SANDBOX_LIMITS } from '../../shared/config.js';
import { getErrorMessage } from '@takos/common/errors';

function gracefulKill(child: ChildProcess): NodeJS.Timeout {
  child.kill('SIGTERM');
  return setTimeout(() => {
    const stillRunning = child.exitCode === null && child.signalCode === null;
    if (stillRunning) {
      child.kill('SIGKILL');
    }
  }, 5000);
}
import type { ExecutorStepResult } from './executor.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandFiles {
  output: string;
  env: string;
  path: string;
  summary: string;
}

interface PreparedCommandFiles {
  envVars: Record<string, string>;
  files: CommandFiles;
}

interface SpawnOptions {
  timeout: number;
  cwd: string;
  shell?: boolean;
}

interface SpawnContext {
  env: Record<string, string>;
  logs: string[];
  outputs: Record<string, string>;
  workspacePath: string;
  parseWorkflowCommands: (text: string) => void;
  parseKeyValueFile: (content: string) => Record<string, string>;
  parsePathFile: (content: string) => string[];
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

export function failureResult(
  stderr: string,
  outputs: Record<string, string> = {},
  exitCode: number = 1
): ExecutorStepResult {
  return { exitCode, stdout: '', stderr, outputs, conclusion: 'failure' };
}

export function successResult(stdout: string, outputs: Record<string, string>): ExecutorStepResult {
  return { exitCode: 0, stdout, stderr: '', outputs, conclusion: 'success' };
}

// ---------------------------------------------------------------------------
// Command file management
// ---------------------------------------------------------------------------

export async function prepareCommandFiles(workspacePath: string): Promise<PreparedCommandFiles> {
  const commandDir = path.join(workspacePath, '.runner', 'commands');
  await fs.mkdir(commandDir, { recursive: true });

  const id = randomUUID();
  const files: CommandFiles = {
    output: path.join(commandDir, `output-${id}.txt`),
    env: path.join(commandDir, `env-${id}.txt`),
    path: path.join(commandDir, `path-${id}.txt`),
    summary: path.join(commandDir, `summary-${id}.md`),
  };

  await Promise.all(Object.values(files).map(f => fs.writeFile(f, '')));

  return {
    envVars: {
      GITHUB_OUTPUT: files.output,
      GITHUB_ENV: files.env,
      GITHUB_PATH: files.path,
      GITHUB_STEP_SUMMARY: files.summary,
    },
    files,
  };
}

export async function applyCommandFiles(
  prepared: PreparedCommandFiles,
  ctx: SpawnContext
): Promise<void> {
  const readFile = (filePath: string): Promise<string> =>
    fs.readFile(filePath, 'utf-8').catch(() => '');

  const [outputContent, envContent, pathContent] = await Promise.all([
    readFile(prepared.files.output),
    readFile(prepared.files.env),
    readFile(prepared.files.path),
  ]);

  if (outputContent) Object.assign(ctx.outputs, ctx.parseKeyValueFile(outputContent));
  if (envContent) Object.assign(ctx.env, ctx.parseKeyValueFile(envContent));
  if (pathContent) {
    for (const entry of ctx.parsePathFile(pathContent)) {
      ctx.env.PATH = entry + path.delimiter + (ctx.env.PATH || '');
    }
  }
}

export async function cleanupCommandFiles(prepared: PreparedCommandFiles): Promise<void> {
  await Promise.all(
    Object.values(prepared.files).map(f => fs.rm(f, { force: true }))
  );
}

// ---------------------------------------------------------------------------
// Runtime env construction
// ---------------------------------------------------------------------------

export function createRuntimeEnv(
  env: Record<string, string>,
  workspacePath: string,
  commandFileEnv: Record<string, string>
): Record<string, string> {
  const runnerBase = path.join(workspacePath, '.runner');
  const runtimeEnv: Record<string, string> = {
    ...env,
    ...commandFileEnv,
    RUNNER_TEMP: path.join(runnerBase, 'temp'),
    RUNNER_TOOL_CACHE: path.join(runnerBase, 'tool-cache'),
  };

  for (const key of ['PATH', 'HOME'] as const) {
    if (!runtimeEnv[key] && process.env[key]) {
      runtimeEnv[key] = process.env[key]!;
    }
  }

  const existingNodeOpts = runtimeEnv.NODE_OPTIONS || '';
  if (!existingNodeOpts.includes('--max-old-space-size')) {
    runtimeEnv.NODE_OPTIONS = `${existingNodeOpts} --max-old-space-size=2048`.trim();
  }

  return runtimeEnv;
}

// ---------------------------------------------------------------------------
// Process spawning
// ---------------------------------------------------------------------------

function handleStdoutData(
  data: Buffer,
  state: { stdout: string },
  child: ChildProcess,
  ctx: SpawnContext
): void {
  const text = data.toString('utf-8');
  state.stdout += text;
  if (state.stdout.length > SANDBOX_LIMITS.maxOutputSize) {
    pushLog(ctx.logs, '[WARNING] Output size limit exceeded, truncating...');
    state.stdout = state.stdout.slice(0, SANDBOX_LIMITS.maxOutputSize);
    child.kill('SIGTERM');
  }
  ctx.parseWorkflowCommands(text);
}

function handleStderrData(
  data: Buffer,
  state: { stderr: string }
): void {
  const text = data.toString('utf-8');
  state.stderr += text;
  if (state.stderr.length > SANDBOX_LIMITS.maxOutputSize) {
    state.stderr = state.stderr.slice(0, SANDBOX_LIMITS.maxOutputSize);
  }
}

export async function spawnWithTimeout(
  command: string,
  args: string[],
  options: SpawnOptions,
  ctx: SpawnContext
): Promise<ExecutorStepResult> {
  ctx.outputs = {};
  ctx.logs = [];
  const prepared = await prepareCommandFiles(ctx.workspacePath);

  return new Promise((resolve) => {
    const state = { stdout: '', stderr: '', isTimedOut: false };
    let child: ChildProcess;

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: createRuntimeEnv(ctx.env, ctx.workspacePath, prepared.envVars),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: options.shell === true ? true : false,
      });
    } catch (err) {
      void cleanupCommandFiles(prepared);
      resolve(failureResult(`Failed to spawn process: ${getErrorMessage(err)}`, ctx.outputs));
      return;
    }

    let forceKillHandle: NodeJS.Timeout | undefined;
    const timeoutHandle = setTimeout(() => {
      state.isTimedOut = true;
      pushLog(ctx.logs, `[TIMEOUT] Command timed out after ${options.timeout}ms`);
      forceKillHandle = gracefulKill(child);
    }, options.timeout);

    function clearTimers(): void {
      clearTimeout(timeoutHandle);
      if (forceKillHandle) clearTimeout(forceKillHandle);
    }

    child.stdout?.on('data', (data: Buffer) => {
      handleStdoutData(data, state, child, ctx);
    });
    child.stdout?.on('error', (err) => {
      state.stderr += `\nstdout stream error: ${err.message}`;
    });

    child.stderr?.on('data', (data: Buffer) => {
      handleStderrData(data, state);
    });
    child.stderr?.on('error', (err) => {
      state.stderr += `\nstderr stream error: ${err.message}`;
    });

    child.on('error', (err) => {
      clearTimers();
      void cleanupCommandFiles(prepared);
      resolve({
        exitCode: 1,
        stdout: state.stdout,
        stderr: state.stderr + `\nSpawn error: ${err.message}`,
        outputs: ctx.outputs,
        conclusion: 'failure',
      });
    });

    child.on('close', (code, signal) => {
      clearTimers();
      void (async () => {
        try {
          await applyCommandFiles(prepared, ctx);
        } catch (err) {
          pushLog(ctx.logs, `[WARNING] Failed to parse command files: ${getErrorMessage(err)}`);
        }
        await cleanupCommandFiles(prepared);

        if (state.isTimedOut) {
          resolve({
            exitCode: 124,
            stdout: state.stdout,
            stderr: state.stderr + '\nCommand timed out',
            outputs: ctx.outputs,
            conclusion: 'failure',
          });
          return;
        }

        const exitCode = code ?? (signal ? 128 : 1);
        resolve({
          exitCode,
          stdout: state.stdout,
          stderr: state.stderr,
          outputs: ctx.outputs,
          conclusion: exitCode === 0 ? 'success' : 'failure',
        });
      })();
    });
  });
}
