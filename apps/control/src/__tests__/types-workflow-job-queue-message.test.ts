import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  isValidWorkflowJobQueueMessage,
} from '@/types';

import { assertEquals } from 'jsr:@std/assert';

function createValidMessage() {
  return {
    version: WORKFLOW_QUEUE_MESSAGE_VERSION,
    type: 'job' as const,
    runId: 'run-1',
    jobId: 'job-1',
    repoId: 'repo-1',
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    jobKey: 'build',
    jobDefinition: {
      'runs-on': 'ubuntu-latest',
      steps: [{ run: 'echo ok' }],
    },
    env: {
      CI: 'true',
    },
    secretIds: ['secret-1'],
    timestamp: Date.now(),
  };
}


  Deno.test('isValidWorkflowJobQueueMessage - accepts canonical v3 payloads', () => {
  assertEquals(isValidWorkflowJobQueueMessage(createValidMessage()), true);
})
  Deno.test('isValidWorkflowJobQueueMessage - rejects v3 payloads that include a legacy secrets field', () => {
  const withSecretsField = {
      ...createValidMessage(),
      secrets: {
        API_TOKEN: 'plaintext',
      },
    };

    assertEquals(isValidWorkflowJobQueueMessage(withSecretsField), false);
})