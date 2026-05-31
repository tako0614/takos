/**
 * ジョブスケジューラと実行管理
 */
import { MINUTES_TO_MS } from "../constants.ts";
import type {
  Conclusion,
  ExecutionContext,
  ExecutionPlan,
  Job,
  JobResult,
  Workflow,
} from "../workflow-models.ts";
import { evaluateCondition } from "../parser/expression.ts";
import {
  buildDependencyGraph,
  type DependencyGraph,
  groupIntoPhases,
} from "./dependency.ts";
import { StepRunner, type StepRunnerOptions } from "./step.ts";
import {
  buildJobExecutionContext,
  buildNeedsContext,
  buildStepsContext,
  classifyStepControl,
  createCompletedJobResult,
  createInProgressJobResult,
  finalizeJobResult,
  getDependencySkipReason,
  type JobExecutionState,
} from "./job-policy.ts";
import {
  buildExpandedDependencyGraph,
  buildExpandedJobs,
  type ExpandedJob,
  normalizeNeedsInput,
  shouldSuppressDependencySkip,
} from "./job-expansion.ts";

// normalizeNeedsInput remains part of the current scheduler module surface.
export { normalizeNeedsInput };

// --- ジョブスケジューラ ---

/**
 * ジョブスケジューラの設定
 */
export interface JobSchedulerOptions {
  /** 最大同時実行ジョブ数（0 は無制限） */
  maxParallel?: number;
  /** フェイルファスト: 最初の失敗で残りジョブをキャンセル */
  failFast?: boolean;
  /** ステップランナーの設定 */
  stepRunner?: StepRunnerOptions;
}

/**
 * ジョブスケジューラのイベント種別
 */
export type JobSchedulerEvent =
  | { type: "job:start"; jobId: string; job: Job }
  | { type: "job:complete"; jobId: string; result: JobResult }
  | { type: "job:skip"; jobId: string; reason: string; result: JobResult }
  | { type: "phase:start"; phase: number; jobs: string[] }
  | { type: "phase:complete"; phase: number }
  | { type: "workflow:start"; phases: string[][] }
  | { type: "workflow:complete"; results: Record<string, JobResult> };

/**
 * ジョブスケジューラのイベントリスナー
 */
export type JobSchedulerListener = (event: JobSchedulerEvent) => void;

/**
 * ワークフロー実行のジョブスケジューラ
 */
export class JobScheduler {
  private workflow: Workflow;
  private options: JobSchedulerOptions;
  private expandedJobs: Map<string, ExpandedJob>;
  private expansionMap: Map<string, string[]>;
  private graph: DependencyGraph;
  private results: Map<string, JobResult>;
  private listeners: JobSchedulerListener[];
  private cancelled: boolean;
  private running: boolean;
  private stepRunner: StepRunner;

  constructor(workflow: Workflow, options: JobSchedulerOptions = {}) {
    this.workflow = workflow;
    // workflow.defaults と step runner options を合成
    // ユーザが明示的に defaults.workflow を渡した場合はそれを優先。
    const userDefaults = options.stepRunner?.defaults ?? {};
    const stepRunnerOptions: StepRunnerOptions = {
      ...(options.stepRunner ?? {}),
      defaults: {
        workflow: userDefaults.workflow ?? workflow.defaults,
        job: userDefaults.job,
      },
    };
    this.options = {
      maxParallel: options.maxParallel ?? 0,
      failFast: options.failFast ?? true,
      stepRunner: stepRunnerOptions,
    };
    const expanded = buildExpandedJobs(workflow);
    this.expandedJobs = expanded.jobs;
    this.expansionMap = expanded.expansionMap;
    // 依存グラフ構築時にサイクル検査 / 未知参照検査を先に行う。
    buildDependencyGraph(workflow);
    this.graph = buildExpandedDependencyGraph(
      this.expandedJobs,
      this.expansionMap,
    );
    this.results = new Map();
    this.listeners = [];
    this.cancelled = false;
    this.running = false;
    this.stepRunner = new StepRunner(this.options.stepRunner);
  }

