import type { WorkflowQueueEnv, WorkflowEventType, WorkflowEventData } from './workflow-types';
export declare function emitWorkflowEvent(env: WorkflowQueueEnv, runId: string, type: WorkflowEventType, data: WorkflowEventData): Promise<void>;
//# sourceMappingURL=workflow-events.d.ts.map