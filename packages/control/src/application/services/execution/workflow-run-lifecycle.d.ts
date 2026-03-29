/**
 * Workflow Engine – run lifecycle (start, cancel, finalize)
 */
import type { Workflow } from 'takos-actions-engine';
import type { WorkflowJobDefinition, WorkflowJobQueueMessage } from '../../../shared/types';
import type { WorkflowBucket, StartRunOptions, WorkflowRunRecord } from './workflow-engine-types';
import type { D1Database, Queue } from '../../../shared/types/bindings.ts';
export declare function startRun(db: D1Database, bucket: WorkflowBucket, queue: Queue<WorkflowJobQueueMessage> | undefined, options: StartRunOptions): Promise<WorkflowRunRecord>;
export declare function cancelRun(db: D1Database, runId: string): Promise<void>;
/**
 * If all jobs for a run are completed, determine and persist the run conclusion.
 */
export declare function finalizeRunIfComplete(db: D1Database, runId: string): Promise<void>;
/**
 * Check if the workflow supports the given event
 */
export declare function checkTrigger(workflow: Workflow, event: string): boolean;
/**
 * Resolve the workflow ID from the database, or return null if not found.
 */
export declare function resolveWorkflowId(db: D1Database, repoId: string, workflowPath: string): Promise<string | null>;
/**
 * Retrieve secret IDs for a repo.
 */
export declare function getSecretIds(db: D1Database, repoId: string): Promise<string[]>;
/**
 * Enqueue a job for execution
 */
export declare function enqueueJob(queue: Queue<WorkflowJobQueueMessage> | undefined, options: {
    runId: string;
    jobId: string;
    repoId: string;
    ref: string;
    sha: string;
    jobKey: string;
    jobDefinition: WorkflowJobDefinition;
    env: Record<string, string>;
    secretIds: string[];
}): Promise<void>;
//# sourceMappingURL=workflow-run-lifecycle.d.ts.map