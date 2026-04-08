/**
 * ジョブポリシーヘルパー（コンテキスト生成・結果生成・ステップ制御）
 */
import type {
  Job,
  JobContext,
  JobResult,
  ExecutionContext,
  Conclusion,
  Step,
  StepResult,
} from '../workflow-models.ts';
import { interpolateString } from '../parser/expression.ts';

// --- ジョブ実行状態 ---

export interface JobExecutionState {
  failed: boolean;
  cancelled: boolean;
}

export interface StepControl {
  shouldStopJob: boolean;
  shouldMarkJobFailed: boolean;
  shouldCancelWorkflow: boolean;
}

/**
 * needs の結果を集約して job.status の初期値を決定する。
 * 優先順位: failure > cancelled > success
 * needs が空の場合は success。
 */
export function computeInitialJobStatus(
  needsContext: ExecutionContext['needs']
): JobContext['status'] {
  let worst: JobContext['status'] = 'success';
  for (const entry of Object.values(needsContext)) {
    if (entry.result === 'failure') {
      return 'failure';
    }
    if (entry.result === 'cancelled') {
      worst = 'cancelled';
    }
  }
  return worst;
}

// --- ジョブコンテキストヘルパー ---

type NeedsResult = ExecutionContext['needs'][string]['result'];

function normalizeNeedsResult(conclusion: JobResult['conclusion']): NeedsResult {
  if (
    conclusion === 'failure' ||
    conclusion === 'cancelled' ||
    conclusion === 'skipped'
  ) {
    return conclusion;
  }
  return 'success';
}

export function buildNeedsContext(
  needs: string[],
  results: ReadonlyMap<string, JobResult>
): ExecutionContext['needs'] {
  const needsContext: ExecutionContext['needs'] = {};

  for (const need of needs) {
    const needResult = results.get(need);
    if (!needResult) {
      continue;
    }

    needsContext[need] = {
      outputs: { ...needResult.outputs },
      result: normalizeNeedsResult(needResult.conclusion),
    };
  }

  return needsContext;
}

export function buildJobExecutionContext(
  context: ExecutionContext,
  needsContext: ExecutionContext['needs'],
  envSources: Array<Record<string, string> | undefined>
): ExecutionContext {
  const env = Object.assign(
    {},
    ...envSources.filter((source): source is Record<string, string> => Boolean(source))
  );

  return {
    ...context,
    env,
    needs: needsContext,
    job: {
      ...context.job,
      status: computeInitialJobStatus(needsContext),
    },
    steps: {},
  };
}

export function buildStepsContext(stepResults: StepResult[]): ExecutionContext['steps'] {
  const stepsContext: ExecutionContext['steps'] = {};

  for (const stepResult of stepResults) {
    if (stepResult.id) {
      const conclusion = stepResult.conclusion || 'success';
      // outcome は continue-on-error による書き換え前の生結果。
      // StepResult に outcome が無い（後方互換）場合は conclusion を使う。
      const outcome = stepResult.outcome ?? conclusion;
      stepsContext[stepResult.id] = {
        outputs: { ...stepResult.outputs },
        outcome,
        conclusion,
      };
    }
  }

  return stepsContext;
}

// --- 結果ファクトリ ---

export function createCompletedJobResult(
  id: string,
  name: string | undefined,
  conclusion: Conclusion
): JobResult {
  return {
    id,
    name,
    steps: [],
    outputs: {},
    status: 'completed',
    conclusion,
  };
}

export function createInProgressJobResult(
  id: string,
  name: string | undefined
): JobResult {
  return {
    id,
    name,
    steps: [],
    outputs: {},
    status: 'in_progress',
    startedAt: new Date(),
  };
}

// --- ステップ制御の分類 ---

export function classifyStepControl(
  step: Step,
  result: StepResult,
  failFast: boolean
): StepControl {
  const shouldStopJob = result.conclusion === 'failure' && !step['continue-on-error'];
  return {
    shouldStopJob,
    shouldMarkJobFailed: shouldStopJob,
    shouldCancelWorkflow: shouldStopJob && failFast,
  };
}

// --- 出力収集 ---

export function collectStepOutputs(steps: StepResult[]): Record<string, string> {
  const outputs: Record<string, string> = {};

  for (const stepResult of steps) {
    if (!stepResult.id) {
      continue;
    }
    Object.assign(outputs, stepResult.outputs);
  }

  return outputs;
}

// --- ジョブ最終化 ---

/**
 * `job.outputs` 宣言を steps コンテキスト経由で評価する。
 * 定義されていなければ null を返す（呼び出し側が fallback 動作を選択する）。
 */
export function evaluateJobOutputs(
  job: Job,
  stepsContext: ExecutionContext['steps'],
  context: ExecutionContext
): Record<string, string> | null {
  if (!job.outputs) {
    return null;
  }

  const outputContext: ExecutionContext = {
    ...context,
    steps: stepsContext,
  };

  const resolved: Record<string, string> = {};
  for (const [key, template] of Object.entries(job.outputs)) {
    if (typeof template !== 'string') {
      continue;
    }
    resolved[key] = interpolateString(template, outputContext);
  }

  return resolved;
}

export function finalizeJobResult(
  result: JobResult,
  executionState: JobExecutionState,
  options: {
    job?: Job;
    jobContext?: ExecutionContext;
  } = {}
): void {
  result.status = 'completed';
  result.conclusion = executionState.cancelled
    ? 'cancelled'
    : executionState.failed
      ? 'failure'
      : 'success';
  result.completedAt = new Date();

  // job.outputs が定義されていればそれを steps コンテキストで評価して優先する。
  // 未定義なら従来通り step 出力を last-writer-wins でフラット化する。
  if (options.job && options.jobContext) {
    const stepsContext = buildStepsContext(result.steps);
    const resolvedOutputs = evaluateJobOutputs(
      options.job,
      stepsContext,
      options.jobContext
    );
    if (resolvedOutputs !== null) {
      result.outputs = resolvedOutputs;
      return;
    }
  }

  result.outputs = collectStepOutputs(result.steps);
}

// --- 依存スキップ判定 ---

export function getDependencySkipReason(
  needs: string[],
  results: ReadonlyMap<string, JobResult>
): string | null {
  for (const need of needs) {
    const dependencyResult = results.get(need);
    if (!dependencyResult) {
      continue;
    }

    if (dependencyResult.conclusion === 'success') {
      continue;
    }

    const dependencyOutcome = dependencyResult.conclusion ?? 'did not succeed';
    return `Dependency "${need}" ${dependencyOutcome}`;
  }

  return null;
}
