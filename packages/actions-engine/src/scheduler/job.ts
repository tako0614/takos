/**
 * ジョブスケジューラと実行管理
 */
import type {
  Workflow,
  Job,
  JobResult,
  ExecutionPlan,
  ExecutionContext,
  Conclusion,
} from '../workflow-models.js';
import { evaluateCondition } from '../parser/expression.js';
import {
  buildDependencyGraph,
  groupIntoPhases,
  type DependencyGraph,
} from './dependency.js';
import { StepRunner, type StepRunnerOptions } from './step.js';
import {
  buildNeedsContext,
  buildJobExecutionContext,
  buildStepsContext,
  createCompletedJobResult,
  createInProgressJobResult,
  classifyStepControl,
  finalizeJobResult,
  getDependencySkipReason,
  type JobExecutionState,
} from './job-policy.js';

// --- needsInput 正規化 ---

export function normalizeNeedsInput(needs: unknown): string[] {
  if (typeof needs === 'string') return [needs];
  if (Array.isArray(needs)) return needs.filter((need): need is string => typeof need === 'string');
  return [];
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
  | { type: 'job:start'; jobId: string; job: Job }
  | { type: 'job:complete'; jobId: string; result: JobResult }
  | { type: 'job:skip'; jobId: string; reason: string; result: JobResult }
  | { type: 'phase:start'; phase: number; jobs: string[] }
  | { type: 'phase:complete'; phase: number }
  | { type: 'workflow:start'; phases: string[][] }
  | { type: 'workflow:complete'; results: Record<string, JobResult> };

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
  private graph: DependencyGraph;
  private results: Map<string, JobResult>;
  private listeners: JobSchedulerListener[];
  private cancelled: boolean;
  private running: boolean;
  private stepRunner: StepRunner;

  constructor(workflow: Workflow, options: JobSchedulerOptions = {}) {
    this.workflow = workflow;
    this.options = {
      maxParallel: options.maxParallel ?? 0,
      failFast: options.failFast ?? true,
      stepRunner: options.stepRunner ?? {},
    };
    this.graph = buildDependencyGraph(workflow);
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
      throw new Error('JobScheduler is already running');
    }

    this.running = true;
    this.reset();

    try {
      const plan = this.createPlan();
      this.emit({ type: 'workflow:start', phases: plan.phases });

      for (let phaseIndex = 0; phaseIndex < plan.phases.length; phaseIndex++) {
        if (this.cancelled) break;

        const phase = plan.phases[phaseIndex];
        this.emit({ type: 'phase:start', phase: phaseIndex, jobs: phase });

        // フェーズ内ジョブを実行（必要に応じ並列）
        await this.runPhase(phase, context);

        this.emit({ type: 'phase:complete', phase: phaseIndex });

        // フェイルファストモードで失敗を確認
        if (this.options.failFast) {
          const phaseFailed = phase.some(
            (jobId) => this.results.get(jobId)?.conclusion === 'failure'
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
        type: 'workflow:complete',
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
    context: ExecutionContext
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
    startIndex: number
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

      this.completeTerminalJob(
        jobId,
        createCompletedJobResult(
          jobId,
          this.workflow.jobs[jobId].name,
          'cancelled'
        )
      );
    }
  }

  /**
   * 単一ジョブを実行
   */
  private async runJob(
    jobId: string,
    context: ExecutionContext
  ): Promise<JobResult> {
    const job = this.workflow.jobs[jobId];
    const existingResult = this.results.get(jobId);
    const cancellationShortCircuitResult =
      this.getCancellationShortCircuitResult(jobId, job.name, existingResult);

    if (cancellationShortCircuitResult) {
      return cancellationShortCircuitResult;
    }

    // needs を含むジョブ固有コンテキストを構築
    const jobContext = this.buildJobContext(jobId, context);

    // ジョブをスキップすべきか確認
    if (!evaluateCondition(job.if, jobContext)) {
      return this.skipJob(jobId, job.name, 'Condition not met');
    }

    // 依存ジョブは成功時のみ継続扱い。非成功時は本ジョブをスキップ。
    const needs = normalizeNeedsInput(job.needs);
    const dependencySkipReason = getDependencySkipReason(needs, this.results);
    if (dependencySkipReason) {
      return this.skipJob(jobId, job.name, dependencySkipReason);
    }

    this.emit({ type: 'job:start', jobId, job });

    const result = createInProgressJobResult(jobId, job.name);
    let executionState: JobExecutionState;

    try {
      executionState = await this.executeJobSteps(job, jobContext, result);
    } catch {
      executionState = { failed: true, cancelled: false };
    }

    return this.finalizeAndStoreJobResult(jobId, result, executionState);
  }

  /**
   * キャンセル状態時、runJob の実行を短絡的に解決する
   */
  private getCancellationShortCircuitResult(
    jobId: string,
    jobName: JobResult['name'],
    existingResult?: JobResult
  ): JobResult | undefined {
    if (existingResult?.conclusion === 'cancelled') {
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
      createCompletedJobResult(jobId, jobName, 'cancelled')
    );
  }

  /**
   * ジョブの全ステップを実行し、最終実行状態を返す
   */
  private async executeJobSteps(
    job: Job,
    jobContext: ExecutionContext,
    result: JobResult
  ): Promise<JobExecutionState> {
    const executionState: JobExecutionState = { failed: false, cancelled: false };

    for (let i = 0; i < job.steps.length; i++) {
      if (this.cancelled) {
        executionState.cancelled = true;
        break;
      }

      const step = job.steps[i];
      const stepContext = this.buildStepContext(jobContext, result);
      const stepResult = await this.stepRunner.runStep(step, stepContext, {
        index: i,
      });
      result.steps.push(stepResult);

      const stepControl = classifyStepControl(
        step,
        stepResult,
        this.options.failFast ?? true
      );
      if (!stepControl.shouldStopJob) {
        continue;
      }

      if (stepControl.shouldMarkJobFailed) {
        executionState.failed = true;
      }
      if (stepControl.shouldCancelWorkflow) {
        this.cancelled = true;
      }
      break;
    }

    return executionState;
  }

  /**
   * 完了したジョブ結果を最終化して保存
   */
  private finalizeAndStoreJobResult(
    jobId: string,
    result: JobResult,
    executionState: JobExecutionState
  ): JobResult {
    finalizeJobResult(result, executionState);
    return this.completeTerminalJob(jobId, result);
  }

  /**
   * スキップ結果を作成・保存・通知
   */
  private skipJob(
    jobId: string,
    jobName: JobResult['name'],
    reason: string
  ): JobResult {
    return this.completeTerminalJob(
      jobId,
      createCompletedJobResult(jobId, jobName, 'skipped'),
      { skipReason: reason }
    );
  }

  /**
   * 終端ジョブ結果を保存し、終端イベントを送信
   */
  private completeTerminalJob(
    jobId: string,
    result: JobResult,
    options: { skipReason?: string } = {}
  ): JobResult {
    const storedResult = structuredClone(result);
    this.results.set(jobId, storedResult);
    this.emitTerminalObservationEvents(
      jobId,
      storedResult,
      options.skipReason
    );
    return structuredClone(storedResult);
  }

  /**
   * ジョブの終端観測イベントを送信
   */
  private emitTerminalObservationEvents(
    jobId: string,
    storedResult: JobResult,
    skipReason?: string
  ): void {
    if (skipReason !== undefined) {
      this.emit({
        type: 'job:skip',
        jobId,
        reason: skipReason,
        result: structuredClone(storedResult),
      });
    }

    this.emit({
      type: 'job:complete',
      jobId,
      result: structuredClone(storedResult),
    });
  }

  /**
   * needs 情報付きの実行コンテキストを構築
   */
  private buildJobContext(
    jobId: string,
    context: ExecutionContext
  ): ExecutionContext {
    const job = this.workflow.jobs[jobId];
    const needs = normalizeNeedsInput(job.needs);
    const needsContext = buildNeedsContext(needs, this.results);
    return buildJobExecutionContext(context, needsContext, [
      context.env,
      this.workflow.env,
      job.env,
    ]);
  }

  /**
   * 前ステップ出力付きのステップコンテキストを構築
   */
  private buildStepContext(
    jobContext: ExecutionContext,
    jobResult: JobResult
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
      if (result.conclusion === 'failure') {
        hasFailure = true;
        break;
      }
    }

    if (hasFailure) {
      return 'failure';
    }

    if (this.cancelled) {
      return 'cancelled';
    }

    return 'success';
  }
}

/**
 * ワークフロー実行計画を作成
 */
export function createExecutionPlan(workflow: Workflow): ExecutionPlan {
  const graph = buildDependencyGraph(workflow);
  const phases = groupIntoPhases(graph);
  return { phases };
}
