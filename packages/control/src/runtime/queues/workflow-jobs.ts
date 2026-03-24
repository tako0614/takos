// ---------------------------------------------------------------------------
// Barrel module – re-exports from focused sub-modules.
//
// All existing imports from '../queues/workflow-jobs' continue to work.
// ---------------------------------------------------------------------------

import { isValidWorkflowJobQueueMessage } from '../../shared/types';
import { logError } from '../../shared/utils/logger';
import type { QueueBatchMessage } from './workflow-types';
import { handleWorkflowJob } from './workflow-job-handler';

// Re-export public API used by external consumers
export type { WorkflowQueueEnv } from './workflow-types';
export { handleWorkflowJob } from './workflow-job-handler';
export { handleWorkflowJobDlq } from './workflow-dlq';

// ---------------------------------------------------------------------------
// Queue consumer
// ---------------------------------------------------------------------------

export function createWorkflowQueueConsumer(env: import('./workflow-types').WorkflowQueueEnv) {
  return {
    async queue(batch: { messages: ReadonlyArray<QueueBatchMessage> }) {
      for (const message of batch.messages) {
        const body = message.body;

        if (!isValidWorkflowJobQueueMessage(body)) {
          logError('Invalid workflow job message format, skipping', undefined, { module: 'workflow_queue' });
          message.ack();
          continue;
        }

        try {
          await handleWorkflowJob(body, env);
          message.ack();
        } catch (err) {
          logError('Workflow job failed', err, { module: 'queues/workflow-jobs' });
          message.retry();
        }
      }
    },
  };
}
