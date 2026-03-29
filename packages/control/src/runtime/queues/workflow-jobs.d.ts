import type { QueueBatchMessage } from './workflow-types';
export type { WorkflowQueueEnv } from './workflow-types';
export { handleWorkflowJob } from './workflow-job-handler';
export { handleWorkflowJobDlq } from './workflow-dlq';
export declare function createWorkflowQueueConsumer(env: import('./workflow-types').WorkflowQueueEnv): {
    queue(batch: {
        messages: ReadonlyArray<QueueBatchMessage>;
    }): Promise<void>;
};
//# sourceMappingURL=workflow-jobs.d.ts.map