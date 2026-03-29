import type { Queue, D1Database } from '../../../shared/types/bindings.ts';
import { type Workflow } from 'takos-actions-engine';
import { type WorkflowJobQueueMessage } from '../../../shared/types';
export declare function getWorkflowSecretIds(db: D1Database, repoId: string): Promise<string[]>;
export declare function enqueueFirstPhaseJobs(options: {
    queue?: Queue<WorkflowJobQueueMessage>;
    workflow: Workflow;
    workflowPath: string;
    jobKeyToId: Map<string, string>;
    repoId: string;
    runId: string;
    ref: string;
    sha: string;
    db: D1Database;
}): Promise<void>;
export declare function createWorkflowJobs(options: {
    db: D1Database;
    runId: string;
    workflow: Workflow;
    timestamp: string;
}): Promise<Map<string, string>>;
//# sourceMappingURL=actions-execution.d.ts.map