/**
 * Workflow Engine – shared types and interfaces
 */
import type { D1Database, Queue } from '../../../shared/types/bindings.ts';
import type { Conclusion } from 'takos-actions-engine';
import type { WorkflowJobQueueMessage } from '../../../shared/types';
import type { SelectOf } from '../../../shared/types/drizzle-utils';
import type { workflowRuns } from '../../../infra/db';
import * as gitStore from '../git-smart';
export type WorkflowBucket = Parameters<typeof gitStore.getCommitData>[0] & Parameters<typeof gitStore.getBlobAtPath>[0];
export interface WorkflowEngineConfig {
    db: D1Database;
    bucket: WorkflowBucket;
    queue?: Queue<WorkflowJobQueueMessage>;
}
export interface StartRunOptions {
    repoId: string;
    workflowPath: string;
    event: string;
    ref: string;
    sha: string;
    inputs?: Record<string, unknown>;
    actorId: string;
}
export interface WorkflowJobResult {
    jobId: string;
    status: 'completed';
    conclusion: Conclusion;
    outputs: Record<string, string>;
    stepResults: WorkflowStepResult[];
    startedAt: string;
    completedAt: string;
}
export interface WorkflowStepResult {
    stepNumber: number;
    name: string;
    status: 'completed' | 'skipped';
    conclusion: Conclusion | null;
    exitCode?: number;
    error?: string;
    outputs: Record<string, string>;
    startedAt?: string;
    completedAt?: string;
}
export interface WorkflowRunRecord {
    id: string;
    repo_id: string;
    workflow_id: string | null;
    workflow_path: string;
    event: string;
    ref: string | null;
    sha: string | null;
    actor_id: string | null;
    status: string;
    conclusion: string | null;
    queued_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    inputs: string | null;
    run_number: number | null;
    run_attempt: number;
    created_at: string;
}
export interface DependencyState {
    allCompleted: boolean;
    allSuccessful: boolean;
}
export type DrizzleWorkflowRun = SelectOf<typeof workflowRuns>;
//# sourceMappingURL=workflow-engine-types.d.ts.map