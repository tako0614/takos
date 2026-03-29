import type { JobExecutionState, JobQueueContext } from './workflow-types';
export declare function handleJobSkipped(ctx: JobQueueContext, state: JobExecutionState): Promise<boolean>;
export declare function executeStepLoop(ctx: JobQueueContext, state: JobExecutionState): Promise<'cancelled' | void>;
export declare function completeJobSuccess(ctx: JobQueueContext, state: JobExecutionState): Promise<void>;
export declare function completeJobFailure(ctx: JobQueueContext, state: JobExecutionState, err: unknown): Promise<void>;
//# sourceMappingURL=workflow-job-phases.d.ts.map