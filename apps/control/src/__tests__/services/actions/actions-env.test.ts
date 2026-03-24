import { describe, expect, it } from 'vitest';
import type { Job, Workflow } from '@takos/actions-engine';
import { buildWorkflowDispatchEnv } from '@/services/actions/actions-env';

const workflow = {
  env: {
    CUSTOM_ENV: 'custom-value',
  },
} as unknown as Workflow;

const jobDefinition = {
  name: 'Build',
  steps: [],
} as unknown as Job;

describe('buildWorkflowDispatchEnv', () => {
  it('sets GITHUB_RUN_ID to workflow run id (not job id)', () => {
    const env = buildWorkflowDispatchEnv({
      workflow,
      workflowPath: '.takos/workflows/ci.yml',
      repoId: 'repo-1',
      runId: 'run-123',
      ref: 'main',
      sha: 'abc123',
      jobKey: 'build',
      jobId: 'job-456',
      jobDefinition,
    });

    expect(env.GITHUB_RUN_ID).toBe('run-123');
    expect(env.GITHUB_JOB).toBe('Build');
    expect(env.GITHUB_REF).toBe('refs/heads/main');
    expect(env.CUSTOM_ENV).toBe('custom-value');
  });

  it('keeps refs/* values as-is when ref is already normalized', () => {
    const env = buildWorkflowDispatchEnv({
      workflow,
      workflowPath: '.takos/workflows/ci.yml',
      repoId: 'repo-1',
      runId: 'run-999',
      ref: 'refs/heads/release',
      sha: 'def456',
      jobKey: 'build',
      jobId: 'job-111',
      jobDefinition,
    });

    expect(env.GITHUB_REF).toBe('refs/heads/release');
    expect(env.GITHUB_RUN_ID).toBe('run-999');
  });
});
