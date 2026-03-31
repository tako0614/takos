/**
 * ジョブポリシーヘルパー（コンテキスト生成・結果生成・ステップ制御）
 */
import type {
  JobResult,
  ExecutionContext,
  Conclusion,
  Step,
  StepResult,
} from '../workflow-models.ts';

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
      status: 'success',
    },
    steps: {},
  };
}

export function buildStepsContext(stepResults: StepResult[]): ExecutionContext['steps'] {
  const stepsContext: ExecutionContext['steps'] = {};

  for (const stepResult of stepResults) {
    if (stepResult.id) {
      const conclusion = stepResult.conclusion || 'success';
      stepsContext[stepResult.id] = {
        outputs: { ...stepResult.outputs },
        outcome: conclusion,
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

export function finalizeJobResult(
  result: JobResult,
  executionState: JobExecutionState
): void {
  result.status = 'completed';
  result.conclusion = executionState.cancelled
    ? 'cancelled'
    : executionState.failed
      ? 'failure'
      : 'success';
  result.completedAt = new Date();
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
