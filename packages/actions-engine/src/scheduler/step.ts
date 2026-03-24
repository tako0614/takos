/**
 * Step execution management
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter as pathDelimiter, join } from 'node:path';

import type {
  Step,
  StepResult,
  ExecutionContext,
  ActionResolver,
} from '../types.js';
import { parseGitHubEnvFile } from '../context.js';
import {
  evaluateCondition,
  interpolateString,
  interpolateObject,
} from '../parser/expression.js';

/**
 * Step runner options
 */
export interface StepRunnerOptions {
  /** Custom action resolver */
  actionResolver?: ActionResolver;
  /** Custom shell command executor */
  shellExecutor?: ShellExecutor;
  /** Default timeout in minutes */
  defaultTimeout?: number;
  /** Working directory */
  workingDirectory?: string;
  /** Default shell */
  defaultShell?: Step['shell'];
}

/**
 * Metadata for step execution
 */
export interface StepRunMetadata {
  /** Zero-based step index within its job */
  index?: number;
}

/**
 * Shell executor function type
 */
export type ShellExecutor = (
  command: string,
  options: ShellExecutorOptions
) => Promise<ShellExecutorResult>;

/**
 * Shell executor options
 */
export interface ShellExecutorOptions {
  shell?: Step['shell'];
  workingDirectory?: string;
  env?: Record<string, string>;
  timeout?: number;
}

/**
 * Shell executor result
 */
export interface ShellExecutorResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface StepCommandFiles {
  directory: string;
  env: string;
  output: string;
  path: string;
}

const SIMPLE_OUTPUT_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BUILTIN_NOOP_ACTIONS = new Set(['actions/checkout', 'actions/setup-node']);

function resolvePlatformDefaultShell(): Step['shell'] {
  return process.platform === 'win32' ? 'pwsh' : 'bash';
}

/**
 * Resolve shell name to executable
 */
function resolveShellExecutable(shell: Step['shell'] | undefined): string | true {
  if (!shell) {
    return true;
  }

  switch (shell) {
    case 'cmd':
      return process.platform === 'win32' ? 'cmd.exe' : 'cmd';
    case 'powershell':
      return process.platform === 'win32' ? 'powershell.exe' : 'powershell';
    default:
      return shell;
  }
}

/**
 * Default shell executor
 */
