import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  isValidWorkflowJobQueueMessage,
} from '@/types';

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

describe('isValidWorkflowJobQueueMessage', () => {
  it('accepts canonical v3 payloads', () => {
    expect(isValidWorkflowJobQueueMessage(createValidMessage())).toBe(true);
  });

  it('rejects v3 payloads that include a legacy secrets field', () => {
    const withSecretsField = {
      ...createValidMessage(),
      secrets: {
        API_TOKEN: 'plaintext',
      },
    };

    expect(isValidWorkflowJobQueueMessage(withSecretsField)).toBe(false);
  });
});
