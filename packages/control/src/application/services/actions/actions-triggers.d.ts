import type { D1Database, ExecutionContext, Queue, R2Bucket } from '../../../shared/types/bindings.ts';
import type { WorkflowJobQueueMessage } from '../../../shared/types';
export type PullRequestWorkflowAction = 'opened' | 'edited' | 'closed' | 'synchronize';
export interface PullRequestWorkflowEvent {
    action: PullRequestWorkflowAction;
    number: number;
    title: string;
    body?: string | null;
    state: 'open' | 'closed';
    merged: boolean;
    mergedAt?: string | null;
    headRef: string;
    headSha?: string | null;
    baseRef: string;
    baseSha?: string | null;
    changedFiles?: string[];
    authorId?: string | null;
}
export interface TriggerPullRequestWorkflowsOptions {
    db: D1Database;
    bucket?: R2Bucket;
    queue?: Queue<WorkflowJobQueueMessage>;
    encryptionKey?: string;
    repoId: string;
    repoName: string;
    defaultBranch: string;
    actorId: string;
    event: PullRequestWorkflowEvent;
}
export interface PullRequestWorkflowTriggerResult {
    triggeredRunIds: string[];
    workflowPaths: string[];
}
export interface TriggerPullRequestSynchronizeOptions {
    db: D1Database;
    bucket?: R2Bucket;
    queue?: Queue<WorkflowJobQueueMessage>;
    encryptionKey?: string;
    repoId: string;
    repoName: string;
    defaultBranch: string;
    actorId: string;
    headBranch: string;
    headSha?: string;
    changedFiles?: string[];
}
export interface TriggerPushWorkflowsConfig {
    db: D1Database;
    bucket?: R2Bucket;
    queue?: Queue<WorkflowJobQueueMessage>;
    encryptionKey?: string;
}
export interface TriggerPushWorkflowsEvent {
    repoId: string;
    branch: string;
    before: string | null;
    after: string;
    actorId: string;
    actorName?: string | null;
    actorEmail?: string | null;
}
export interface PushWorkflowTriggerResult {
    triggeredRunIds: string[];
    workflowPaths: string[];
}
export declare function triggerPullRequestWorkflows(options: TriggerPullRequestWorkflowsOptions): Promise<PullRequestWorkflowTriggerResult>;
export declare function triggerPullRequestSynchronizeForHeadUpdate(options: TriggerPullRequestSynchronizeOptions): Promise<PullRequestWorkflowTriggerResult[]>;
export declare function triggerPushWorkflows(config: TriggerPushWorkflowsConfig, event: TriggerPushWorkflowsEvent): Promise<PushWorkflowTriggerResult>;
export declare function scheduleActionsAutoTrigger(executionCtx: Pick<ExecutionContext, 'waitUntil'> | undefined, taskFactory: () => Promise<unknown>, source: string): void;
//# sourceMappingURL=actions-triggers.d.ts.map