const defaultShellExecutor: ShellExecutor = async (
  command: string,
  options: ShellExecutorOptions
): Promise<ShellExecutorResult> => {
  return new Promise<ShellExecutorResult>((resolve, reject) => {
    const shellExecutable = resolveShellExecutable(options.shell);

    // Always invoke the shell as a separate binary with the command passed as
    // an argument so that shell: false can be used and user-supplied content in
    // `command` is never interpreted as a shell command name.
    let spawnFile: string;
    let spawnArgs: string[];

    if (shellExecutable === true) {
      // No explicit shell requested – fall back to the platform default shell
      // but still spawn it explicitly with shell: false.
      if (process.platform === 'win32') {
        spawnFile = 'cmd.exe';
        spawnArgs = ['/d', '/s', '/c', command];
      } else {
        spawnFile = '/bin/sh';
        spawnArgs = ['-c', command];
      }
    } else {
      // An explicit shell binary was resolved (bash, powershell, cmd.exe, …).
      if (shellExecutable === 'cmd.exe' || shellExecutable === 'cmd') {
        spawnArgs = ['/d', '/s', '/c', command];
      } else if (
        shellExecutable === 'powershell.exe' ||
        shellExecutable === 'powershell' ||
        shellExecutable === 'pwsh'
      ) {
        spawnArgs = ['-NonInteractive', '-Command', command];
      } else {
        // Generic POSIX-compatible shell (bash, sh, zsh, …)
        spawnArgs = ['-c', command];
      }
      spawnFile = shellExecutable;
    }

    // Only pass safe host environment variables to prevent leaking secrets.
    // Workflow-level env vars are provided via options.env.
    const safeHostEnv: Record<string, string> = {};
    const ALLOWED_HOST_VARS = [
      'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
      'TERM', 'TMPDIR', 'TMP', 'TEMP', 'HOSTNAME',
      'NODE_ENV', 'CI',
    ];
    for (const key of ALLOWED_HOST_VARS) {
      if (process.env[key]) {
        safeHostEnv[key] = process.env[key]!;
      }
    }

    const child = spawn(spawnFile, spawnArgs, {
      cwd: options.workingDirectory,
      env: {
        ...safeHostEnv,
        ...(options.env ?? {}),
      },
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout =
      typeof options.timeout === 'number' && options.timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeout)
        : undefined;

    timeout?.unref?.();

    child.stdout?.on('data', (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      const exitCode =
        typeof code === 'number' ? code : timedOut ? 124 : signal ? 128 : 1;

      if (timedOut) {
        const timeoutMessage = `Command timed out after ${options.timeout}ms`;
        stderr = appendStderrMessage(stderr, timeoutMessage);
      } else if (signal) {
        const signalMessage = `Process terminated by signal: ${signal}`;
        stderr = appendStderrMessage(stderr, signalMessage);
      }

      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });
  });
};

function appendStderrMessage(stderr: string, message: string): string {
  return stderr.length > 0 ? `${stderr}\n${message}` : message;
}

/**
 * Default action resolver
 */
const defaultActionResolver: ActionResolver = async (uses: string) => {
  const normalizedUses = uses.trim().toLowerCase();
  const actionName = normalizedUses.split('@')[0];

  if (BUILTIN_NOOP_ACTIONS.has(actionName)) {
    return {
      run: async (step, context): Promise<StepResult> => {
        const outputs: Record<string, string> = {};

        // Keep checkout compatibility for workflows that read steps.<id>.outputs.path.
        if (actionName === 'actions/checkout') {
          const configuredPath =
            typeof step.with?.path === 'string' && step.with.path.length > 0
              ? step.with.path
              : context.github.workspace;
          outputs.path = configuredPath;
        }

        return {
          id: step.id,
          name: step.name,
          status: 'completed',
          conclusion: 'success',
          outputs,
        };
      },
    };
  }

  return {
    run: async (): Promise<StepResult> => {
      throw new Error(
        `Unsupported action: ${uses}. Provide StepRunnerOptions.actionResolver for action steps.`
      );
    },
  };
};

/**
 * Step runner for executing individual steps
 */
export class StepRunner {
  private options: StepRunnerOptions;
  private actionResolver: ActionResolver;
  private shellExecutor: ShellExecutor;

  constructor(options: StepRunnerOptions = {}) {
    this.options = {
      defaultTimeout: options.defaultTimeout ?? 360,
      workingDirectory: options.workingDirectory ?? process.cwd(),
      defaultShell: options.defaultShell ?? resolvePlatformDefaultShell(),
      ...options,
    };
    this.actionResolver = options.actionResolver ?? defaultActionResolver;
    this.shellExecutor = options.shellExecutor ?? defaultShellExecutor;
  }

  /**
   * Run a single step
   */
  async runStep(
    step: Step,
    context: ExecutionContext,
    _metadata: StepRunMetadata = {}
  ): Promise<StepResult> {
    const startedAt = new Date();
    const result: StepResult = {
      id: step.id,
      name: step.name,
      status: 'queued',
      outputs: {},
      startedAt,
    };

    try {
      // Check condition
      if (step.if !== undefined) {
        const shouldRun = evaluateCondition(step.if, context);
        if (!shouldRun) {
          result.status = 'completed';
          result.conclusion = 'skipped';
          result.completedAt = new Date();
          return result;
        }
      }

      result.status = 'in_progress';

      // Merge environment variables
      const env = {
        ...context.env,
        ...(step.env || {}),
      };

      // Interpolate environment variables
      const interpolatedEnv = interpolateObject(env, context);

      // Create step context with interpolated env
      const stepContext: ExecutionContext = {
        ...context,
        env: interpolatedEnv,
      };

      // Execute based on step type
      if (step.uses) {
        await this.runAction(step, stepContext, result);
      } else if (step.run) {
        await this.runShell(step, stepContext, context.env, result);
      } else {
        throw new Error('Step must have either "uses" or "run"');
      }

      result.status = 'completed';
      result.conclusion = result.conclusion ?? 'success';
    } catch (error) {
      result.status = 'completed';
      result.conclusion = step['continue-on-error'] ? 'success' : 'failure';
      result.error = error instanceof Error ? error.message : String(error);
    }

    result.completedAt = new Date();
    return result;
  }

  /**
   * Run an action step
   */
  private async runAction(
    step: Step,
    context: ExecutionContext,
    result: StepResult
  ): Promise<void> {
    const uses = interpolateString(step.uses!, context);
    const action = await this.actionResolver(uses);

    if (!action) {
      throw new Error(`Action not found: ${uses}`);
    }

    // Interpolate with parameters
    const interpolatedWith = step.with
      ? interpolateObject(step.with, context)
      : {};

    const stepWithInterpolated: Step = {
      ...step,
      uses,
      with: interpolatedWith,
    };

    const actionResult = await action.run(stepWithInterpolated, context);

    // Merge outputs
    Object.assign(result.outputs, actionResult.outputs);
    result.conclusion = actionResult.conclusion;
  }

  /**
   * Run a shell command step
   */
  private async runShell(
    step: Step,
    context: ExecutionContext,
    sharedEnv: Record<string, string>,
    result: StepResult
  ): Promise<void> {
    // Interpolate command
    const command = interpolateString(step.run!, context);

    // Determine shell
    const shell = step.shell ?? this.options.defaultShell;

    // Determine working directory
    const workingDirectory =
      step['working-directory'] ?? this.options.workingDirectory;
    const interpolatedWorkDir = interpolateString(workingDirectory!, context);

    // Calculate timeout
    const timeout = (step['timeout-minutes'] ?? this.options.defaultTimeout!) * 60_000;

    const commandFiles = await this.createCommandFiles(context);
    const runnerTemp = this.resolveRunnerTemp(context);
    const shellEnv = {
      ...context.env,
      RUNNER_TEMP: runnerTemp,
      GITHUB_ENV: commandFiles.env,
      GITHUB_OUTPUT: commandFiles.output,
      GITHUB_PATH: commandFiles.path,
    };

    try {
      // Execute command
      const shellResult = await this.shellExecutor(command, {
        shell,
        workingDirectory: interpolatedWorkDir,
        env: shellEnv,
        timeout,
      });

      // Parse outputs from stdout (GitHub Actions format)
      const stdoutOutputs = this.parseOutputs(shellResult.stdout);
      Object.assign(result.outputs, stdoutOutputs);

      // Merge command-file outputs (echo "name=value" >> $GITHUB_OUTPUT)
      const commandFileOutputs = await this.parseCommandFileOutputs(commandFiles.output);
      Object.assign(result.outputs, commandFileOutputs);

      // Persist GITHUB_ENV and GITHUB_PATH updates for later steps.
      await this.applyCommandFileEnvironmentUpdates(sharedEnv, commandFiles, shellEnv);

      // Set conclusion based on exit code
      result.conclusion = shellResult.exitCode === 0 ? 'success' : 'failure';

      if (shellResult.exitCode !== 0) {
        result.error = `Exit code: ${shellResult.exitCode}`;
        if (shellResult.stderr) {
          result.error += `\n${shellResult.stderr}`;
        }
      }
    } finally {
      await this.removeCommandFilesDirectory(commandFiles.directory);
    }
  }

  private resolveRunnerTemp(context: ExecutionContext): string {
    return context.env.RUNNER_TEMP || context.runner.temp || tmpdir();
  }

  private async createCommandFiles(context: ExecutionContext): Promise<StepCommandFiles> {
    const runnerTemp = this.resolveRunnerTemp(context);
    let directory: string;

    try {
      directory = await mkdtemp(join(runnerTemp, 'actions-engine-step-'));
    } catch {
      directory = await mkdtemp(join(tmpdir(), 'actions-engine-step-'));
    }

    return {
      directory,
      env: join(directory, 'github-env'),
      output: join(directory, 'github-output'),
      path: join(directory, 'github-path'),
    };
  }

  private async parseCommandFileOutputs(outputPath: string): Promise<Record<string, string>> {
    const outputContent = await this.readCommandFile(outputPath);
    if (outputContent.length === 0) {
      return {};
    }
    return parseGitHubEnvFile(outputContent);
  }

  private async applyCommandFileEnvironmentUpdates(
    sharedEnv: Record<string, string>,
    commandFiles: StepCommandFiles,
    shellEnv: Record<string, string>
  ): Promise<void> {
    const envContent = await this.readCommandFile(commandFiles.env);
    if (envContent.length > 0) {
      const updates = parseGitHubEnvFile(envContent);
      Object.assign(sharedEnv, updates);
    }

    const pathContent = await this.readCommandFile(commandFiles.path);
    const appendedPaths = this.parsePathFile(pathContent);
    if (appendedPaths.length > 0) {
      const basePath = sharedEnv.PATH ?? shellEnv.PATH ?? process.env.PATH ?? '';
      const prefix = appendedPaths.join(pathDelimiter);
      sharedEnv.PATH = basePath.length > 0 ? `${prefix}${pathDelimiter}${basePath}` : prefix;
    }
  }

  private parsePathFile(content: string): string[] {
    const entries: string[] = [];

    this.iterateNormalizedLines(content, (line) => {
      if (line.trim().length === 0) {
        return;
      }
      entries.push(line);
    });

    return entries;
  }

  /** Maximum size for GITHUB_ENV / GITHUB_OUTPUT / GITHUB_PATH command files (10 MB) */
  private static readonly MAX_COMMAND_FILE_BYTES = 10 * 1024 * 1024;

  private async readCommandFile(path: string): Promise<string> {
    try {
      const { stat } = await import('node:fs/promises');
      const stats = await stat(path);
      if (stats.size > StepRunner.MAX_COMMAND_FILE_BYTES) {
        throw new Error(
          `Command file ${path} exceeds maximum size of ${StepRunner.MAX_COMMAND_FILE_BYTES} bytes (actual: ${stats.size})`
        );
      }
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }

  private async removeCommandFilesDirectory(path: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      // Command-file cleanup should never fail step execution.
    }
  }

  /**
   * Parse GitHub Actions output format from stdout
   * Format: ::set-output name=<name>::<value>
   * Or: echo "name=value" >> $GITHUB_OUTPUT
   */
  private parseOutputs(stdout: string): Record<string, string> {
    const outputs: Record<string, string> = {};

    this.iterateNormalizedLines(stdout, (line) => {
      this.parseLegacyOutputLine(line, outputs);
      this.parseSimpleOutputLine(line, outputs);
    });

    return outputs;
  }

  private iterateNormalizedLines(
    content: string,
    iterate: (line: string) => void
  ): void {
    if (content.length === 0) {
      return;
    }

    const lines = content.split('\n');
    for (let line of lines) {
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      iterate(line);
    }
  }

  private parseLegacyOutputLine(
    line: string,
    outputs: Record<string, string>
  ): void {
    const prefix = '::set-output name=';
    if (!line.startsWith(prefix)) {
      return;
    }

    const separatorIndex = line.indexOf('::', prefix.length);
    if (separatorIndex === -1) {
      return;
    }

    const name = line.slice(prefix.length, separatorIndex);
    if (name.length === 0 || name.includes(':')) {
      return;
    }

    const value = line.slice(separatorIndex + 2);
    outputs[name] = value;
  }

  private parseSimpleOutputLine(
    line: string,
    outputs: Record<string, string>
  ): void {
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }

    const name = line.slice(0, separatorIndex);
    if (!SIMPLE_OUTPUT_NAME_REGEX.test(name)) {
      return;
    }

    const value = line.slice(separatorIndex + 1);
    if (!(name in outputs)) {
      outputs[name] = value;
    }
  }
}

