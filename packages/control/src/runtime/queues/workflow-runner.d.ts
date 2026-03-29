import type { MessageBatch } from '../../shared/types/bindings.ts';
import { type WorkflowQueueEnv } from './workflow-jobs';
import type { DeploymentEnv } from '../../application/services/deployment/index';
type WorkflowRunnerEnv = WorkflowQueueEnv & DeploymentEnv;
declare const _default: {
    queue(batch: MessageBatch<unknown>, env: WorkflowRunnerEnv): Promise<void>;
};
export default _default;
//# sourceMappingURL=workflow-runner.d.ts.map