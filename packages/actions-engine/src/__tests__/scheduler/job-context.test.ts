import { describe, expect, it } from 'vitest';

import type { ExecutionContext, JobResult } from '../../types.js';
import { buildJobExecutionContext, buildNeedsContext } from '../../scheduler/job.js';

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

describe('job-context helpers', () => {
  it('builds needs context from dependency results and clones outputs', () => {
    const setupOutputs = { token: 'abc' };
    const results = new Map<string, JobResult>([
      ['setup', createJobResult({ id: 'setup', outputs: setupOutputs, conclusion: 'success' })],
      ['test', createJobResult({ id: 'test', outputs: {}, conclusion: 'failure' })],
      ['lint', createJobResult({ id: 'lint', outputs: {}, conclusion: 'skipped' })],
    ]);

    const needsContext = buildNeedsContext(['setup', 'test', 'lint', 'missing'], results);

    expect(needsContext).toEqual({
      setup: { outputs: { token: 'abc' }, result: 'success' },
      test: { outputs: {}, result: 'failure' },
      lint: { outputs: {}, result: 'skipped' },
    });
    expect(needsContext.setup.outputs).not.toBe(setupOutputs);
  });

  it('defaults unknown dependency conclusion to success', () => {
    const results = new Map<string, JobResult>([
      ['setup', createJobResult({ id: 'setup', outputs: {}, conclusion: undefined })],
    ]);

    const needsContext = buildNeedsContext(['setup'], results);
    expect(needsContext.setup.result).toBe('success');
  });

  it('builds job execution context with merged env and fresh steps/job status', () => {
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

    expect(jobContext.env).toEqual({
      BASE: 'base',
      SHARED: 'job',
      WORKFLOW_ONLY: 'wf',
      JOB_ONLY: 'job',
    });
    expect(jobContext.needs).toEqual(needsContext);
    expect(jobContext.job.status).toBe('success');
    expect(jobContext.steps).toEqual({});
    expect(jobContext.steps).not.toBe(baseContext.steps);
  });
});
