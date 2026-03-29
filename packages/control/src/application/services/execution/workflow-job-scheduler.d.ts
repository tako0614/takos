/**
 * Workflow Engine – job scheduling, dependency evaluation, and status updates
 */
import type { Conclusion } from 'takos-actions-engine';
import type { WorkflowJobQueueMessage } from '../../../shared/types';
import type { D1Database, Queue } from '../../../shared/types/bindings.ts';
import type { WorkflowBucket, WorkflowJobResult, DependencyState } from './workflow-engine-types';
export declare function onJobComplete(db: D1Database, bucket: WorkflowBucket, queue: Queue<WorkflowJobQueueMessage> | undefined, jobId: string, result: WorkflowJobResult): Promise<void>;
export declare function scheduleDependentJobs(db: D1Database, bucket: WorkflowBucket, queue: Queue<WorkflowJobQueueMessage> | undefined, runId: string, completedJobKey: string): Promise<void>;
/**
 * Evaluate dependency completion and success as a set.
 */
export declare function evaluateDependencies(db: D1Database, runId: string, needs: string[]): Promise<DependencyState>;
export declare function onJobStart(db: D1Database, jobId: string, runnerId?: string, runnerName?: string): Promise<void>;
export declare function updateStepStatus(db: D1Database, jobId: string, stepNumber: number, status: 'in_progress' | 'completed' | 'skipped', conclusion?: Conclusion, exitCode?: number, error?: string): Promise<void>;
//# sourceMappingURL=workflow-job-scheduler.d.ts.map