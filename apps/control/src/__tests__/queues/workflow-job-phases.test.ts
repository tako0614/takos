import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  callRuntimeRequest: vi.fn(),
  safeJsonParseOrDefault: vi.fn(),
  createWorkflowEngine: vi.fn(),
  getRunNotifierStub: vi.fn(),
  buildRunNotifierEmitRequest: vi.fn(),
  buildRunNotifierEmitPayload: vi.fn(),
}));

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: mocks.getDb };
});

vi.mock('@/utils', () => ({
  safeJsonParseOrDefault: mocks.safeJsonParseOrDefault,
  decrypt: vi.fn().mockResolvedValue('decrypted'),
}));

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: mocks.callRuntimeRequest,
}));

vi.mock('@/services/execution/workflow-engine', () => ({
  createWorkflowEngine: mocks.createWorkflowEngine,
}));

vi.mock('@/services/run-notifier-client', () => ({
  buildRunNotifierEmitRequest: mocks.buildRunNotifierEmitRequest,
  getRunNotifierStub: mocks.getRunNotifierStub,
}));

vi.mock('@/services/run-notifier-payload', () => ({
  buildRunNotifierEmitPayload: mocks.buildRunNotifierEmitPayload,
}));

import {
  handleJobSkipped,
  executeStepLoop,
  completeJobSuccess,
  completeJobFailure,
} from '@/queues/workflow-job-phases';
import { createInitialState } from '@/queues/workflow-types';
import type { JobContext, JobExecutionState } from '@/queues/workflow-types';
import type { WorkflowJobQueueMessage } from '@/types';
import { WORKFLOW_QUEUE_MESSAGE_VERSION } from '@/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createDrizzleMock(opts: {
  selectGet?: ReturnType<typeof vi.fn>;
  selectAll?: ReturnType<typeof vi.fn>;
} = {}) {
  const selectGet = opts.selectGet ?? vi.fn().mockResolvedValue(null);
  const selectAll = opts.selectAll ?? vi.fn().mockResolvedValue([]);

  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockReturnValue(c);
    c.orderBy = vi.fn().mockReturnValue(c);
    c.limit = vi.fn().mockReturnValue(c);
    c.get = selectGet;
    c.all = selectAll;
    return c;
  };

  const updateChain = () => {
    const c: Record<string, unknown> = {};
    c.set = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    return c;
  };

  return {
    select: vi.fn().mockImplementation(() => chain()),
    update: vi.fn().mockImplementation(() => updateChain()),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ id: 1 }) }),
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  };
}

function createEngine() {
  return {
    onJobStart: vi.fn().mockResolvedValue(undefined),
    onJobComplete: vi.fn().mockResolvedValue(undefined),
    updateStepStatus: vi.fn().mockResolvedValue(undefined),
    storeJobLogs: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue(undefined),
  };
}

function createMessage(overrides: Partial<WorkflowJobQueueMessage> = {}): WorkflowJobQueueMessage {
  return {
    version: WORKFLOW_QUEUE_MESSAGE_VERSION,
    type: 'job',
    runId: 'run-1',
    jobId: 'job-1',
    repoId: 'repo-1',
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    jobKey: 'build',
    jobDefinition: {
      name: 'Build',
      'runs-on': 'ubuntu-latest',
      steps: [{ run: 'echo ok' }],
    },
    env: { CI: 'true' },
    secretIds: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function createJobContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    env: {
      DB: {} as any,
      RUN_NOTIFIER: {} as any,
      RUNTIME_HOST: { fetch: vi.fn() },
    } as any,
    engine: createEngine() as any,
    message: createMessage(),
    jobName: 'Build',
    effectiveJobEnv: { CI: 'true' },
    startedAt: '2024-01-01T00:00:00Z',
    runContext: { workflowPath: '.takos/workflows/ci.yml', inputs: {} },
    runtimeConfigured: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.buildRunNotifierEmitPayload.mockReturnValue({});
  mocks.buildRunNotifierEmitRequest.mockReturnValue(
    new Request('https://notifier.example.test', { method: 'POST' })
  );
  mocks.getRunNotifierStub.mockReturnValue({
    fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  });
});

// ---------------------------------------------------------------------------
// handleJobSkipped
// ---------------------------------------------------------------------------

