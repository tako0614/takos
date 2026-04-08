import type { D1Database as _D1Database, R2Bucket, DurableObjectNamespace, Queue } from '../../shared/types/bindings.ts';
import type { Conclusion } from 'takos-actions-engine';
import type { WorkflowStepResult } from '../../application/services/execution/workflow-engine.ts';
import type { DbEnv, WorkflowJobQueueMessage, WorkflowShell } from '../../shared/types/index.ts';
import type { WorkflowBucket } from '../../application/services/execution/workflow-engine-types.ts';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export type WorkflowQueueEnv = DbEnv & {
  RUNTIME_HOST?: { fetch(request: Request): Promise<Response> };
  GIT_OBJECTS?: R2Bucket;
  RUN_NOTIFIER: DurableObjectNamespace;
  WORKFLOW_QUEUE?: Queue<WorkflowJobQueueMessage>;
  ENCRYPTION_KEY?: string;
  /**
   * Opt-in: when truthy, workflow steps within a job are executed in parallel
   * via `parallel-steps.ts` based on a dependency graph built from
   * `steps.<id>` references in `if:` conditions and `with:` interpolations.
   *
   * Sequential mode (default) uses `state.stepOutputs` inline so each later
   * step can reference the previous one's output. Parallel mode runs
   * independent steps concurrently and only waits for steps it directly
   * depends on. This changes semantics around `if: ${{ steps.X.outputs.Y }}`
   * before X has run, and around `continue-on-error` propagation. Off until
   * the runner contract is documented enough for workflow authors to opt in
   * confidently.
   */
  PARALLEL_WORKFLOW_STEPS?: string;
};

export type WorkflowEngineBucket = WorkflowBucket;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface RunContext {
  workflowPath: string;
  inputs: Record<string, unknown>;
}

export type WorkflowEventType = 'workflow.job.started' | 'workflow.job.completed';

export interface JobCompletedEventData {
  runId: string;
  jobId: string;
  repoId: string;
  jobKey: string;
  name?: string;
  status: 'completed';
  conclusion: Conclusion;
  completedAt: string;
  dlq?: boolean;
  attempts?: number | null;
}

export interface JobStartedEventData {
  runId: string;
  jobId: string;
  repoId: string;
  jobKey: string;
  name: string;
  startedAt: string;
}

export type WorkflowEventData = JobCompletedEventData | JobStartedEventData;

export interface QueueBatchMessage {
  body: unknown;
  ack: () => void;
  retry: () => void;
}

// ---------------------------------------------------------------------------
// Job execution state & context
// ---------------------------------------------------------------------------

export interface JobExecutionState {
  jobConclusion: Conclusion;
  runtimeStarted: boolean;
  runtimeCancelled: boolean;
  runtimeSpaceId: string | null;
  completionConclusion: Conclusion | null;
  logs: string[];
  stepResults: WorkflowStepResult[];
  stepOutputs: Record<string, Record<string, string>>;
}

export interface JobQueueContext {
  env: WorkflowQueueEnv;
  engine: import('../../application/services/execution/workflow-engine.ts').WorkflowEngine;
  message: WorkflowJobQueueMessage;
  jobName: string;
  effectiveJobEnv: Record<string, string>;
  startedAt: string;
  runContext: RunContext;
  runtimeConfigured: boolean;
}

export function createInitialState(): JobExecutionState {
  return {
    jobConclusion: 'success',
    runtimeStarted: false,
    runtimeCancelled: false,
    runtimeSpaceId: null,
    completionConclusion: null,
    logs: [],
    stepResults: [],
    stepOutputs: {},
  };
}

// ---------------------------------------------------------------------------
// Step execution types
// ---------------------------------------------------------------------------

export type { WorkflowShell };

export interface StepExecutionContext {
  env: WorkflowQueueEnv;
  jobId: string;
  stepNumber: number;
  spaceId: string;
  shell?: WorkflowShell;
  workingDirectory?: string;
}

export interface StepExecutionResult {
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  outputs?: Record<string, string>;
}

export interface RuntimeStepResponse {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  outputs?: Record<string, string>;
  conclusion?: 'success' | 'failure' | 'skipped';
}

// ---------------------------------------------------------------------------
// Expression contexts
// ---------------------------------------------------------------------------

export interface ConditionContext {
  env?: Record<string, string>;
  steps?: Record<string, Record<string, string>>;
  job?: { status: string };
  inputs?: Record<string, unknown>;
}

export interface ExpressionContext {
  steps?: Record<string, Record<string, string>>;
  inputs?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// DurableObject fetch helper type
// ---------------------------------------------------------------------------

export type DurableObjectFetchLike = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export function asDurableObjectFetcher(
  stub: unknown,
): DurableObjectFetchLike {
  return stub as unknown as DurableObjectFetchLike;
}
