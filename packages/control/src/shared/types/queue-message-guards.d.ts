import type { RunQueueMessage, IndexJobQueueMessage, WorkflowJobQueueMessage, DeploymentQueueMessage } from './queue-messages';
export declare function isValidRunQueueMessage(msg: unknown): msg is RunQueueMessage;
export declare function isValidIndexJobQueueMessage(msg: unknown): msg is IndexJobQueueMessage;
export declare function isValidWorkflowJobQueueMessage(msg: unknown): msg is WorkflowJobQueueMessage;
export declare function isValidDeploymentQueueMessage(msg: unknown): msg is DeploymentQueueMessage;
//# sourceMappingURL=queue-message-guards.d.ts.map