import type { D1Database } from '../../shared/types/bindings.ts';
import type { Step } from 'takos-actions-engine';
import type { WorkflowEngine, WorkflowStepResult } from '../../application/services/execution/workflow-engine';
import type { WorkflowQueueEnv, RunContext } from './workflow-types';
export declare function runtimeJson<T>(env: WorkflowQueueEnv, endpoint: string, spaceId: string, body?: Record<string, unknown>, method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'): Promise<T>;
export declare function runtimeDelete(env: WorkflowQueueEnv, endpoint: string, spaceId: string): Promise<void>;
export declare function getRunContext(d1: D1Database, runId: string): Promise<RunContext>;
export declare function getStepDisplayName(step: Step, stepNumber: number): string;
export declare function getRunStatus(d1: D1Database, runId: string): Promise<string | null>;
export declare function getSpaceIdFromRepoId(d1: D1Database, repoId: string): Promise<string>;
export declare function markJobSkipped(d1: D1Database, jobId: string, timestamp: string, conclusion?: 'skipped' | 'cancelled'): Promise<void>;
/** Build skipped WorkflowStepResult entries from existing DB step records. */
export declare function buildSkippedWorkflowStepResultsFromDb(d1: D1Database, jobId: string, fallbackName: string, errorMessage?: string): Promise<WorkflowStepResult[]>;
/** Mark a job as failed and record step results via onJobComplete. */
export declare function failJobWithResults(engine: WorkflowEngine, jobId: string, stepResults: WorkflowStepResult[], timestamp: string): Promise<void>;
/** Mark a job record as failed in the DB (idempotent via status guard). */
export declare function markJobFailed(d1: D1Database, jobId: string, timestamp: string): Promise<void>;
//# sourceMappingURL=workflow-runtime-client.d.ts.map