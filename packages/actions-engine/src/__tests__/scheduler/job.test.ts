import { describe, expect, it } from 'vitest';

import { createBaseContext } from '../../context.js';
import type {
  ExecutionContext,
  JobResult,
  Step,
  StepResult,
  Workflow,
} from '../../types.js';
import { JobScheduler } from '../../scheduler/job.js';
import { StepRunner, type ShellExecutor, type StepRunMetadata } from '../../scheduler/step.js';

function expectStoredAndEventResultSnapshots(
  eventResult: JobResult | undefined,
  storedResultAtEmit: JobResult | undefined,
  runResult: JobResult
): void {
  expect(eventResult).toBeDefined();
  expect(storedResultAtEmit).toBeDefined();
  expect(storedResultAtEmit).not.toBe(eventResult);
  expect(storedResultAtEmit).not.toBe(runResult);
  expect(eventResult).not.toBe(runResult);
  expect(storedResultAtEmit).toEqual(runResult);
  expect(eventResult).toEqual(runResult);
}

describe('JobScheduler fail-fast behavior', () => {
  it('stops later phases and preserves cancelled results when fail-fast is enabled', async () => {
    const executedCommands: string[] = [];
    const shellExecutor: ShellExecutor = async (command) => {
      executedCommands.push(command);

      if (command === 'fail') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'forced failure',
        };
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    };

    const workflow: Workflow = {
      name: 'fail-fast-workflow',
      on: 'push',
      jobs: {
        setup: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'setup' }],
        },
        fail: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'fail' }],
        },
        next: {
          'runs-on': 'ubuntu-latest',
          needs: 'setup',
          steps: [{ run: 'next' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      failFast: true,
      stepRunner: { shellExecutor },
    });

    const startedPhases: number[] = [];
    const completedJobs: string[] = [];
    scheduler.on((event) => {
      if (event.type === 'phase:start') {
        startedPhases.push(event.phase);
      }
      if (event.type === 'job:complete') {
        completedJobs.push(event.jobId);
      }
    });

    const results = await scheduler.run(createBaseContext());

    expect(executedCommands).toContain('setup');
    expect(executedCommands).toContain('fail');
    expect(executedCommands).not.toContain('next');
    expect(startedPhases).toEqual([0]);
    expect(results.fail.conclusion).toBe('failure');
    expect(results.next.conclusion).toBe('cancelled');
    expect(completedJobs.sort()).toEqual(['fail', 'next', 'setup']);
    expect(scheduler.getConclusion()).toBe('failure');
  });

  it('stops remaining steps after a failed step even when fail-fast is disabled', async () => {
    const executedCommands: string[] = [];
    const shellExecutor: ShellExecutor = async (command) => {
      executedCommands.push(command);

      if (command === 'fail') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'forced failure',
        };
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    };

    const workflow: Workflow = {
      name: 'step-failure-stops-job',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'fail' }, { run: 'after-fail' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      failFast: false,
      stepRunner: { shellExecutor },
    });

    const results = await scheduler.run(createBaseContext());

    expect(executedCommands).toEqual(['fail']);
    expect(results.build.steps).toHaveLength(1);
    expect(results.build.conclusion).toBe('failure');
  });

  it('continues independent jobs and skips only dependency-failed jobs when fail-fast is disabled', async () => {
    const executedCommands: string[] = [];
    const shellExecutor: ShellExecutor = async (command) => {
      executedCommands.push(command);

      if (command === 'build') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'forced build failure',
        };
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    };

    const workflow: Workflow = {
      name: 'fail-fast-disabled-dependency-skip-scope',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'build' }],
        },
        lint: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'lint' }],
        },
        deploy: {
          'runs-on': 'ubuntu-latest',
          needs: 'build',
          steps: [{ run: 'deploy' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      failFast: false,
      stepRunner: { shellExecutor },
    });

    const results = await scheduler.run(createBaseContext());

    expect(results.build.conclusion).toBe('failure');
    expect(results.lint.conclusion).toBe('success');
    expect(results.deploy.conclusion).toBe('skipped');
    expect(executedCommands).toContain('build');
    expect(executedCommands).toContain('lint');
    expect(executedCommands).not.toContain('deploy');
  });

  it('preserves continue-on-error semantics when fail-fast is disabled', async () => {
    const executedCommands: string[] = [];
    const shellExecutor: ShellExecutor = async (command) => {
      executedCommands.push(command);

      if (command === 'allowed-fail') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'allowed failure',
        };
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    };

    const workflow: Workflow = {
      name: 'continue-on-error-job',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [
            { run: 'allowed-fail', 'continue-on-error': true },
            { run: 'after-continue' },
          ],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      failFast: false,
      stepRunner: { shellExecutor },
    });

    const results = await scheduler.run(createBaseContext());

    expect(executedCommands).toEqual(['allowed-fail', 'after-continue']);
    expect(results.build.steps).toHaveLength(2);
    expect(results.build.conclusion).toBe('success');
  });

  it('propagates fail-fast cancellation within phase chunks', async () => {
    const executedCommands: string[] = [];
    const shellExecutor: ShellExecutor = async (command) => {
      executedCommands.push(command);

      if (command === 'work-1') {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      if (command === 'fail') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'forced failure',
        };
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    };

    const workflow: Workflow = {
      name: 'chunk-cancellation',
      on: 'push',
      jobs: {
        'a-fail': {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'fail' }],
        },
        'b-work': {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'work-1' }, { run: 'work-2' }],
        },
        'c-later': {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'later' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      failFast: true,
      maxParallel: 2,
      stepRunner: { shellExecutor },
    });

    const results = await scheduler.run(createBaseContext());

    expect(executedCommands).toContain('fail');
    expect(executedCommands).toContain('work-1');
    expect(executedCommands).not.toContain('work-2');
    expect(executedCommands).not.toContain('later');
    expect(results['a-fail'].conclusion).toBe('failure');
    expect(results['b-work'].conclusion).toBe('cancelled');
    expect(results['c-later'].conclusion).toBe('cancelled');
  });

  it('does not execute a job that is already marked as cancelled', async () => {
    const shellExecutor: ShellExecutor = async () => {
      throw new Error('shell executor should not be called');
    };

    const workflow: Workflow = {
      name: 'cancelled-job-guard',
      on: 'push',
      jobs: {
        guarded: {
          name: 'guarded',
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'should-not-run' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      stepRunner: { shellExecutor },
    });

    const cancelledResult: JobResult = {
      id: 'guarded',
      name: 'guarded',
      status: 'completed',
      conclusion: 'cancelled',
      steps: [],
      outputs: {},
    };

    const internalScheduler = scheduler as unknown as {
      results: Map<string, JobResult>;
      runJob: (jobId: string, context: ExecutionContext) => Promise<JobResult>;
    };

    internalScheduler.results.set('guarded', cancelledResult);

    const result = await internalScheduler.runJob('guarded', createBaseContext());

    expect(result).not.toBe(cancelledResult);
    expect(result).toEqual(cancelledResult);
  });

  it('prioritizes cancellation over condition-based skipping when scheduler is cancelled', async () => {
    const shellExecutor: ShellExecutor = async () => {
      throw new Error('shell executor should not be called');
    };

    const workflow: Workflow = {
      name: 'cancel-priority-over-skip',
      on: 'push',
      jobs: {
        guarded: {
          name: 'guarded',
          if: '${{ false }}',
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'should-not-run' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      stepRunner: { shellExecutor },
    });

    scheduler.cancel();

    const internalScheduler = scheduler as unknown as {
      runJob: (jobId: string, context: ExecutionContext) => Promise<JobResult>;
    };

    const result = await internalScheduler.runJob('guarded', createBaseContext());
    expect(result.conclusion).toBe('cancelled');
    expect(result.status).toBe('completed');
  });

  it('stores a finalized result before emitting job:complete', async () => {
    const workflow: Workflow = {
      name: 'complete-event-observation',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ id: 'compile', run: 'compile' }],
        },
      },
    };

    class OutputStepRunner extends StepRunner {
      override async runStep(step: Step): Promise<StepResult> {
        return {
          id: step.id,
          name: step.name,
          status: 'completed',
          conclusion: 'success',
          outputs: { artifact: 'build.tar' },
          startedAt: new Date(),
          completedAt: new Date(),
        };
      }
    }

    const scheduler = new JobScheduler(workflow);
    const internalScheduler = scheduler as unknown as { stepRunner: StepRunner };
    internalScheduler.stepRunner = new OutputStepRunner();

    let completeEventCount = 0;
    let emittedResult: JobResult | undefined;
    let storedResultAtEmit: JobResult | undefined;
    scheduler.on((event) => {
      if (event.type !== 'job:complete') {
        return;
      }

      completeEventCount += 1;
      emittedResult = event.result;
      storedResultAtEmit = scheduler.getResults()[event.jobId];
    });

    const results = await scheduler.run(createBaseContext());

    expect(completeEventCount).toBe(1);
    expectStoredAndEventResultSnapshots(
      emittedResult,
      storedResultAtEmit,
      results.build
    );
    expect(storedResultAtEmit?.status).toBe('completed');
    expect(storedResultAtEmit?.conclusion).toBe('success');
    expect(storedResultAtEmit?.completedAt).toBeInstanceOf(Date);
    expect(storedResultAtEmit?.outputs).toEqual({ artifact: 'build.tar' });
  });

  it('keeps job:skip emit and stored skipped result in sync', async () => {
    const shellExecutor: ShellExecutor = async () => {
      throw new Error('shell executor should not be called');
    };

    const workflow: Workflow = {
      name: 'skip-event-observation',
      on: 'push',
      jobs: {
        guarded: {
          if: '${{ false }}',
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'should-not-run' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      stepRunner: { shellExecutor },
    });

    const jobEvents: string[] = [];
    let skipReason: string | undefined;
    let skipEventResult: JobResult | undefined;
    let storedResultAtSkipEmit: JobResult | undefined;
    scheduler.on((event) => {
      if (
        event.type === 'job:start' ||
        event.type === 'job:skip' ||
        event.type === 'job:complete'
      ) {
        jobEvents.push(event.type);
      }

      if (event.type !== 'job:skip') {
        return;
      }

      skipReason = event.reason;
      skipEventResult = event.result;
      storedResultAtSkipEmit = scheduler.getResults()[event.jobId];
    });

    const results = await scheduler.run(createBaseContext());

    expect(jobEvents).toEqual(['job:skip', 'job:complete']);
    expect(skipReason).toBe('Condition not met');
    expectStoredAndEventResultSnapshots(
      skipEventResult,
      storedResultAtSkipEmit,
      results.guarded
    );
    expect(storedResultAtSkipEmit?.status).toBe('completed');
    expect(storedResultAtSkipEmit?.conclusion).toBe('skipped');
  });

  it('isolates job:complete and stored results from job:skip event mutations', async () => {
    const shellExecutor: ShellExecutor = async () => {
      throw new Error('shell executor should not be called');
    };

    const workflow: Workflow = {
      name: 'skip-event-payload-isolation',
      on: 'push',
      jobs: {
        guarded: {
          if: '${{ false }}',
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'should-not-run' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      stepRunner: { shellExecutor },
    });

    let completeEventResult: JobResult | undefined;
    scheduler.on((event) => {
      if (event.type === 'job:skip') {
        event.result.outputs.leaked = 'mutated-by-skip-listener';
        event.result.steps.push({
          id: 'skip-fake',
          status: 'completed',
          conclusion: 'success',
          outputs: {},
        });
        return;
      }

      if (event.type === 'job:complete') {
        completeEventResult = event.result;
      }
    });

    const results = await scheduler.run(createBaseContext());
    const storedResults = scheduler.getResults();

    expect(completeEventResult).toBeDefined();
    expect(completeEventResult?.outputs.leaked).toBeUndefined();
    expect(
      completeEventResult?.steps.find((step) => step.id === 'skip-fake')
    ).toBeUndefined();
    expect(results.guarded.outputs.leaked).toBeUndefined();
    expect(results.guarded.steps.find((step) => step.id === 'skip-fake')).toBeUndefined();
    expect(storedResults.guarded.outputs.leaked).toBeUndefined();
    expect(
      storedResults.guarded.steps.find((step) => step.id === 'skip-fake')
    ).toBeUndefined();
  });

  it('skips dependent jobs when a needed job is skipped', async () => {
    const executedCommands: string[] = [];
    const shellExecutor: ShellExecutor = async (command) => {
      executedCommands.push(command);
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    };

    const workflow: Workflow = {
      name: 'needs-skipped-propagation',
      on: 'push',
      jobs: {
        setup: {
          if: '${{ false }}',
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'setup' }],
        },
        build: {
          'runs-on': 'ubuntu-latest',
          needs: 'setup',
          steps: [{ run: 'build' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      stepRunner: { shellExecutor },
    });

    const skipReasons: Record<string, string> = {};
    scheduler.on((event) => {
      if (event.type === 'job:skip') {
        skipReasons[event.jobId] = event.reason;
      }
    });

    const results = await scheduler.run(createBaseContext());

    expect(executedCommands).toEqual([]);
    expect(results.setup.conclusion).toBe('skipped');
    expect(results.build.conclusion).toBe('skipped');
    expect(skipReasons.setup).toBe('Condition not met');
    expect(skipReasons.build).toBe('Dependency "setup" skipped');
  });

  it('emits job:complete when a cancelled scheduler short-circuits runJob', async () => {
    const shellExecutor: ShellExecutor = async () => {
      throw new Error('shell executor should not be called');
    };

    const workflow: Workflow = {
      name: 'cancelled-runjob-complete-event',
      on: 'push',
      jobs: {
        guarded: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'should-not-run' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      stepRunner: { shellExecutor },
    });

    const jobEvents: string[] = [];
    scheduler.on((event) => {
      if (
        event.type === 'job:start' ||
        event.type === 'job:skip' ||
        event.type === 'job:complete'
      ) {
        jobEvents.push(event.type);
      }
    });

    scheduler.cancel();

    const internalScheduler = scheduler as unknown as {
      runJob: (jobId: string, context: ExecutionContext) => Promise<JobResult>;
    };

    const result = await internalScheduler.runJob('guarded', createBaseContext());
    expect(result.conclusion).toBe('cancelled');
    expect(result.status).toBe('completed');
    expect(jobEvents).toEqual(['job:complete']);
    expect(scheduler.getResults().guarded).not.toBe(result);
    expect(scheduler.getResults().guarded).toEqual(result);
  });

  it('isolates internal results from job:complete event mutations', async () => {
    const workflow: Workflow = {
      name: 'event-result-isolation',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'build' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow);
    scheduler.on((event) => {
      if (event.type !== 'job:complete') {
        return;
      }

      event.result.outputs.leaked = 'mutated-by-listener';
      event.result.steps.push({
        id: 'fake',
        status: 'completed',
        conclusion: 'success',
        outputs: {},
      });
    });

    const results = await scheduler.run(createBaseContext());

    expect(results.build.outputs.leaked).toBeUndefined();
    expect(results.build.steps.find((step) => step.id === 'fake')).toBeUndefined();
  });

  it('isolates internal results from workflow:complete event mutations', async () => {
    const workflow: Workflow = {
      name: 'workflow-complete-result-isolation',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'build' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow);
    scheduler.on((event) => {
      if (event.type !== 'workflow:complete') {
        return;
      }

      event.results.build.outputs.leaked = 'mutated-by-listener';
    });

    const results = await scheduler.run(createBaseContext());

    expect(results.build.outputs.leaked).toBeUndefined();
    expect(scheduler.getResults().build.outputs.leaked).toBeUndefined();
  });

  it('returns result snapshots that cannot mutate scheduler state', async () => {
    const workflow: Workflow = {
      name: 'results-snapshot-isolation',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'build' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow);
    const runResults = await scheduler.run(createBaseContext());
    runResults.build.outputs.leaked = 'mutated-run-result';

    const snapshotAfterRunReturnMutation = scheduler.getResults();
    expect(snapshotAfterRunReturnMutation.build.outputs.leaked).toBeUndefined();

    const firstSnapshot = scheduler.getResults();
    firstSnapshot.build.outputs.leaked = 'mutated-by-caller';
    firstSnapshot.build.steps.push({
      id: 'fake',
      status: 'completed',
      conclusion: 'success',
      outputs: {},
    });

    const secondSnapshot = scheduler.getResults();
    expect(secondSnapshot.build.outputs.leaked).toBeUndefined();
    expect(secondSnapshot.build.steps.find((step) => step.id === 'fake')).toBeUndefined();
  });

  it('guards against concurrent run invocations while a run is in progress', async () => {
    let unblockFirstRun = () => {};
    const blockFirstRun = new Promise<void>((resolve) => {
      unblockFirstRun = resolve;
    });
    const executedCommands: string[] = [];
    const shellExecutor: ShellExecutor = async (command) => {
      executedCommands.push(command);
      await blockFirstRun;
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    };

    const workflow: Workflow = {
      name: 'concurrent-run-guard',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'build' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      stepRunner: { shellExecutor },
    });

    const firstRunPromise = scheduler.run(createBaseContext());

    await expect(scheduler.run(createBaseContext())).rejects.toThrow(
      'JobScheduler is already running'
    );

    unblockFirstRun();
    const firstRunResults = await firstRunPromise;

    expect(executedCommands).toEqual(['build']);
    expect(firstRunResults.build.conclusion).toBe('success');
  });

  it('isolates dependency outputs from needs context mutations', async () => {
    const workflow: Workflow = {
      name: 'needs-context-output-isolation',
      on: 'push',
      jobs: {
        setup: {
          'runs-on': 'ubuntu-latest',
          steps: [{ id: 'produce', run: 'produce' }],
        },
        deploy: {
          'runs-on': 'ubuntu-latest',
          needs: 'setup',
          steps: [{ id: 'mutate-needs', run: 'deploy' }],
        },
      },
    };

    class MutatingNeedsStepRunner extends StepRunner {
      override async runStep(
        step: Step,
        context: ExecutionContext
      ): Promise<StepResult> {
        if (step.id === 'mutate-needs' && context.needs.setup) {
          context.needs.setup.outputs.token = 'mutated';
        }

        return {
          id: step.id,
          name: step.name,
          status: 'completed',
          conclusion: 'success',
          outputs: step.id === 'produce' ? { token: 'abc' } : {},
          startedAt: new Date(),
          completedAt: new Date(),
        };
      }
    }

    const scheduler = new JobScheduler(workflow);
    const internalScheduler = scheduler as unknown as { stepRunner: StepRunner };
    internalScheduler.stepRunner = new MutatingNeedsStepRunner();

    const results = await scheduler.run(createBaseContext());

    expect(results.setup.outputs.token).toBe('abc');
    expect(scheduler.getResults().setup.outputs.token).toBe('abc');
  });

  it('isolates stored step outputs from steps context mutations', async () => {
    const workflow: Workflow = {
      name: 'steps-context-output-isolation',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [
            { id: 'produce', run: 'produce' },
            { id: 'mutate-steps', run: 'mutate' },
          ],
        },
      },
    };

    class MutatingStepsContextStepRunner extends StepRunner {
      override async runStep(
        step: Step,
        context: ExecutionContext
      ): Promise<StepResult> {
        if (step.id === 'mutate-steps' && context.steps.produce) {
          context.steps.produce.outputs.artifact = 'mutated';
        }

        return {
          id: step.id,
          name: step.name,
          status: 'completed',
          conclusion: 'success',
          outputs: step.id === 'produce' ? { artifact: 'dist.tar' } : {},
          startedAt: new Date(),
          completedAt: new Date(),
        };
      }
    }

    const scheduler = new JobScheduler(workflow);
    const internalScheduler = scheduler as unknown as { stepRunner: StepRunner };
    internalScheduler.stepRunner = new MutatingStepsContextStepRunner();

    const results = await scheduler.run(createBaseContext());

    expect(results.build.steps[0].outputs.artifact).toBe('dist.tar');
    expect(results.build.outputs.artifact).toBe('dist.tar');
    expect(scheduler.getResults().build.outputs.artifact).toBe('dist.tar');
  });

  it('resets cancellation/results between runs while preserving listeners', async () => {
    const executedCommands: string[] = [];
    let failBuildOnce = true;
    const shellExecutor: ShellExecutor = async (command) => {
      executedCommands.push(command);

      if (command === 'build' && failBuildOnce) {
        failBuildOnce = false;
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'forced first-run failure',
        };
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    };

    const workflow: Workflow = {
      name: 'scheduler-reset-across-runs',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'build' }],
        },
        deploy: {
          'runs-on': 'ubuntu-latest',
          needs: 'build',
          steps: [{ run: 'deploy' }],
        },
      },
    };

    const scheduler = new JobScheduler(workflow, {
      failFast: true,
      stepRunner: { shellExecutor },
    });

    let workflowStarted = 0;
    let workflowCompleted = 0;
    scheduler.on((event) => {
      if (event.type === 'workflow:start') {
        workflowStarted += 1;
      }
      if (event.type === 'workflow:complete') {
        workflowCompleted += 1;
      }
    });

    const firstRun = await scheduler.run(createBaseContext());
    expect(firstRun.build.conclusion).toBe('failure');
    expect(firstRun.deploy.conclusion).toBe('cancelled');
    expect(scheduler.getConclusion()).toBe('failure');

    const secondRun = await scheduler.run(createBaseContext());
    expect(secondRun.build.conclusion).toBe('success');
    expect(secondRun.deploy.conclusion).toBe('success');
    expect(scheduler.getConclusion()).toBe('success');
    expect(executedCommands).toEqual(['build', 'build', 'deploy']);
    expect(workflowStarted).toBe(2);
    expect(workflowCompleted).toBe(2);
  });

  it('marks a job as failure when step runner throws unexpectedly', async () => {
    const workflow: Workflow = {
      name: 'step-runner-throws',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'build' }],
        },
      },
    };

    class ThrowingStepRunner extends StepRunner {
      override async runStep(): Promise<StepResult> {
        throw new Error('unexpected step runner failure');
      }
    }

    const scheduler = new JobScheduler(workflow);
    const internalScheduler = scheduler as unknown as { stepRunner: StepRunner };
    internalScheduler.stepRunner = new ThrowingStepRunner();

    const results = await scheduler.run(createBaseContext());
    expect(results.build.conclusion).toBe('failure');
    expect(results.build.steps).toHaveLength(0);
  });

  it('passes zero-based step index metadata to the step runner', async () => {
    const workflow: Workflow = {
      name: 'step-index-metadata',
      on: 'push',
      jobs: {
        build: {
          'runs-on': 'ubuntu-latest',
          steps: [
            { id: 'first', run: 'first' },
            { id: 'second', run: 'second' },
            { id: 'third', run: 'third' },
          ],
        },
      },
    };

    class RecordingStepRunner extends StepRunner {
      public readonly indices: number[] = [];

      override async runStep(
        step: Step,
        _context: ExecutionContext,
        metadata: StepRunMetadata = {}
      ): Promise<StepResult> {
        this.indices.push(metadata.index ?? -1);

        return {
          id: step.id,
          name: step.name,
          status: 'completed',
          conclusion: 'success',
          outputs: {},
          startedAt: new Date(),
          completedAt: new Date(),
        };
      }
    }

    const scheduler = new JobScheduler(workflow);
    const recordingRunner = new RecordingStepRunner();
    const internalScheduler = scheduler as unknown as {
      stepRunner: StepRunner;
    };
    internalScheduler.stepRunner = recordingRunner;

    await scheduler.run(createBaseContext());

    expect(recordingRunner.indices).toEqual([0, 1, 2]);
  });
});
