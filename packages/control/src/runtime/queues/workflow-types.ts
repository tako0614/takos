import type { D1Database, R2Bucket, DurableObjectNamespace, Queue } from '../../shared/types/bindings.ts';
import type { Conclusion } from '@takos/actions-engine';
import type { StepResult } from '../../application/services/execution/workflow-engine';
import type { DbEnv, WorkflowJobQueueMessage } from '../../shared/types';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export type WorkflowQueueEnv = DbEnv & {
  RUNTIME_HOST?: { fetch(request: Request): Promise<Response> };
  GIT_OBJECTS?: R2Bucket;
  RUN_NOTIFIER: DurableObjectNamespace;
  WORKFLOW_QUEUE?: Queue<WorkflowJobQueueMessage>;
  ENCRYPTION_KEY?: string;
  /** When truthy, workflow steps are executed in parallel where dependencies allow. */
  PARALLEL_WORKFLOW_STEPS?: string;
};

export type WorkflowEngineBucket = Parameters<
  typeof import('../../application/services/execution/workflow-engine').createWorkflowEngine
>[0]['bucket'];

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
  runtimeWorkspaceId: string | null;
  completionConclusion: Conclusion | null;
  logs: string[];
  stepResults: StepResult[];
  stepOutputs: Record<string, Record<string, string>>;
}

export interface JobContext {
  env: WorkflowQueueEnv;
  engine: import('../../application/services/execution/workflow-engine').WorkflowEngine;
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
    runtimeWorkspaceId: null,
    completionConclusion: null,
    logs: [],
    stepResults: [],
    stepOutputs: {},
  };
}

// ---------------------------------------------------------------------------
// Step execution types
// ---------------------------------------------------------------------------

export type WorkflowShell = import('../../shared/types').WorkflowShell;

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
