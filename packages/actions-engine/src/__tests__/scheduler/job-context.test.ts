import type { ExecutionContext, JobResult } from '../../workflow-models.ts';
import { buildJobExecutionContext, buildNeedsContext } from '../../scheduler/job-policy.ts';

import { assertEquals, assertNotEquals } from 'jsr:@std/assert';

function createBaseContext(): ExecutionContext {
  return {
    github: {
      event_name: 'push',
      event: {},
      ref: 'refs/heads/main',
      ref_name: 'main',
      sha: 'abc123',
      repository: 'owner/repo',
      repository_owner: 'owner',
      actor: 'actor',
      workflow: 'workflow',
      job: 'job',
      run_id: 'run-1',
      run_number: 1,
      run_attempt: 1,
      server_url: 'https://github.com',
      api_url: 'https://api.github.com',
      graphql_url: 'https://api.github.com/graphql',
      workspace: '/workspace',
      action: 'action',
      action_path: '/workspace/action',
      token: 'token',
    },
    env: { BASE: 'base', SHARED: 'base' },
    vars: {},
    secrets: {},
    runner: {
      name: 'runner',
      os: 'Linux',
      arch: 'X64',
      temp: '/tmp',
      tool_cache: '/tool-cache',
      debug: '0',
    },
    job: { status: 'failure' },
    steps: {
      previous: {
        outputs: { artifact: 'dist.tar' },
        outcome: 'success',
        conclusion: 'success',
      },
    },
    needs: {},
  };
}

function createJobResult(overrides: Partial<JobResult> = {}): JobResult {
  return {
    id: 'job',
    name: 'job',
    status: 'completed',
    conclusion: 'success',
    steps: [],
    outputs: {},
    ...overrides,
  };
}


  Deno.test('job-context helpers - builds needs context from dependency results and clones outputs', () => {
  const setupOutputs = { token: 'abc' };
    const results = new Map<string, JobResult>([
      ['setup', createJobResult({ id: 'setup', outputs: setupOutputs, conclusion: 'success' })],
      ['test', createJobResult({ id: 'test', outputs: {}, conclusion: 'failure' })],
      ['lint', createJobResult({ id: 'lint', outputs: {}, conclusion: 'skipped' })],
    ]);

    const needsContext = buildNeedsContext(['setup', 'test', 'lint', 'missing'], results);

    assertEquals(needsContext, {
      setup: { outputs: { token: 'abc' }, result: 'success' },
      test: { outputs: {}, result: 'failure' },
      lint: { outputs: {}, result: 'skipped' },
    });
    assertNotEquals(needsContext.setup.outputs, setupOutputs);
})
  Deno.test('job-context helpers - defaults unknown dependency conclusion to success', () => {
  const results = new Map<string, JobResult>([
      ['setup', createJobResult({ id: 'setup', outputs: {}, conclusion: undefined })],
    ]);

    const needsContext = buildNeedsContext(['setup'], results);
    assertEquals(needsContext.setup.result, 'success');
})
  Deno.test('job-context helpers - builds job execution context with merged env and fresh steps/job status', () => {
  const baseContext = createBaseContext();
    const needsContext = {
      setup: {
        outputs: { token: 'abc' },
        result: 'success' as const,
      },
    };

    const jobContext = buildJobExecutionContext(baseContext, needsContext, [
      baseContext.env,
      { WORKFLOW_ONLY: 'wf', SHARED: 'workflow' },
      { JOB_ONLY: 'job', SHARED: 'job' },
    ]);

    assertEquals(jobContext.env, {
      BASE: 'base',
      SHARED: 'job',
      WORKFLOW_ONLY: 'wf',
      JOB_ONLY: 'job',
    });
    assertEquals(jobContext.needs, needsContext);
    assertEquals(jobContext.job.status, 'success');
    assertEquals(jobContext.steps, {});
    assertNotEquals(jobContext.steps, baseContext.steps);
})