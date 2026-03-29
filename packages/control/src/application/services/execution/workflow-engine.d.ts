/**
 * Workflow Execution Engine
 *
 * Orchestrates workflow runs, jobs, and steps execution using Cloudflare Queues.
 * This is the main entry-point; implementation details live in sibling modules.
 */
import type { Conclusion } from 'takos-actions-engine';
import type { WorkflowJobDefinition } from '../../../shared/types';
export type { WorkflowEngineConfig, StartRunOptions, WorkflowJobResult, WorkflowStepResult, WorkflowRunRecord, } from './workflow-engine-types';
import type { WorkflowEngineConfig, StartRunOptions, WorkflowRunRecord, WorkflowJobResult } from './workflow-engine-types';
export interface WorkflowEngine {
    startRun(options: StartRunOptions): Promise<WorkflowRunRecord>;
    enqueueJob(options: {
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
    onJobComplete(jobId: string, result: WorkflowJobResult): Promise<void>;
    cancelRun(runId: string): Promise<void>;
    onJobStart(jobId: string, runnerId?: string, runnerName?: string): Promise<void>;
    updateStepStatus(jobId: string, stepNumber: number, status: 'in_progress' | 'completed' | 'skipped', conclusion?: Conclusion, exitCode?: number, error?: string): Promise<void>;
    storeJobLogs(jobId: string, logs: string): Promise<string>;
    createArtifact(options: {
        runId: string;
        name: string;
        data: ArrayBuffer | Uint8Array | string;
        mimeType?: string;
        expiresInDays?: number;
    }): Promise<{
        id: string;
        r2Key: string;
    }>;
}
/**
 * Create a workflow engine instance
 */
export declare function createWorkflowEngine(config: WorkflowEngineConfig): WorkflowEngine;
//# sourceMappingURL=workflow-engine.d.ts.map