describe('handleJobSkipped', () => {
  it('returns false when job has no if condition', async () => {
    const ctx = createJobContext();
    const state = createInitialState();

    const skipped = await handleJobSkipped(ctx, state);

    expect(skipped).toBe(false);
  });

  it('returns false when condition evaluates to true', async () => {
    const ctx = createJobContext({
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          if: '${{ env.CI }}',
          steps: [{ run: 'echo ok' }],
        },
      }),
    });
    const state = createInitialState();

    const skipped = await handleJobSkipped(ctx, state);
    expect(skipped).toBe(false);
  });

  it('returns true and marks job as skipped when condition is false', async () => {
    const engine = createEngine();
    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          if: '${{ env.MISSING_VAR }}',
          steps: [
            { name: 'Step 1', run: 'echo 1' },
            { name: 'Step 2', run: 'echo 2' },
          ],
        },
      }),
      effectiveJobEnv: {},
    });
    const state = createInitialState();

    const skipped = await handleJobSkipped(ctx, state);

    expect(skipped).toBe(true);
    expect(state.jobConclusion).toBe('skipped');
    expect(state.logs).toContain('Job skipped (condition not met): ${{ env.MISSING_VAR }}');
    expect(engine.storeJobLogs).toHaveBeenCalledWith('job-1', expect.any(String));
    expect(engine.onJobComplete).toHaveBeenCalledWith('job-1', expect.objectContaining({
      conclusion: 'skipped',
      stepResults: expect.arrayContaining([
        expect.objectContaining({ stepNumber: 1, name: 'Step 1', conclusion: 'skipped' }),
        expect.objectContaining({ stepNumber: 2, name: 'Step 2', conclusion: 'skipped' }),
      ]),
    }));
  });

  it('skips job when always() is NOT the condition (unrecognized becomes false)', async () => {
    const engine = createEngine();
    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          if: 'someunknown()',
          steps: [{ run: 'echo ok' }],
        },
      }),
    });
    const state = createInitialState();

    const skipped = await handleJobSkipped(ctx, state);
    expect(skipped).toBe(true);
  });

  it('does not skip job when always() is condition', async () => {
    const ctx = createJobContext({
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          if: 'always()',
          steps: [{ run: 'echo ok' }],
        },
      }),
    });
    const state = createInitialState();

    const skipped = await handleJobSkipped(ctx, state);
    expect(skipped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeStepLoop
// ---------------------------------------------------------------------------

describe('executeStepLoop', () => {
  it('executes all steps sequentially on success', async () => {
    const engine = createEngine();

    // getRunStatus returns 'running' for each step check
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'running' }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })
    );

    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [
            { name: 'Step 1', run: 'echo 1' },
            { name: 'Step 2', run: 'echo 2' },
          ],
        },
      }),
    });
    const state = createInitialState();
    state.runtimeWorkspaceId = 'ws-1';

    const result = await executeStepLoop(ctx, state);

    expect(result).toBeUndefined();
    expect(state.stepResults).toHaveLength(2);
    expect(state.stepResults[0].conclusion).toBe('success');
    expect(state.stepResults[1].conclusion).toBe('success');
    expect(engine.updateStepStatus).toHaveBeenCalledTimes(4); // in_progress + completed for each
  });

  it('cancels when run status is cancelled', async () => {
    const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    const ctx = createJobContext({
      engine: engine as any,
    });
    const state = createInitialState();
    state.runtimeStarted = true;
    state.runtimeWorkspaceId = 'ws-1';

    // Mock runtimeDelete (callRuntimeRequest for DELETE)
    mocks.callRuntimeRequest.mockResolvedValue({ ok: true, status: 200 });

    const result = await executeStepLoop(ctx, state);

    expect(result).toBe('cancelled');
    expect(state.jobConclusion).toBe('cancelled');
    expect(state.runtimeCancelled).toBe(true);
    expect(engine.cancelRun).toHaveBeenCalledWith('run-1');
    expect(engine.storeJobLogs).toHaveBeenCalled();
  });

  it('skips subsequent steps after a failure', async () => {
    const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'running' }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    let stepCallCount = 0;
    mocks.callRuntimeRequest.mockImplementation(async () => {
      stepCallCount++;
      if (stepCallCount === 1) {
        return jsonResponse({
          exitCode: 1,
          stdout: '',
          stderr: 'fail',
          outputs: {},
          conclusion: 'failure',
        });
      }
      return jsonResponse({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      });
    });

    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [
            { name: 'Failing Step', run: 'exit 1' },
            { name: 'Skipped Step', run: 'echo hi' },
          ],
        },
      }),
    });
    const state = createInitialState();
    state.runtimeWorkspaceId = 'ws-1';

    await executeStepLoop(ctx, state);

    expect(state.stepResults).toHaveLength(2);
    expect(state.stepResults[0].conclusion).toBe('failure');
    expect(state.stepResults[1].conclusion).toBe('skipped');
    expect(state.jobConclusion).toBe('failure');
  });

  it('continues on error when step has continue-on-error', async () => {
    const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'running' }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    let stepCallCount = 0;
    mocks.callRuntimeRequest.mockImplementation(async () => {
      stepCallCount++;
      if (stepCallCount === 1) {
        return jsonResponse({
          exitCode: 1,
          stdout: '',
          stderr: 'fail',
          outputs: {},
          conclusion: 'failure',
        });
      }
      return jsonResponse({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      });
    });

    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [
            { name: 'Soft Fail', run: 'exit 1', 'continue-on-error': true },
            { name: 'Should Run', run: 'echo ok' },
          ],
        },
      }),
    });
    const state = createInitialState();
    state.runtimeWorkspaceId = 'ws-1';

    await executeStepLoop(ctx, state);

    expect(state.stepResults).toHaveLength(2);
    expect(state.stepResults[0].conclusion).toBe('failure');
    expect(state.stepResults[1].conclusion).toBe('success');
    // jobConclusion stays success because continue-on-error
    expect(state.jobConclusion).toBe('success');
  });

  it('respects step.if condition to skip a step', async () => {
    const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'running' }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })
    );

    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [
            { name: 'Run Always', run: 'echo ok' },
            { name: 'Conditional Skip', run: 'echo skip', if: '${{ env.DEPLOY }}' },
          ],
        },
      }),
      effectiveJobEnv: {},
    });
    const state = createInitialState();
    state.runtimeWorkspaceId = 'ws-1';

    await executeStepLoop(ctx, state);

    expect(state.stepResults).toHaveLength(2);
    expect(state.stepResults[0].conclusion).toBe('success');
    expect(state.stepResults[1].conclusion).toBe('skipped');
    expect(engine.updateStepStatus).toHaveBeenCalledWith('job-1', 2, 'skipped', 'skipped');
  });

  it('stores step outputs when step has id', async () => {
    const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'running' }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputs: { version: '1.0.0' },
        conclusion: 'success',
      })
    );

    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [{ id: 'get_version', name: 'Get Version', run: 'echo version' }],
        },
      }),
    });
    const state = createInitialState();
    state.runtimeWorkspaceId = 'ws-1';

    await executeStepLoop(ctx, state);

    expect(state.stepOutputs['get_version']).toEqual({ version: '1.0.0' });
  });

  it('runs step with failure() condition after a failed step', async () => {
    const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'running' }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    let stepCallCount = 0;
    mocks.callRuntimeRequest.mockImplementation(async () => {
      stepCallCount++;
      if (stepCallCount === 1) {
        return jsonResponse({
          exitCode: 1,
          stdout: '',
          stderr: 'fail',
          outputs: {},
          conclusion: 'failure',
        });
      }
      return jsonResponse({
        exitCode: 0,
        stdout: 'cleanup done',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      });
    });

    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [
            { name: 'Fail', run: 'exit 1' },
            { name: 'Cleanup', run: 'echo cleanup', if: 'failure()' },
          ],
        },
      }),
    });
    const state = createInitialState();
    state.runtimeWorkspaceId = 'ws-1';

    await executeStepLoop(ctx, state);

    expect(state.stepResults).toHaveLength(2);
    expect(state.stepResults[0].conclusion).toBe('failure');
    expect(state.stepResults[1].conclusion).toBe('success');
  });
});

