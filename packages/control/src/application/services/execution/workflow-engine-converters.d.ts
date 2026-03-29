/**
 * Workflow Engine – pure helper / conversion functions
 */
import type { Job } from 'takos-actions-engine';
import type { WorkflowJobDefinition, WorkflowShell } from '../../../shared/types';
import type { DrizzleWorkflowRun, WorkflowRunRecord } from './workflow-engine-types';
export declare function normalizeWorkflowShell(shell: string | undefined): WorkflowShell | undefined;
export declare function toWorkflowJobDefinition(job: Job): WorkflowJobDefinition;
/**
 * Normalize needs field (string | string[] | undefined) to string[]
 */
export declare function normalizeNeeds(needs: string | string[] | undefined): string[];
/**
 * Map a Drizzle WorkflowRun record to the snake_case WorkflowRunRecord shape
 */
export declare function toRunRecord(run: DrizzleWorkflowRun): WorkflowRunRecord;
//# sourceMappingURL=workflow-engine-converters.d.ts.map