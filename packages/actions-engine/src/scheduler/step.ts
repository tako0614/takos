/**
 * ステップ実行管理
 */
import { tmpdir } from "node:os";

import { DEFAULT_TIMEOUT_MINUTES, MINUTES_TO_MS } from "../constants.ts";
import type {
  ActionResolver,
  Conclusion,
  ExecutionContext,
  JobDefaults,
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
  maskSecretsInText,
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
  /**
   * job / workflow の defaults.run 設定。
   * step 側で shell / working-directory が未設定なら
   * job.defaults.run -> workflow.defaults.run の順で fallback する。
   */
  defaults?: {
    workflow?: JobDefaults;
    job?: JobDefaults;
  };
}

/**
 * Metadata for step execution
 */
export interface StepRunMetadata {
  /** ジョブ内の 0 始まりインデックス */
  index?: number;
  /**
   * ステップ実行前のジョブ状態。
   * `if: failure()` / `cancelled()` / `always()` の評価に使う。
   * 未指定なら `success` とみなす。
   */
  jobStatus?: "success" | "failure" | "cancelled";
  /**
   * このステップが所属するジョブの defaults.run 設定。
   * step / job / workflow の fallback 順で shell と working-directory を決める。
   */
  jobDefaults?: JobDefaults;
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
    metadata: StepRunMetadata = {},
  ): Promise<StepResult> {
    const startedAt = new Date();
    const result: StepResult = {
      id: step.id,
      name: step.name,
      status: "queued",
      outputs: {},
      startedAt,
    };

    // metadata.jobStatus を反映して `success()` / `failure()` /
    // `cancelled()` / `always()` が直前ステップの失敗を観測できるようにする。
    const stepExecutionContext: ExecutionContext = metadata.jobStatus
      ? {
        ...context,
        job: { ...context.job, status: metadata.jobStatus },
      }
      : context;

    try {
      // 条件判定
      if (step.if !== undefined) {
        const shouldRun = evaluateCondition(step.if, stepExecutionContext);
        if (!shouldRun) {
          result.status = "completed";
          result.conclusion = "skipped";
          result.outcome = "skipped";
          result.completedAt = new Date();
          return result;
        }
      }

      result.status = "in_progress";

      // 環境変数をマージ
      const env = {
        ...stepExecutionContext.env,
        ...(step.env || {}),
      };

      // 環境変数を補間
      const interpolatedEnv = interpolateObject(env, stepExecutionContext);

      // 補間済み環境変数でステップコンテキストを作成
      const stepContext: ExecutionContext = {
        ...stepExecutionContext,
        env: interpolatedEnv,
      };

      // ステップ種別ごとに実行
      if (step.uses) {
        await this.runAction(step, stepContext, result);
      } else if (step.run) {
        await this.runShell(
          step,
          stepContext,
          context.env,
          result,
          metadata.jobDefaults,
        );
      } else {
        throw new Error('Step must have either "uses" or "run"');
      }

      result.status = "completed";
      const conclusion: Conclusion = result.conclusion ?? "success";
      result.conclusion = conclusion;
      result.outcome = conclusion;
    } catch (error) {
      result.status = "completed";
      result.outcome = "failure";
      result.conclusion = "failure";
      const rawError = error instanceof Error ? error.message : String(error);
      result.error = maskSecretsInText(
        rawError,
        collectSecretValues(stepExecutionContext),
      );
    }

    // secret 値を stdout/stderr/error から安全にマスクする
    const secrets = collectSecretValues(stepExecutionContext);
    if (secrets.length > 0 && result.error) {
      result.error = maskSecretsInText(result.error, secrets);
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
    jobDefaults?: JobDefaults,
  ): Promise<void> {
    // コマンド文字列を補間
    const command = interpolateString(step.run!, context);

    // 使用シェルを決定（step -> job.defaults -> workflow.defaults -> runner 既定）
    const shell = this.resolveShell(step, jobDefaults);

    // 作業ディレクトリを決定（同上の fallback）
    const workingDirectory = this.resolveWorkingDirectory(step, jobDefaults);
    const interpolatedWorkDir = interpolateString(workingDirectory, context);

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

    // ${{ secrets.X }} 経由で解決された機密値を集める
    const secretValues = collectSecretValues(context);

    try {
      // コマンドを実行
      const shellResult = await this.shellExecutor(command, {
        shell,
        workingDirectory: interpolatedWorkDir,
        env: shellEnv,
        timeout,
      });

      // secrets を出力からマスク
      const maskedStdout = maskSecretsInText(shellResult.stdout, secretValues);
      const maskedStderr = maskSecretsInText(shellResult.stderr, secretValues);

      // stdout から GitHub Actions 形式の出力をパース
      const stdoutOutputs = parseOutputs(maskedStdout);
      Object.assign(result.outputs, stdoutOutputs);

      // コマンドファイル出力（echo "name=value" >> $GITHUB_OUTPUT）を統合
      const commandFileOutputs = await parseStepCommandFileOutputs(
        commandFiles.output,
      );
      // コマンドファイル経由の値にも同じマスクを適用する
      for (const [key, value] of Object.entries(commandFileOutputs)) {
        result.outputs[key] = maskSecretsInText(value, secretValues);
      }

      // GITHUB_ENV と GITHUB_PATH の更新を後続ステップへ反映
      await applyStepCommandFileEnvironmentUpdates(
        sharedEnv,
        commandFiles,
        shellEnv,
      );

      // 終了コードで結果を確定
      result.conclusion = shellResult.exitCode === 0 ? "success" : "failure";

      if (shellResult.exitCode !== 0) {
        let errorMessage = `Exit code: ${shellResult.exitCode}`;
        if (maskedStderr) {
          errorMessage += `\n${maskedStderr}`;
        }
        result.error = errorMessage;
      }
    } finally {
      await removeStepCommandFilesDirectory(commandFiles.directory);
    }
  }

  /**
   * step の shell を resolve する。
   * 優先度: step.shell > 呼び出し側 jobDefaults > options.defaults.workflow > options.defaultShell
   */
  private resolveShell(
    step: Step,
    jobDefaults?: JobDefaults,
  ): Step["shell"] {
    if (step.shell) {
      return step.shell;
    }

    const jobShell = jobDefaults?.run?.shell;
    if (jobShell) {
      return normalizeDefaultShell(jobShell);
    }
    const workflowShell = this.options.defaults?.workflow?.run?.shell;
    if (workflowShell) {
      return normalizeDefaultShell(workflowShell);
    }
    // options.defaults.job はレガシー (constructor 時点で設定する場合) の fallback
    const constructorJobShell = this.options.defaults?.job?.run?.shell;
    if (constructorJobShell) {
      return normalizeDefaultShell(constructorJobShell);
    }

    return this.options.defaultShell;
  }

  /**
   * step の working-directory を resolve する。
   * 優先度: step['working-directory'] > jobDefaults > workflow defaults > options.workingDirectory
   */
  private resolveWorkingDirectory(
    step: Step,
    jobDefaults?: JobDefaults,
  ): string {
    if (step["working-directory"]) {
      return step["working-directory"];
    }

    const jobDir = jobDefaults?.run?.["working-directory"];
    if (jobDir) {
      return jobDir;
    }
    const workflowDir = this.options.defaults?.workflow?.run
      ?.["working-directory"];
    if (workflowDir) {
      return workflowDir;
    }
    const constructorJobDir = this.options.defaults?.job?.run
      ?.["working-directory"];
    if (constructorJobDir) {
      return constructorJobDir;
    }

    return this.options.workingDirectory!;
  }
}

function normalizeDefaultShell(shell: string): Step["shell"] {
  switch (shell) {
    case "bash":
    case "pwsh":
    case "python":
    case "sh":
    case "cmd":
    case "powershell":
      return shell;
    default:
      return shell as Step["shell"];
  }
}

/**
 * ExecutionContext.secrets の値を配列で返す。
 * 空文字は秘密情報マッチに含めない（誤置換を避ける）。
 */
function collectSecretValues(context: ExecutionContext): string[] {
  const values: string[] = [];
  if (!context.secrets) {
    return values;
  }
  for (const value of Object.values(context.secrets)) {
    if (typeof value === "string" && value.length > 0) {
      values.push(value);
    }
  }
  return values;
}
