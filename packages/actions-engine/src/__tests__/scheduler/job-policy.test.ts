import { describe, expect, it } from 'vitest';

import type { JobResult, Step, StepResult } from '../../types.js';
import {
  classifyStepControl,
  createCompletedJobResult,
  createInProgressJobResult,
  finalizeJobResult,
  getDependencySkipReason,
  normalizeNeedsInput,
} from '../../scheduler/job.js';

describe('job policy helpers', () => {
  it('normalizes job needs definitions', () => {
    expect(
      normalizeNeedsInput({
        'runs-on': 'ubuntu-latest',
        needs: 'build',
        steps: [{ run: 'echo test' }],
      }.needs)
    ).toEqual(['build']);

    expect(
      normalizeNeedsInput({
        'runs-on': 'ubuntu-latest',
        needs: ['build', 'test'],
        steps: [{ run: 'echo test' }],
      }.needs)
    ).toEqual(['build', 'test']);
  });

  it('creates completed and in-progress job result shapes', () => {
    expect(createCompletedJobResult('build', 'Build', 'skipped')).toEqual({
      id: 'build',
      name: 'Build',
      status: 'completed',
      conclusion: 'skipped',
      steps: [],
      outputs: {},
    });

    const inProgress = createInProgressJobResult('test', 'Test');
    expect(inProgress.id).toBe('test');
    expect(inProgress.name).toBe('Test');
    expect(inProgress.status).toBe('in_progress');
    expect(inProgress.outputs).toEqual({});
    expect(inProgress.steps).toEqual([]);
    expect(inProgress.startedAt).toBeInstanceOf(Date);
  });

  it('returns dependency skip reason for non-success dependency outcomes', () => {
    const results = new Map<string, JobResult>([
      [
        'setup',
        {
          id: 'setup',
          status: 'completed',
          conclusion: 'failure',
          steps: [],
          outputs: {},
        },
      ],
    ]);

    expect(getDependencySkipReason(['setup'], results)).toBe(
      'Dependency "setup" failure'
    );

    results.set('setup', {
      id: 'setup',
      status: 'completed',
      conclusion: 'cancelled',
      steps: [],
      outputs: {},
    });
    expect(getDependencySkipReason(['setup'], results)).toBe(
      'Dependency "setup" cancelled'
    );

    results.set('setup', {
      id: 'setup',
      status: 'completed',
      conclusion: 'skipped',
      steps: [],
      outputs: {},
    });
    expect(getDependencySkipReason(['setup'], results)).toBe(
      'Dependency "setup" skipped'
    );

    results.set('setup', {
      id: 'setup',
      status: 'completed',
      steps: [],
      outputs: {},
    });
    expect(getDependencySkipReason(['setup'], results)).toBe(
      'Dependency "setup" did not succeed'
    );
  });

  it('returns null when dependencies are successful or missing', () => {
    const results = new Map<string, JobResult>([
      [
        'setup',
        {
          id: 'setup',
          status: 'completed',
          conclusion: 'success',
          steps: [],
          outputs: {},
        },
      ],
    ]);

    expect(getDependencySkipReason(['setup'], results)).toBeNull();
    expect(getDependencySkipReason(['unknown'], results)).toBeNull();
  });

  it('classifies step control decisions with fail-fast and continue-on-error', () => {
    const strictStep: Step = { run: 'build' };
    const permissiveStep: Step = { run: 'build', 'continue-on-error': true };
    const failureResult: StepResult = {
      id: 'build',
      status: 'completed',
      conclusion: 'failure',
      outputs: {},
    };
    const successResult: StepResult = {
      id: 'build',
      status: 'completed',
      conclusion: 'success',
      outputs: {},
    };

    expect(classifyStepControl(strictStep, successResult, true)).toEqual({
      shouldStopJob: false,
      shouldMarkJobFailed: false,
      shouldCancelWorkflow: false,
    });
    expect(classifyStepControl(permissiveStep, failureResult, true)).toEqual({
      shouldStopJob: false,
      shouldMarkJobFailed: false,
      shouldCancelWorkflow: false,
    });
    expect(classifyStepControl(strictStep, failureResult, false)).toEqual({
      shouldStopJob: true,
      shouldMarkJobFailed: true,
      shouldCancelWorkflow: false,
    });
    expect(classifyStepControl(strictStep, failureResult, true)).toEqual({
      shouldStopJob: true,
      shouldMarkJobFailed: true,
      shouldCancelWorkflow: true,
    });
  });

  it('finalizes job status/conclusion and aggregates outputs from named steps', () => {
    const result = createInProgressJobResult('build', 'Build');
    result.steps = [
      {
        id: 'compile',
        status: 'completed',
        conclusion: 'success',
        outputs: { artifact: 'build.tar' },
      },
      {
        status: 'completed',
        conclusion: 'success',
        outputs: { ignored: 'value' },
      },
      {
        id: 'test',
        status: 'completed',
        conclusion: 'success',
        outputs: { report: 'junit.xml' },
      },
    ];

    finalizeJobResult(result, { failed: false, cancelled: false });
    expect(result.status).toBe('completed');
    expect(result.conclusion).toBe('success');
    expect(result.completedAt).toBeInstanceOf(Date);
    expect(result.outputs).toEqual({
      artifact: 'build.tar',
      report: 'junit.xml',
    });

    finalizeJobResult(result, { failed: true, cancelled: false });
    expect(result.conclusion).toBe('failure');

    finalizeJobResult(result, { failed: true, cancelled: true });
    expect(result.conclusion).toBe('cancelled');
  });
});
