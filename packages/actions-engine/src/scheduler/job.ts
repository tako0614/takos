/**
 * Job scheduler and execution management
 */
import type {
  Workflow,
  Job,
  JobResult,
  ExecutionPlan,
  ExecutionContext,
  Conclusion,
  Step,
  StepResult,
} from '../types.js';
import { evaluateCondition } from '../parser/expression.js';
import {
  buildDependencyGraph,
  groupIntoPhases,
  type DependencyGraph,
} from './dependency.js';
import { StepRunner, type StepRunnerOptions } from './step.js';

// --- Listener registry ---

export type EventListener<TEvent> = (event: TEvent) => void;

export interface ListenerRegistry<
  TEvent,
  TListener extends EventListener<TEvent> = EventListener<TEvent>,
> {
  on(listener: TListener): () => void;
  emit(event: TEvent): void;
}

export function createListenerRegistry<
  TEvent,
  TListener extends EventListener<TEvent> = EventListener<TEvent>,
>(): ListenerRegistry<TEvent, TListener> {
  const listeners: TListener[] = [];

  return {
    on(listener: TListener): () => void {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
    emit(event: TEvent): void {
      const listenersSnapshot = [...listeners];
      for (const listener of listenersSnapshot) {
        try {
          listener(event);
        } catch {
          // Ignore listener errors
        }
      }
    },
  };
}

// --- Job context helpers ---

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

// --- normalizeNeedsInput ---

export function normalizeNeedsInput(needs: unknown): string[] {
  if (typeof needs === 'string') return [needs];
  if (Array.isArray(needs)) return needs.filter((need): need is string => typeof need === 'string');
  return [];
}

// --- Job policy helpers ---

export interface JobExecutionState {
  failed: boolean;
  cancelled: boolean;
}

export interface StepControl {
  shouldStopJob: boolean;
  shouldMarkJobFailed: boolean;
  shouldCancelWorkflow: boolean;
}

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

function collectStepOutputs(steps: StepResult[]): Record<string, string> {
  const outputs: Record<string, string> = {};

  for (const stepResult of steps) {
    if (!stepResult.id) {
      continue;
    }
    Object.assign(outputs, stepResult.outputs);
  }

  return outputs;
}

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

// --- End job policy helpers ---

/**
 * Job scheduler options
 */
export interface JobSchedulerOptions {
  /** Maximum parallel jobs (0 = unlimited) */
  maxParallel?: number;
  /** Fail fast - cancel remaining jobs on first failure */
  failFast?: boolean;
  /** Step runner options */
  stepRunner?: StepRunnerOptions;
}

/**
 * Job scheduler event types
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
 * Job scheduler event listener
 */
export type JobSchedulerListener = (event: JobSchedulerEvent) => void;

/**
 * Job scheduler for workflow execution
 */
export class JobScheduler {
  private workflow: Workflow;
  private options: JobSchedulerOptions;
  private graph: DependencyGraph;
  private results: Map<string, JobResult>;
  private listenerRegistry: ListenerRegistry<JobSchedulerEvent, JobSchedulerListener>;
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
    this.listenerRegistry =
      createListenerRegistry<JobSchedulerEvent, JobSchedulerListener>();
    this.cancelled = false;
    this.running = false;
    this.stepRunner = new StepRunner(this.options.stepRunner);
  }

  /**
   * Add event listener
   */
  on(listener: JobSchedulerListener): () => void {
    return this.listenerRegistry.on(listener);
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: JobSchedulerEvent): void {
    this.listenerRegistry.emit(event);
  }

  /**
   * Cancel workflow execution
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Reset scheduler runtime state for a new run.
   * Keeps listeners and configuration intact.
   */
  private reset(): void {
    this.results.clear();
    this.cancelled = false;
  }

  /**
   * Create execution plan
   */
  createPlan(): ExecutionPlan {
    // groupIntoPhases already detects cycles via assertAcyclic
    const phases = groupIntoPhases(this.graph);

    return { phases };
  }

  /**
   * Run all jobs in workflow
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

        // Run jobs in phase (potentially in parallel)
        await this.runPhase(phase, context);

        this.emit({ type: 'phase:complete', phase: phaseIndex });

        // Check for failures in fail-fast mode
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
   * Run jobs in a single phase
   */
  private async runPhase(
    jobIds: string[],
    context: ExecutionContext
  ): Promise<void> {
    const maxParallel = this.options.maxParallel || jobIds.length;
    const chunks: string[][] = [];

    // Split into chunks based on max parallel
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
   * Mark pending chunks as cancelled from the specified index.
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
   * Mark jobs as cancelled if they don't already have a result.
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
   * Run a single job
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

    // Build job-specific context with needs
    const jobContext = this.buildJobContext(jobId, context);

    // Check if job should be skipped
    if (!evaluateCondition(job.if, jobContext)) {
      return this.skipJob(jobId, job.name, 'Condition not met');
    }

    // Dependencies are success-only: any non-success dependency conclusion skips this job.
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
   * Resolve runJob short-circuit result when cancellation state allows bypassing execution.
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
   * Execute all steps for a job and return the final execution state.
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
   * Finalize and record a completed job result.
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
   * Create, store, and emit skip result for a job.
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
   * Store terminal job result and emit terminal job events.
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
   * Emit terminal observation events for a job.
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
   * Build execution context with needs data
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
   * Build step context with previous step outputs
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
   * Get current results
   */
  getResults(): Record<string, JobResult> {
    return structuredClone(Object.fromEntries(this.results));
  }

  /**
   * Get overall conclusion
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
 * Create execution plan for workflow
 */
export function createExecutionPlan(workflow: Workflow): ExecutionPlan {
  const graph = buildDependencyGraph(workflow);
  const phases = groupIntoPhases(graph);
  return { phases };
}