// ---------------------------------------------------------------------------
// completeJobSuccess
// ---------------------------------------------------------------------------

describe('completeJobSuccess', () => {
  it('completes job with success conclusion', async () => {
    const engine = createEngine();
    const ctx = createJobContext({ engine: engine as any });
    const state = createInitialState();
    state.stepResults = [
      { stepNumber: 1, name: 'Build', status: 'completed', conclusion: 'success', outputs: {} },
    ];

    await completeJobSuccess(ctx, state);

    expect(engine.storeJobLogs).toHaveBeenCalled();
    expect(engine.onJobComplete).toHaveBeenCalledWith('job-1', expect.objectContaining({
      status: 'completed',
      conclusion: 'success',
    }));
    expect(state.completionConclusion).toBe('success');
  });

  it('reports success when job has continue-on-error and conclusion is failure', async () => {
    const engine = createEngine();
    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'echo ok' }],
          'continue-on-error': true,
        },
      }),
    });
    const state = createInitialState();
    state.jobConclusion = 'failure';

    await completeJobSuccess(ctx, state);

    expect(state.completionConclusion).toBe('success');
    expect(engine.onJobComplete).toHaveBeenCalledWith('job-1', expect.objectContaining({
      conclusion: 'success',
    }));
  });

  it('evaluates job outputs from step outputs', async () => {
    const engine = createEngine();
    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [{ id: 'build', run: 'echo ok' }],
          outputs: {
            version: '${{ steps.build.outputs.version }}',
          },
        },
      }),
    });
    const state = createInitialState();
    state.stepOutputs = { build: { version: '1.0.0' } };

    await completeJobSuccess(ctx, state);

    expect(engine.onJobComplete).toHaveBeenCalledWith('job-1', expect.objectContaining({
      outputs: { version: '1.0.0' },
    }));
  });

  it('handles expression evaluation errors gracefully', async () => {
    const engine = createEngine();
    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [{ run: 'echo ok' }],
          outputs: {
            val: '${{ steps.missing.outputs.val }}',
          },
        },
      }),
    });
    const state = createInitialState();

    await completeJobSuccess(ctx, state);

    // Should not throw, val should be omitted since evaluateExpression returns null
    expect(engine.onJobComplete).toHaveBeenCalledWith('job-1', expect.objectContaining({
      outputs: {},
    }));
  });
});

