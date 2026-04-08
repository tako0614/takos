/**
 * ステップ実行管理
 */
import { tmpdir } from "node:os";

import { DEFAULT_TIMEOUT_MINUTES, MINUTES_TO_MS } from "../constants.ts";
import type {
  ActionResolver,
  ExecutionContext,
  Step,
  StepResult,
} from "../workflow-models.ts";
import {
  evaluateCondition,
  interpolateObject,
  interpolateString,
} from "../parser/expression.ts";
import { parseOutputs } from "./step-output-parser.ts";
import {
  applyStepCommandFileEnvironmentUpdates,
  createStepCommandFiles,
  parseStepCommandFileOutputs,
  removeStepCommandFilesDirectory,
  resolveRunnerTemp,
} from "./step-command-files.ts";
import { defaultActionResolver } from "./step-action-resolver.ts";
import {
  defaultShellExecutor,
  resolvePlatformDefaultShell,
  type ShellExecutor,
} from "./step-shell-executor.ts";

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
  defaultShell?: Step["shell"];
}

/**
 * Metadata for step execution
 */
export interface StepRunMetadata {
  /** ジョブ内の 0 始まりインデックス */
  index?: number;
}

export type {
  ShellExecutor,
  ShellExecutorOptions,
  ShellExecutorResult,
} from "./step-shell-executor.ts";

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
    _metadata: StepRunMetadata = {},
  ): Promise<StepResult> {
    const startedAt = new Date();
    const result: StepResult = {
      id: step.id,
      name: step.name,
      status: "queued",
      outputs: {},
      startedAt,
    };

    try {
      // 条件判定
      if (step.if !== undefined) {
        const shouldRun = evaluateCondition(step.if, context);
        if (!shouldRun) {
          result.status = "completed";
          result.conclusion = "skipped";
          result.completedAt = new Date();
          return result;
        }
      }

      result.status = "in_progress";

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

      result.status = "completed";
      result.conclusion = result.conclusion ?? "success";
    } catch (error) {
      result.status = "completed";
      result.conclusion = step["continue-on-error"] ? "success" : "failure";
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
    result: StepResult,
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
    result: StepResult,
  ): Promise<void> {
    // コマンド文字列を補間
    const command = interpolateString(step.run!, context);

    // 使用シェルを決定
    const shell = step.shell ?? this.options.defaultShell;

    // 作業ディレクトリを決定
    const workingDirectory = step["working-directory"] ??
      this.options.workingDirectory;
    const interpolatedWorkDir = interpolateString(workingDirectory!, context);

    // タイムアウトを計算
    const timeout = (step["timeout-minutes"] ?? this.options.defaultTimeout!) *
      MINUTES_TO_MS;

    const commandFiles = await createStepCommandFiles(
      context.env,
      context.runner.temp || tmpdir(),
    );
    const runnerTemp = resolveRunnerTemp(
      context.env,
      context.runner.temp || tmpdir(),
    );
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
      const commandFileOutputs = await parseStepCommandFileOutputs(
        commandFiles.output,
      );
      Object.assign(result.outputs, commandFileOutputs);

      // GITHUB_ENV と GITHUB_PATH の更新を後続ステップへ反映
      await applyStepCommandFileEnvironmentUpdates(
        sharedEnv,
        commandFiles,
        shellEnv,
      );

      // 終了コードで結果を確定
      result.conclusion = shellResult.exitCode === 0 ? "success" : "failure";

      if (shellResult.exitCode !== 0) {
        result.error = `Exit code: ${shellResult.exitCode}`;
        if (shellResult.stderr) {
          result.error += `\n${shellResult.stderr}`;
        }
      }
    } finally {
      await removeStepCommandFilesDirectory(commandFiles.directory);
    }
  }
}
