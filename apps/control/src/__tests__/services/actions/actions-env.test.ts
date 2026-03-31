import type { Job, Workflow } from 'takos-actions-engine';
import { buildWorkflowDispatchEnv } from '@/services/actions/actions-env';

import { assertEquals } from 'jsr:@std/assert';

const workflow = {
  env: {
    CUSTOM_ENV: 'custom-value',
  },
} as unknown as Workflow;

const jobDefinition = {
  name: 'Build',
  steps: [],
} as unknown as Job;


  Deno.test('buildWorkflowDispatchEnv - sets GITHUB_RUN_ID to workflow run id (not job id)', () => {
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

    assertEquals(env.GITHUB_RUN_ID, 'run-123');
    assertEquals(env.GITHUB_JOB, 'Build');
    assertEquals(env.GITHUB_REF, 'refs/heads/main');
    assertEquals(env.CUSTOM_ENV, 'custom-value');
})
  Deno.test('buildWorkflowDispatchEnv - keeps refs/* values as-is when ref is already normalized', () => {
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

    assertEquals(env.GITHUB_REF, 'refs/heads/release');
    assertEquals(env.GITHUB_RUN_ID, 'run-999');
})