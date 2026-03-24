// Workflow/deployment handler module (queue).
// Workflow + deployment job queue wiring.
// Imported by the unified takos-worker entrypoint (src/runtime/worker/index.ts).
import type { MessageBatch } from '../../shared/types/bindings.ts';

import { createWorkflowQueueConsumer, handleWorkflowJobDlq, type WorkflowQueueEnv } from './workflow-jobs';
import { handleDeploymentJob, handleDeploymentJobDlq, isValidDeploymentQueueMessage, type DeploymentQueueMessage } from './deploy-jobs';
import type { DeploymentEnv } from '../../application/services/deployment/index';
import { validateWorkflowRunnerEnv, createEnvGuard } from '../../shared/utils/validate-env';
import { logError, logWarn } from '../../shared/utils/logger';

// Cached environment validation guard.
const envGuard = createEnvGuard(validateWorkflowRunnerEnv);

type WorkflowRunnerEnv = WorkflowQueueEnv & DeploymentEnv;

export default {
  async queue(batch: MessageBatch<unknown>, env: WorkflowRunnerEnv): Promise<void> {
    // Validate environment on first invocation (cached).
    const envError = envGuard(env as unknown as Record<string, unknown>);
    if (envError) {
      for (const message of batch.messages) {
        message.retry();
      }
      return;
    }
    const queueName = batch.queue.replace(/-staging$/i, '');

    if (queueName === 'takos-workflow-jobs') {
      const consumer = createWorkflowQueueConsumer(env);
      // MessageBatch<unknown> is structurally compatible with the consumer's
      // expected batch shape ({ messages: ReadonlyArray<{ body: unknown; ack; retry }> }).
      await consumer.queue(batch);
      return;
    }

    if (queueName === 'takos-workflow-jobs-dlq') {
      for (const message of batch.messages) {
        try {
          await handleWorkflowJobDlq(message.body, env, message.attempts);
          message.ack();
        } catch (err) {
          logError('Handler failed', err, { module: 'workflow_dlq' });
          message.retry();
        }
      }
      return;
    }

    if (queueName === 'takos-deployment-jobs') {
      for (const message of batch.messages) {
        const body = message.body;
        if (!isValidDeploymentQueueMessage(body)) {
          logError('Invalid message format', JSON.stringify(body).slice(0, 200), { module: 'deploy_queue' });
          message.ack();
          continue;
        }
        try {
          await handleDeploymentJob(body, env);
          message.ack();
        } catch (err) {
          logError(`Job failed for deployment ${body.deploymentId}`, err, { module: 'deploy_queue' });
          message.retry();
        }
      }
      return;
    }

    if (queueName === 'takos-deployment-jobs-dlq') {
      for (const message of batch.messages) {
        try {
          await handleDeploymentJobDlq(message.body as DeploymentQueueMessage, env, message.attempts);
          message.ack();
        } catch (err) {
          logError(`Handler failed`, err, { module: 'deploy_dlq' });
          message.retry();
        }
      }
      return;
    }

    logWarn(`Unknown queue: ${batch.queue}`, { module: 'workflow_queue' });
    for (const message of batch.messages) {
      message.ack();
    }
  },
};
