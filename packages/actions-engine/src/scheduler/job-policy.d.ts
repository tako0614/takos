/**
 * Job policy helpers — context builders, result factories, and step-control logic.
 */
import type { JobResult, ExecutionContext, Conclusion, Step, StepResult } from '../workflow-models.js';
export interface JobExecutionState {
    failed: boolean;
    cancelled: boolean;
}
export interface StepControl {
    shouldStopJob: boolean;
    shouldMarkJobFailed: boolean;
    shouldCancelWorkflow: boolean;
}
export declare function buildNeedsContext(needs: string[], results: ReadonlyMap<string, JobResult>): ExecutionContext['needs'];
export declare function buildJobExecutionContext(context: ExecutionContext, needsContext: ExecutionContext['needs'], envSources: Array<Record<string, string> | undefined>): ExecutionContext;
export declare function buildStepsContext(stepResults: StepResult[]): ExecutionContext['steps'];
export declare function createCompletedJobResult(id: string, name: string | undefined, conclusion: Conclusion): JobResult;
export declare function createInProgressJobResult(id: string, name: string | undefined): JobResult;
export declare function classifyStepControl(step: Step, result: StepResult, failFast: boolean): StepControl;
export declare function collectStepOutputs(steps: StepResult[]): Record<string, string>;
export declare function finalizeJobResult(result: JobResult, executionState: JobExecutionState): void;
export declare function getDependencySkipReason(needs: string[], results: ReadonlyMap<string, JobResult>): string | null;
//# sourceMappingURL=job-policy.d.ts.map