/**
 * Job scheduler and execution management
 */
import type { Workflow, Job, JobResult, ExecutionPlan, ExecutionContext, Conclusion } from '../workflow-models.js';
import { type StepRunnerOptions } from './step.js';
export declare function normalizeNeedsInput(needs: unknown): string[];
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
export type JobSchedulerEvent = {
    type: 'job:start';
    jobId: string;
    job: Job;
} | {
    type: 'job:complete';
    jobId: string;
    result: JobResult;
} | {
    type: 'job:skip';
    jobId: string;
    reason: string;
    result: JobResult;
} | {
    type: 'phase:start';
    phase: number;
    jobs: string[];
} | {
    type: 'phase:complete';
    phase: number;
} | {
    type: 'workflow:start';
    phases: string[][];
} | {
    type: 'workflow:complete';
    results: Record<string, JobResult>;
};
/**
 * Job scheduler event listener
 */
export type JobSchedulerListener = (event: JobSchedulerEvent) => void;
/**
 * Job scheduler for workflow execution
 */
export declare class JobScheduler {
    private workflow;
    private options;
    private graph;
    private results;
    private listeners;
    private cancelled;
    private running;
    private stepRunner;
    constructor(workflow: Workflow, options?: JobSchedulerOptions);
    /**
     * Add event listener. Returns an unsubscribe function.
     */
    on(listener: JobSchedulerListener): () => void;
    /**
     * Emit event to all listeners
     */
    private emit;
    /**
     * Cancel workflow execution
     */
    cancel(): void;
    /**
     * Reset scheduler runtime state for a new run.
     * Keeps listeners and configuration intact.
     */
    private reset;
    /**
     * Create execution plan
     */
    createPlan(): ExecutionPlan;
    /**
     * Run all jobs in workflow
     */
    run(context: ExecutionContext): Promise<Record<string, JobResult>>;
    /**
     * Run jobs in a single phase
     */
    private runPhase;
    /**
     * Mark pending chunks as cancelled from the specified index.
     */
    private markPendingChunksCancelled;
    /**
     * Mark jobs as cancelled if they don't already have a result.
     */
    private markJobsCancelled;
    /**
     * Run a single job
     */
    private runJob;
    /**
     * Resolve runJob short-circuit result when cancellation state allows bypassing execution.
     */
    private getCancellationShortCircuitResult;
    /**
     * Execute all steps for a job and return the final execution state.
     */
    private executeJobSteps;
    /**
     * Finalize and record a completed job result.
     */
    private finalizeAndStoreJobResult;
    /**
     * Create, store, and emit skip result for a job.
     */
    private skipJob;
    /**
     * Store terminal job result and emit terminal job events.
     */
    private completeTerminalJob;
    /**
     * Emit terminal observation events for a job.
     */
    private emitTerminalObservationEvents;
    /**
     * Build execution context with needs data
     */
    private buildJobContext;
    /**
     * Build step context with previous step outputs
     */
    private buildStepContext;
    /**
     * Get current results
     */
    getResults(): Record<string, JobResult>;
    /**
     * Get overall conclusion
     */
    getConclusion(): Conclusion;
}
/**
 * Create execution plan for workflow
 */
export declare function createExecutionPlan(workflow: Workflow): ExecutionPlan;
//# sourceMappingURL=job.d.ts.map