// ---------------------------------------------------------------------------
// completeJobFailure
// ---------------------------------------------------------------------------

describe('completeJobFailure', () => {
  it('sets job conclusion to failure and stores logs', async () => {
    const engine = createEngine();
    const ctx = createJobContext({ engine: engine as any });
    const state = createInitialState();

    await completeJobFailure(ctx, state, new Error('build broke'));

    expect(state.jobConclusion).toBe('failure');
    expect(state.logs).toContain('Error: build broke');
    expect(engine.storeJobLogs).toHaveBeenCalledWith('job-1', expect.stringContaining('build broke'));
    expect(engine.onJobComplete).toHaveBeenCalledWith('job-1', expect.objectContaining({
      conclusion: 'failure',
    }));
  });

  it('marks unseen steps as skipped', async () => {
    const engine = createEngine();
    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [
            { name: 'Step 1', run: 'echo 1' },
            { name: 'Step 2', run: 'echo 2' },
            { name: 'Step 3', run: 'echo 3' },
          ],
        },
      }),
    });
    const state = createInitialState();
    state.stepResults = [
      { stepNumber: 1, name: 'Step 1', status: 'completed', conclusion: 'success', outputs: {} },
    ];

    await completeJobFailure(ctx, state, new Error('oops'));

    expect(state.stepResults).toHaveLength(3);
    expect(state.stepResults[1].conclusion).toBe('skipped');
    expect(state.stepResults[2].conclusion).toBe('skipped');
    expect(engine.updateStepStatus).toHaveBeenCalledWith('job-1', 2, 'skipped', 'skipped');
    expect(engine.updateStepStatus).toHaveBeenCalledWith('job-1', 3, 'skipped', 'skipped');
  });

  it('converts non-Error to string for error message', async () => {
    const engine = createEngine();
    const ctx = createJobContext({ engine: engine as any });
    const state = createInitialState();

    await completeJobFailure(ctx, state, 'string error');

    expect(state.logs).toContain('Error: string error');
  });

  it('handles storeJobLogs failure gracefully', async () => {
    const engine = createEngine();
    engine.storeJobLogs.mockRejectedValue(new Error('log storage failed'));

    const ctx = createJobContext({ engine: engine as any });
    const state = createInitialState();

    // Should not throw from storeJobLogs failure
    await completeJobFailure(ctx, state, new Error('original error'));

    expect(engine.onJobComplete).toHaveBeenCalled();
  });

  it('re-throws when onJobComplete fails', async () => {
    const engine = createEngine();
    engine.onJobComplete.mockRejectedValue(new Error('db write failed'));

    const ctx = createJobContext({ engine: engine as any });
    const state = createInitialState();

    await expect(completeJobFailure(ctx, state, new Error('original'))).rejects.toThrow('db write failed');
  });

  it('handles updateStepStatus failure gracefully', async () => {
    const engine = createEngine();
    engine.updateStepStatus.mockRejectedValue(new Error('step update failed'));

    const ctx = createJobContext({
      engine: engine as any,
      message: createMessage({
        jobDefinition: {
          name: 'Build',
          'runs-on': 'ubuntu-latest',
          steps: [
            { name: 'Step 1', run: 'echo 1' },
            { name: 'Step 2', run: 'echo 2' },
          ],
        },
      }),
    });
    const state = createInitialState();

    // Should not throw from updateStepStatus failure
    await completeJobFailure(ctx, state, new Error('original'));

    expect(engine.onJobComplete).toHaveBeenCalled();
  });
});
