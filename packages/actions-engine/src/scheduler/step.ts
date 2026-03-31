/**
 * ステップ実行管理
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter as pathDelimiter, join } from 'node:path';

import {
  DEFAULT_TIMEOUT_MINUTES,
  MAX_COMMAND_FILE_BYTES,
  MINUTES_TO_MS,
} from '../constants.ts';
import type {
  Step,
  StepResult,
  ExecutionContext,
  ActionResolver,
} from '../workflow-models.ts';
import { parseGitHubEnvFile } from '../context.ts';
import {
  evaluateCondition,
  interpolateString,
  interpolateObject,
} from '../parser/expression.ts';
import {
  parseOutputs,
  iterateNormalizedLines,
  parsePathFile,
} from './step-output-parser.ts';

/**
 * Step runner options
 */
export interface StepRunnerOptions {
  /** カスタムアクション解決器 */
  actionResolver?: ActionResolver;
  /** カスタムシェルコマンド実行器 */
  shellExecutor?: ShellExecutor;
  /** デフォルトタイムアウト（分） */
  defaultTimeout?: number;
  /** 作業ディレクトリ */
  workingDirectory?: string;
  /** デフォルトシェル */
  defaultShell?: Step['shell'];
}

/**
 * Metadata for step execution
 */
export interface StepRunMetadata {
  /** ジョブ内の 0 始まりインデックス */
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

    // shell: false で spawn し、`command` の内容がシェル名として
    // 解釈されないよう、常に別バイナリとしてコマンド文字列を引数に渡す。
    let spawnFile: string;
    let spawnArgs: string[];

    if (shellExecutable === true) {
      // 明示的なシェル未指定時は OS 標準シェルにフォールバック
      // するが、spawn は明示的に shell: false で実行する。
      if (process.platform === 'win32') {
        spawnFile = 'cmd.exe';
        spawnArgs = ['/d', '/s', '/c', command];
      } else {
        spawnFile = '/bin/sh';
        spawnArgs = ['-c', command];
      }
    } else {
      // 明示的に解決したシェルバイナリを使用（bash/powershell/cmd.exe など）。
      if (shellExecutable === 'cmd.exe' || shellExecutable === 'cmd') {
        spawnArgs = ['/d', '/s', '/c', command];
      } else if (
        shellExecutable === 'powershell.exe' ||
        shellExecutable === 'powershell' ||
        shellExecutable === 'pwsh'
      ) {
        spawnArgs = ['-NonInteractive', '-Command', command];
      } else {
        // 汎用 POSIX シェル（bash/sh/zsh など）
        spawnArgs = ['-c', command];
      }
      spawnFile = shellExecutable;
    }

    // 機密情報が漏れないよう、許可されたホスト環境変数のみ渡す。
    // ワークフローの env は options.env で渡す。
    const safeHostEnv: Record<string, string> = {};
    const ALLOWED_HOST_VARS = [
      'PATH', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE',
      'TERM', 'TMPDIR', 'TMP', 'TEMP', 'HOSTNAME',
      'NODE_ENV', 'CI',
    ];
    for (const key of ALLOWED_HOST_VARS) {
      if (Deno.env.get(key)) {
        safeHostEnv[key] = Deno.env.get(key)!;
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

    if (timeout && typeof timeout === 'object' && 'unref' in timeout) {
      (timeout as { unref(): void }).unref();
    }

    child.stdout?.on('data', (chunk: string | Uint8Array) => {
      stdout += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    });
    child.stderr?.on('data', (chunk: string | Uint8Array) => {
      stderr += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
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

        // steps.<id>.outputs.path を参照する workflow 互換性を維持
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
      defaultTimeout: options.defaultTimeout ?? DEFAULT_TIMEOUT_MINUTES,
      workingDirectory: options.workingDirectory ?? process.cwd(),
      defaultShell: options.defaultShell ?? resolvePlatformDefaultShell(),
      ...options,
    };
    this.actionResolver = options.actionResolver ?? defaultActionResolver;
    this.shellExecutor = options.shellExecutor ?? defaultShellExecutor;
  }

  /**
   * 単一ステップを実行
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
      // 条件判定
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

      // 環境変数をマージ
      const env = {
        ...context.env,
        ...(step.env || {}),
      };

      // 環境変数を補間
      const interpolatedEnv = interpolateObject(env, context);

      // 補間済み環境変数でステップコンテキストを作成
      const stepContext: ExecutionContext = {
        ...context,
        env: interpolatedEnv,
      };

      // ステップ種別ごとに実行
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
   * アクションステップを実行
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

    // パラメータを補間
    const interpolatedWith = step.with
      ? interpolateObject(step.with, context)
      : {};

    const stepWithInterpolated: Step = {
      ...step,
      uses,
      with: interpolatedWith,
    };

    const actionResult = await action.run(stepWithInterpolated, context);

    // 出力を統合
    Object.assign(result.outputs, actionResult.outputs);
    result.conclusion = actionResult.conclusion;
  }

  /**
   * シェルコマンドステップを実行
   */
  private async runShell(
    step: Step,
    context: ExecutionContext,
    sharedEnv: Record<string, string>,
    result: StepResult
  ): Promise<void> {
    // コマンド文字列を補間
    const command = interpolateString(step.run!, context);

    // 使用シェルを決定
    const shell = step.shell ?? this.options.defaultShell;

    // 作業ディレクトリを決定
    const workingDirectory =
      step['working-directory'] ?? this.options.workingDirectory;
    const interpolatedWorkDir = interpolateString(workingDirectory!, context);

    // タイムアウトを計算
    const timeout = (step['timeout-minutes'] ?? this.options.defaultTimeout!) * MINUTES_TO_MS;

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
      // コマンドを実行
      const shellResult = await this.shellExecutor(command, {
        shell,
        workingDirectory: interpolatedWorkDir,
        env: shellEnv,
        timeout,
      });

      // stdout から GitHub Actions 形式の出力をパース
      const stdoutOutputs = parseOutputs(shellResult.stdout);
      Object.assign(result.outputs, stdoutOutputs);

      // コマンドファイル出力（echo "name=value" >> $GITHUB_OUTPUT）を統合
      const commandFileOutputs = await this.parseCommandFileOutputs(commandFiles.output);
      Object.assign(result.outputs, commandFileOutputs);

      // GITHUB_ENV と GITHUB_PATH の更新を後続ステップへ反映
      await this.applyCommandFileEnvironmentUpdates(sharedEnv, commandFiles, shellEnv);

      // 終了コードで結果を確定
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
    const appendedPaths = parsePathFile(pathContent);
    if (appendedPaths.length > 0) {
      const basePath = sharedEnv.PATH ?? shellEnv.PATH ?? Deno.env.get('PATH') ?? '';
      const prefix = appendedPaths.join(pathDelimiter);
      sharedEnv.PATH = basePath.length > 0 ? `${prefix}${pathDelimiter}${basePath}` : prefix;
    }
  }

  /** @see {@link MAX_COMMAND_FILE_BYTES}（constants.ts の定義参照） */
  private static readonly MAX_COMMAND_FILE_BYTES = MAX_COMMAND_FILE_BYTES;

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
      // コマンドファイルのクリーンアップはステップ失敗要因にしない
    }
  }
}