  /**
   * イベントリスナーを追加し、解除関数を返す
   */
  on(listener: JobSchedulerListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * 全リスナーへイベント送信
   */
  private emit(event: JobSchedulerEvent): void {
    const snapshot = [...this.listeners];
    for (const listener of snapshot) {
      try {
        listener(event);
      } catch {
        // リスナーのエラーは無視
      }
    }
  }

  /**
   * ワークフロー実行をキャンセル
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * 新規実行のためにスケジューラ実行状態をリセット。
   * リスナーと設定は維持する。
   */
  private reset(): void {
    this.results.clear();
    this.cancelled = false;
  }

  /**
   * 実行計画を作成
   */
  createPlan(): ExecutionPlan {
    // groupIntoPhases は assertAcyclic でサイクル検査を済ませている
    const phases = groupIntoPhases(this.graph);

    return { phases };
  }

  /**
   * ワークフロー内の全ジョブを実行
   */
  async run(context: ExecutionContext): Promise<Record<string, JobResult>> {
    if (this.running) {
      throw new Error("JobScheduler is already running");
    }

    this.running = true;
    this.reset();

    try {
      const plan = this.createPlan();
      this.emit({ type: "workflow:start", phases: plan.phases });

      for (let phaseIndex = 0; phaseIndex < plan.phases.length; phaseIndex++) {
        if (this.cancelled) break;

        const phase = plan.phases[phaseIndex];
        this.emit({ type: "phase:start", phase: phaseIndex, jobs: phase });

        // フェーズ内ジョブを実行（必要に応じ並列）
        await this.runPhase(phase, context);

        this.emit({ type: "phase:complete", phase: phaseIndex });

        // フェイルファストモードで失敗を確認
        if (this.options.failFast) {
          const phaseFailed = phase.some(
            (jobId) => this.results.get(jobId)?.conclusion === "failure",
          );
          if (!phaseFailed) {
            continue;
          }

          this.cancelled = true;
          for (let i = phaseIndex + 1; i < plan.phases.length; i++) {
            this.markJobsCancelled(plan.phases[i]);
          }
          break;
        }
      }

      const results = this.getResults();
      this.emit({
        type: "workflow:complete",
        results: structuredClone(results),
      });
      return results;
    } finally {
      this.running = false;
    }
  }

  /**
   * 単一フェーズを実行する。
   *
   * 同時実行数は 2 段階で制限する:
   * - 全体上限: グローバル `JobSchedulerOptions.maxParallel`
   * - matrix 単位上限: 各 matrix 展開グループの `strategy.max-parallel`
   *
   * また matrix グループの `strategy.fail-fast` が true の場合、そのグループの
   * leg が 1 つ失敗したら同グループの残り leg をキャンセルする。これらは
   * matrix.ts が context.strategy に書き込むだけで実行に反映されていなかった
   * 値を、実際の実行で honor するための処理。
   */
  private async runPhase(
    jobIds: string[],
    context: ExecutionContext,
  ): Promise<void> {
    const globalLimit = this.options.maxParallel && this.options.maxParallel > 0
      ? this.options.maxParallel
      : jobIds.length || 1;

    // pending な job を順番に保持しつつ、group ごとの実行中カウントを追跡する。
    const pending = [...jobIds];
    const groupRunning = new Map<string, number>();
    const cancelledGroups = new Set<string>();
    let globalRunning = 0;

    const running = new Set<Promise<void>>();

    const startNextRunnable = (): boolean => {
      if (this.cancelled) return false;
      if (globalRunning >= globalLimit) return false;

      for (let i = 0; i < pending.length; i++) {
        const jobId = pending[i];
        const meta = this.matrixGroupMeta(jobId);

        // fail-fast で同グループがキャンセル済みなら、この leg はキャンセルし
        // pending から取り除く（実行はしない）。
        if (cancelledGroups.has(meta.groupKey)) {
          pending.splice(i, 1);
          this.markJobsCancelled([jobId]);
          i--;
          continue;
        }

        const groupActive = groupRunning.get(meta.groupKey) ?? 0;
        if (groupActive >= meta.maxParallel) {
          continue; // このグループは上限到達。別の job を探す。
        }

        // この job を起動する。
        pending.splice(i, 1);
        globalRunning++;
        groupRunning.set(meta.groupKey, groupActive + 1);

        const task = this.runJob(jobId, context).then((result) => {
          globalRunning--;
          groupRunning.set(
            meta.groupKey,
            (groupRunning.get(meta.groupKey) ?? 1) - 1,
          );
          // matrix グループの fail-fast: leg が失敗したら同グループの残りを
          // キャンセル対象にマークする。
          if (
            meta.failFast && result.conclusion === "failure" &&
            meta.isMatrixGroup
          ) {
            cancelledGroups.add(meta.groupKey);
          }
        }).catch(() => {
          // runJob は内部でエラーを握って result を返すため通常ここには来ないが、
          // 想定外の throw でも実行中カウントは必ず戻す（pool が停止しないように）。
          globalRunning--;
          groupRunning.set(
            meta.groupKey,
            (groupRunning.get(meta.groupKey) ?? 1) - 1,
          );
        });
        running.add(task);
        task.finally(() => {
          running.delete(task);
        });
        return true;
      }
      return false;
    };

    // 起動できるだけ起動し、いずれかが完了したら再度起動を試みる。
    while (true) {
      while (startNextRunnable()) {
        // 起動可能な限り起動する。
      }
      if (running.size === 0) {
        break;
      }
      await Promise.race(running);
    }

    if (this.cancelled) {
      // workflow 全体がキャンセルされた場合、未起動の残りをキャンセル扱いにする。
      this.markJobsCancelled(pending);
    }
  }

  /**
   * job の matrix グループ情報を返す。
   * matrix 展開でないジョブは job 自身を単独グループ (上限 1, fail-fast 無効)
   * として扱う。
   */
  private matrixGroupMeta(jobId: string): {
    groupKey: string;
    maxParallel: number;
    failFast: boolean;
    isMatrixGroup: boolean;
  } {
    const expanded = this.expandedJobs.get(jobId);
    const strategy = expanded?.strategy;
    if (!expanded || !strategy) {
      return {
        groupKey: jobId,
        maxParallel: 1,
        failFast: false,
        isMatrixGroup: false,
      };
    }
    const rawMaxParallel = strategy["max-parallel"];
    const maxParallel = rawMaxParallel > 0
      ? rawMaxParallel
      : strategy["job-total"];
    return {
      groupKey: expanded.baseId,
      maxParallel: maxParallel > 0 ? maxParallel : 1,
      failFast: strategy["fail-fast"] === true,
      isMatrixGroup: true,
    };
  }

  /**
   * まだ結果を持たないジョブをキャンセルとして登録
   */
  private markJobsCancelled(jobIds: string[]): void {
    for (const jobId of jobIds) {
      if (this.results.has(jobId)) {
        continue;
      }

      const expanded = this.expandedJobs.get(jobId);
      if (!expanded) {
        continue;
      }

      this.completeTerminalJob(
        jobId,
        createCompletedJobResult(jobId, expanded.job.name, "cancelled"),
      );
    }
  }

  /**
   * 単一ジョブを実行
   */
  private async runJob(
    jobId: string,
    context: ExecutionContext,
  ): Promise<JobResult> {
    const expanded = this.expandedJobs.get(jobId);
    if (!expanded) {
      throw new Error(`Unknown job "${jobId}"`);
    }
    const job = expanded.job;
    const existingResult = this.results.get(jobId);
    const cancellationShortCircuitResult = this
      .getCancellationShortCircuitResult(jobId, job.name, existingResult);

    if (cancellationShortCircuitResult) {
      return cancellationShortCircuitResult;
    }

    // needs を含むジョブ固有コンテキストを構築
    const jobContext = this.buildJobContext(expanded, context);

    // 依存 skip 判定は `if` が status-check 関数を含む場合は抑制する
    // （例: `if: always()` は依存失敗時でも本ジョブを走らせる必要がある）
    const suppressDependencySkip = shouldSuppressDependencySkip(job.if);
    const needs = normalizeNeedsInput(job.needs);
    const dependencySkipReason = suppressDependencySkip
      ? null
      : this.computeDependencySkipReason(needs);

    // ジョブをスキップすべきか確認
    if (!evaluateCondition(job.if, jobContext)) {
      return this.skipJob(jobId, job.name, "Condition not met", expanded);
    }

    if (dependencySkipReason) {
      return this.skipJob(jobId, job.name, dependencySkipReason, expanded);
    }

    this.emit({ type: "job:start", jobId, job });

    const result = createInProgressJobResult(jobId, job.name);
    if (expanded.matrix) {
      result.matrix = { ...expanded.matrix };
    }
    let executionState: JobExecutionState;

    try {
      executionState = await this.executeJobStepsWithTimeout(
        job,
        jobContext,
        result,
      );
    } catch {
      executionState = { failed: true, cancelled: false };
    }

    return this.finalizeAndStoreJobResult(
      jobId,
      result,
      executionState,
      job,
      jobContext,
    );
  }

  /**
   * needs 全体から展開 ID を収集してスキップ理由を計算する。
   * - base id は expansion map 経由で展開 id 群に置換される
   * - 一つでも非成功の結果があればその理由を返す
   */
  private computeDependencySkipReason(needs: string[]): string | null {
    const expandedNeeds: string[] = [];
    for (const need of needs) {
      const targets = this.expansionMap.get(need);
      if (targets) {
        expandedNeeds.push(...targets);
      }
    }
    return getDependencySkipReason(expandedNeeds, this.results);
  }

  /**
   * キャンセル状態時、runJob の実行を短絡的に解決する
   */
  private getCancellationShortCircuitResult(
    jobId: string,
    jobName: JobResult["name"],
    existingResult?: JobResult,
  ): JobResult | undefined {
    if (existingResult?.conclusion === "cancelled") {
      return structuredClone(existingResult);
    }

    if (!this.cancelled) {
      return undefined;
    }

    if (existingResult) {
      return structuredClone(existingResult);
    }

    return this.completeTerminalJob(
      jobId,
      createCompletedJobResult(jobId, jobName, "cancelled"),
    );
  }

  /**
   * job['timeout-minutes'] を AbortController で wrap して ExecuteJobSteps を呼ぶ。
   */
  private async executeJobStepsWithTimeout(
    job: Job,
    jobContext: ExecutionContext,
    result: JobResult,
  ): Promise<JobExecutionState> {
    const jobTimeoutMinutes = job["timeout-minutes"];
    if (
      jobTimeoutMinutes === undefined ||
      jobTimeoutMinutes === null ||
      jobTimeoutMinutes <= 0
    ) {
      return this.executeJobSteps(job, jobContext, result);
    }

    const controller = new AbortController();
    const timeoutMs = jobTimeoutMinutes * MINUTES_TO_MS;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    // Deno の timer を unref してテスト終了を妨げない（存在しない環境は無視）
    const denoRef =
      (globalThis as { Deno?: { unrefTimer?: (id: number) => void } }).Deno;
    try {
      const timerId = Number(timer);
      if (Number.isFinite(timerId)) {
        denoRef?.unrefTimer?.(timerId);
      }
    } catch {
      // unrefTimer が無い環境は無視
    }

    try {
      return await this.executeJobSteps(
        job,
        jobContext,
        result,
        controller.signal,
      );
    } finally {
      clearTimeout(timer);
      if (timedOut) {
        result.steps[result.steps.length - 1] ??= {
          status: "completed",
          conclusion: "failure",
          outputs: {},
        };
        const last = result.steps[result.steps.length - 1];
        if (last && !last.error) {
          last.error = `Job timed out after ${jobTimeoutMinutes} minute(s)`;
        }
      }
    }
  }

  /**
   * ジョブの全ステップを実行し、最終実行状態を返す
   */
  private async executeJobSteps(
    job: Job,
    jobContext: ExecutionContext,
    result: JobResult,
    abortSignal?: AbortSignal,
  ): Promise<JobExecutionState> {
    const executionState: JobExecutionState = {
      failed: false,
      cancelled: false,
    };

    // ジョブ単位で観測する状態: success -> failure への単方向遷移
    let jobStatus: "success" | "failure" | "cancelled" = jobContext.job.status;
    let jobFailedStep = false;
    let workflowShouldCancel = false;

    for (let i = 0; i < job.steps.length; i++) {
      if (this.cancelled) {
        executionState.cancelled = true;
        jobStatus = "cancelled";
        // キャンセル状態でも after-failure / always cleanup を実行する余地を残す
        // が、scheduler 全体がキャンセルされている場合は中断する。
        break;
      }
      if (abortSignal?.aborted) {
        jobStatus = "cancelled";
        executionState.cancelled = false;
        executionState.failed = true;
        break;
      }

      const step = job.steps[i];

      // 既にジョブが失敗している場合、次の step は:
      // - `if` に status-check 関数 (always/failure/cancelled) を含む: 実行
      // - 含まない: skip
      // これにより cleanup や必ず走る通知ステップが機能する。
      if (jobFailedStep) {
        const hasStatusCheck = shouldSuppressDependencySkip(step.if);
        if (!hasStatusCheck) {
          // 通常 step は失敗以降 skip 扱いにする
          const skipped: typeof result.steps[number] = {
            id: step.id,
            name: step.name,
            status: "completed",
            conclusion: "skipped",
            outcome: "skipped",
            outputs: {},
          };
          result.steps.push(skipped);
          continue;
        }
      }

      const stepContext = this.buildStepContext(jobContext, result);
      const stepResult = await this.stepRunner.runStep(step, stepContext, {
        index: i,
        jobStatus,
        jobDefaults: job.defaults,
      });
      result.steps.push(stepResult);

      if (stepResult.conclusion === "failure" && jobStatus === "success") {
        jobStatus = "failure";
      }

      const stepControl = classifyStepControl(
        step,
        stepResult,
        this.options.failFast ?? true,
      );
      if (!stepControl.shouldStopJob) {
        continue;
      }

      if (stepControl.shouldMarkJobFailed) {
        executionState.failed = true;
        jobFailedStep = true;
      }
      if (stepControl.shouldCancelWorkflow) {
        // workflow レベルのキャンセルは残ステップの cleanup を完了した後に行う
        workflowShouldCancel = true;
      }
      // 残ステップには status-check cleanup があるかもしれないので継続
      continue;
    }

    if (abortSignal?.aborted) {
      executionState.failed = true;
    }

    if (workflowShouldCancel) {
      this.cancelled = true;
    }

    return executionState;
  }

  /**
   * 完了したジョブ結果を最終化して保存
   */
  private finalizeAndStoreJobResult(
    jobId: string,
    result: JobResult,
    executionState: JobExecutionState,
    job?: Job,
    jobContext?: ExecutionContext,
  ): JobResult {
    finalizeJobResult(result, executionState, { job, jobContext });
    return this.completeTerminalJob(jobId, result);
  }

  /**
   * スキップ結果を作成・保存・通知
   */
  private skipJob(
    jobId: string,
    jobName: JobResult["name"],
    reason: string,
    expanded?: ExpandedJob,
  ): JobResult {
    const skipped = createCompletedJobResult(jobId, jobName, "skipped");
    if (expanded?.matrix) {
      skipped.matrix = { ...expanded.matrix };
    }
    return this.completeTerminalJob(jobId, skipped, { skipReason: reason });
  }

  /**
   * 終端ジョブ結果を保存し、終端イベントを送信
   */
  private completeTerminalJob(
    jobId: string,
    result: JobResult,
    options: { skipReason?: string } = {},
  ): JobResult {
    const storedResult = structuredClone(result);
    this.results.set(jobId, storedResult);
    this.emitTerminalObservationEvents(
      jobId,
      storedResult,
      options.skipReason,
    );
    return structuredClone(storedResult);
  }

  /**
   * ジョブの終端観測イベントを送信
   */
  private emitTerminalObservationEvents(
    jobId: string,
    storedResult: JobResult,
    skipReason?: string,
  ): void {
    if (skipReason !== undefined) {
      this.emit({
        type: "job:skip",
        jobId,
        reason: skipReason,
        result: structuredClone(storedResult),
      });
    }

    this.emit({
      type: "job:complete",
      jobId,
      result: structuredClone(storedResult),
    });
  }

  /**
   * needs 情報付きの実行コンテキストを構築
   */
  private buildJobContext(
    expanded: ExpandedJob,
    context: ExecutionContext,
  ): ExecutionContext {
    const job = expanded.job;
    const needs = normalizeNeedsInput(job.needs);
    // 展開先 id を経由して needs context を集約する
    const expandedNeeds: string[] = [];
    for (const need of needs) {
      const targets = this.expansionMap.get(need);
      if (targets) {
        expandedNeeds.push(...targets);
      }
    }
    const needsContext = buildNeedsContext(expandedNeeds, this.results);
    // base id 参照もサポートするため、重複しない形で上書きする
    // 展開されたエントリ全てが success なら base id = success にする
    for (const need of needs) {
      const targets = this.expansionMap.get(need);
      if (!targets || targets.length === 0) continue;
      if (needsContext[need] !== undefined) continue;
      let aggregatedResult: "success" | "failure" | "cancelled" | "skipped" =
        "success";
      const aggregatedOutputs: Record<string, string> = {};
      for (const target of targets) {
        const targetContext = needsContext[target];
        if (!targetContext) continue;
        Object.assign(aggregatedOutputs, targetContext.outputs);
        if (targetContext.result === "failure") {
          aggregatedResult = "failure";
        } else if (
          targetContext.result === "cancelled" &&
          aggregatedResult !== "failure"
        ) {
          aggregatedResult = "cancelled";
        } else if (
          targetContext.result === "skipped" &&
          aggregatedResult === "success"
        ) {
          aggregatedResult = "skipped";
        }
      }
      needsContext[need] = {
        outputs: aggregatedOutputs,
        result: aggregatedResult,
      };
    }

    const baseContext = buildJobExecutionContext(context, needsContext, [
      context.env,
      this.workflow.env,
      job.env,
    ]);

    // matrix / strategy を context に反映
    const withMatrix: ExecutionContext = {
      ...baseContext,
      matrix: expanded.matrix ? { ...expanded.matrix } : undefined,
      strategy: expanded.strategy ? { ...expanded.strategy } : undefined,
    };

    return withMatrix;
  }

  /**
   * 前ステップ出力付きのステップコンテキストを構築
   */
  private buildStepContext(
    jobContext: ExecutionContext,
    jobResult: JobResult,
  ): ExecutionContext {
    const stepsContext = buildStepsContext(jobResult.steps);

    return {
      ...jobContext,
      steps: stepsContext,
    };
  }

  /**
   * 現在の結果を取得
   */
  getResults(): Record<string, JobResult> {
    return structuredClone(Object.fromEntries(this.results));
  }

  /**
   * 全体結論を取得
   */
  getConclusion(): Conclusion {
    let hasFailure = false;
    for (const result of this.results.values()) {
      if (result.conclusion === "failure") {
        hasFailure = true;
        break;
      }
    }

    if (hasFailure) {
      return "failure";
    }

    if (this.cancelled) {
      return "cancelled";
    }

    return "success";
  }
}

/**
 * ワークフロー実行計画を作成
 */
export function createExecutionPlan(workflow: Workflow): ExecutionPlan {
  // matrix 展開を適用した実行計画
  const { jobs, expansionMap } = buildExpandedJobs(workflow);
  // サイクル検査は元グラフでも行う。
  buildDependencyGraph(workflow);
  const graph = buildExpandedDependencyGraph(jobs, expansionMap);
  const phases = groupIntoPhases(graph);
  return { phases };
}
