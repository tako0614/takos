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
  MatrixContext,
  StrategyContext,
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
import { buildMatrixJobId, expandMatrix } from "./matrix.ts";

// --- needsInput 正規化 ---

export function normalizeNeedsInput(needs: unknown): string[] {
  if (typeof needs === "string") return [needs];
  if (Array.isArray(needs)) {
    return needs.filter((need): need is string => typeof need === "string");
  }
  return [];
}

// --- マトリクス展開されたジョブ ---

/**
 * スケジューラ内部で使用する展開済みジョブ記述子。
 * matrix を持たないジョブは一件の展開エントリとして扱う。
 */
interface ExpandedJob {
  /** 展開後の一意な id (matrix がある場合は `${baseId}-${hash}` 形式) */
  id: string;
  /** 元ジョブ id */
  baseId: string;
  /** ジョブ定義 */
  job: Job;
  /** matrix context（matrix が無い場合は undefined） */
  matrix?: MatrixContext;
  /** strategy context（matrix が無い場合は undefined） */
  strategy?: StrategyContext;
}

/**
 * ワークフローを matrix 展開してスケジューラ内部で使う ExpandedJob の集合を返す。
 * - matrix が空なら元ジョブをそのまま 1 エントリにする
 * - matrix がある場合は組み合わせごとに `${baseId}-${hash}` を生成する
 */
function buildExpandedJobs(workflow: Workflow): {
  jobs: Map<string, ExpandedJob>;
  expansionMap: Map<string, string[]>;
} {
  const jobs = new Map<string, ExpandedJob>();
  const expansionMap = new Map<string, string[]>();

  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    const expansions = expandMatrix(job.strategy);

    if (expansions.length === 0) {
      // 展開が無いジョブ (matrix 未指定 or 結果 0 件) → 単独エントリ
      jobs.set(jobId, {
        id: jobId,
        baseId: jobId,
        job,
      });
      expansionMap.set(jobId, [jobId]);
      continue;
    }

    // 展開されたエントリを全て追加
    const expandedIds: string[] = [];
    for (const expansion of expansions) {
      const expandedId = buildMatrixJobId(jobId, expansion.hash);
      // 万が一 hash 衝突した場合でも一意化するための suffix
      let uniqueId = expandedId;
      let counter = 1;
      while (jobs.has(uniqueId)) {
        uniqueId = `${expandedId}-${counter}`;
        counter += 1;
      }
      jobs.set(uniqueId, {
        id: uniqueId,
        baseId: jobId,
        job,
        matrix: expansion.matrix,
        strategy: expansion.strategy,
      });
      expandedIds.push(uniqueId);
    }
    expansionMap.set(jobId, expandedIds);
  }

  return { jobs, expansionMap };
}

/**
 * 展開後ジョブ用の DependencyGraph を構築する。
 * needs 参照は展開先 ID 全てに置き換える。
 */
function buildExpandedDependencyGraph(
  expandedJobs: Map<string, ExpandedJob>,
  expansionMap: Map<string, string[]>,
): DependencyGraph {
  const nodes = new Set<string>();
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();

  for (const expanded of expandedJobs.values()) {
    nodes.add(expanded.id);
    edges.set(expanded.id, new Set());
    reverseEdges.set(expanded.id, new Set());
  }

  for (const expanded of expandedJobs.values()) {
    const needs = normalizeNeedsInput(expanded.job.needs);
    for (const need of needs) {
      const targets = expansionMap.get(need);
      if (!targets || targets.length === 0) {
        throw new Error(
          `Job "${expanded.baseId}" depends on unknown job "${need}"`,
        );
      }
      for (const target of targets) {
        if (!nodes.has(target)) {
          continue;
        }
        edges.get(expanded.id)!.add(target);
        reverseEdges.get(target)!.add(expanded.id);
      }
    }
  }

  return { nodes, edges, reverseEdges };
}

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
 * `always()` / `failure()` / `cancelled()` を含む if 条件は
 * 依存スキップの早期 return を抑制する必要がある。
 *
 * これらは expression 全体で現れるので単純な文字列マッチを行う。
 */
function shouldSuppressDependencySkip(condition: string | undefined): boolean {
  if (condition === undefined || condition === "") {
    return false;
  }
  return /\b(always|failure|cancelled)\s*\(/.test(condition);
}

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
    // 依存グラフ構築時にサイクル検査 / 未知参照検査を先に行う（後方互換性）
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
   * 単一フェーズを実行
   */
  private async runPhase(
    jobIds: string[],
    context: ExecutionContext,
  ): Promise<void> {
    const maxParallel = this.options.maxParallel || jobIds.length;
    const chunks: string[][] = [];

    // 最大同時実行数でチャンク分割
    for (let i = 0; i < jobIds.length; i += maxParallel) {
      chunks.push(jobIds.slice(i, i + maxParallel));
    }

    for (let index = 0; index < chunks.length; index++) {
      if (this.cancelled) {
        this.markPendingChunksCancelled(chunks, index);
        break;
      }

      const chunk = chunks[index];

      await Promise.all(chunk.map((jobId) => this.runJob(jobId, context)));

      if (this.cancelled) {
        this.markPendingChunksCancelled(chunks, index + 1);
        break;
      }
    }
  }

  /**
   * 指定インデックス以降の未処理チャンクをキャンセル扱いにする
   */
  private markPendingChunksCancelled(
    chunks: string[][],
    startIndex: number,
  ): void {
    for (let pending = startIndex; pending < chunks.length; pending++) {
      this.markJobsCancelled(chunks[pending]);
    }
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
  // サイクル検査は元グラフでも行う（後方互換）
  buildDependencyGraph(workflow);
  const graph = buildExpandedDependencyGraph(jobs, expansionMap);
  const phases = groupIntoPhases(graph);
  return { phases };
}
