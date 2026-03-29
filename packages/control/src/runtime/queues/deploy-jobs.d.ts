import { type DeploymentEnv } from '../../application/services/deployment/index';
export interface DeploymentQueueMessage {
    version: number;
    type: 'deployment';
    deploymentId: string;
    timestamp: number;
}
export declare function isValidDeploymentQueueMessage(msg: unknown): msg is DeploymentQueueMessage;
export declare function handleDeploymentJob(message: DeploymentQueueMessage, env: DeploymentEnv): Promise<void>;
export declare function handleDeploymentJobDlq(message: DeploymentQueueMessage, env: DeploymentEnv, attempts: number): Promise<void>;
//# sourceMappingURL=deploy-jobs.d.ts.map