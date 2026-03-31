import { assertEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  callRuntimeRequest: ((..._args: any[]) => undefined) as any,
  safeJsonParseOrDefault: ((..._args: any[]) => undefined) as any,
  createWorkflowEngine: ((..._args: any[]) => undefined) as any,
  getRunNotifierStub: ((..._args: any[]) => undefined) as any,
  buildRunNotifierEmitRequest: ((..._args: any[]) => undefined) as any,
  buildRunNotifierEmitPayload: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/workflow-engine'
// [Deno] vi.mock removed - manually stub imports from '@/services/run-notifier-client'
// [Deno] vi.mock removed - manually stub imports from '@/services/run-notifier-payload'
import {
  handleJobSkipped,
  executeStepLoop,
  completeJobSuccess,
  completeJobFailure,
} from '@/queues/workflow-job-phases';
import { createInitialState } from '@/queues/workflow-types';
import type { JobQueueContext, JobExecutionState } from '@/queues/workflow-types';
import type { WorkflowJobQueueMessage } from '@/types';
import { WORKFLOW_QUEUE_MESSAGE_VERSION } from '@/types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createDrizzleMock(opts: {
  selectGet?: ReturnType<typeof vi.fn>;
  selectAll?: ReturnType<typeof vi.fn>;
} = {}) {
  const selectGet = opts.selectGet ?? (async () => null);
  const selectAll = opts.selectAll ?? (async () => []);

  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = (() => c);
    c.where = (() => c);
    c.orderBy = (() => c);
    c.limit = (() => c);
    c.get = selectGet;
    c.all = selectAll;
    return c;
  };

  const updateChain = () => {
    const c: Record<string, unknown> = {};
    c.set = (() => c);
    c.where = (async () => ({ meta: { changes: 1 } }));
    return c;
  };

  return {
    select: () => chain(),
    update: () => updateChain(),
    insert: () => ({
      values: (() => ({
        returning: (() => ({ get: (async () => ({ id: 1 })) })),
      })),
    }),
    delete: () => ({ where: (async () => undefined) }),
  };
}

function createEngine() {
  return {
    onJobStart: (async () => undefined),
    onJobComplete: (async () => undefined),
    updateStepStatus: (async () => undefined),
    storeJobLogs: (async () => undefined),
    cancelRun: (async () => undefined),
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

function createJobQueueContext(overrides: Partial<JobQueueContext> = {}): JobQueueContext {
  return {
    env: {
      DB: {} as any,
      RUN_NOTIFIER: {} as any,
      RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
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
// ---------------------------------------------------------------------------
// handleJobSkipped
// ---------------------------------------------------------------------------


  Deno.test('handleJobSkipped - returns false when job has no if condition', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const ctx = createJobQueueContext();
    const state = createInitialState();

    const skipped = await handleJobSkipped(ctx, state);

    assertEquals(skipped, false);
})
  Deno.test('handleJobSkipped - returns false when condition evaluates to true', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const ctx = createJobQueueContext({
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
    assertEquals(skipped, false);
})
  Deno.test('handleJobSkipped - returns true and marks job as skipped when condition is false', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    const ctx = createJobQueueContext({
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

    assertEquals(skipped, true);
    assertEquals(state.jobConclusion, 'skipped');
    assertStringIncludes(state.logs, 'Job skipped (condition not met): ${{ env.MISSING_VAR }}');
    assertSpyCallArgs(engine.storeJobLogs, 0, ['job-1', /* expect.any(String) */ {} as any]);
    assertSpyCallArgs(engine.onJobComplete, 0, ['job-1', ({
      conclusion: 'skipped',
      stepResults: ([
        ({ stepNumber: 1, name: 'Step 1', conclusion: 'skipped' }),
        ({ stepNumber: 2, name: 'Step 2', conclusion: 'skipped' }),
      ]),
    })]);
})
  Deno.test('handleJobSkipped - skips job when always() is NOT the condition (unrecognized becomes false)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    const ctx = createJobQueueContext({
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
    assertEquals(skipped, true);
})
  Deno.test('handleJobSkipped - does not skip job when always() is condition', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const ctx = createJobQueueContext({
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
    assertEquals(skipped, false);
})
// ---------------------------------------------------------------------------
// executeStepLoop
// ---------------------------------------------------------------------------


  Deno.test('executeStepLoop - executes all steps sequentially on success', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();

    // getRunStatus returns 'running' for each step check
    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'running' })),
    });
    mocks.getDb = (() => dbMock) as any;

    mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })) as any;

    const ctx = createJobQueueContext({
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
    state.runtimeSpaceId = 'ws-1';

    const result = await executeStepLoop(ctx, state);

    assertEquals(result, undefined);
    assertEquals(state.stepResults.length, 2);
    assertEquals(state.stepResults[0].conclusion, 'success');
    assertEquals(state.stepResults[1].conclusion, 'success');
    assertSpyCalls(engine.updateStepStatus, 4); // in_progress + completed for each
})
  Deno.test('executeStepLoop - cancels when run status is cancelled', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'cancelled' })),
    });
    mocks.getDb = (() => dbMock) as any;

    const ctx = createJobQueueContext({
      engine: engine as any,
    });
    const state = createInitialState();
    state.runtimeStarted = true;
    state.runtimeSpaceId = 'ws-1';

    // Mock runtimeDelete (callRuntimeRequest for DELETE)
    mocks.callRuntimeRequest = (async () => ({ ok: true, status: 200 })) as any;

    const result = await executeStepLoop(ctx, state);

    assertEquals(result, 'cancelled');
    assertEquals(state.jobConclusion, 'cancelled');
    assertEquals(state.runtimeCancelled, true);
    assertSpyCallArgs(engine.cancelRun, 0, ['run-1']);
    assert(engine.storeJobLogs.calls.length > 0);
})
  Deno.test('executeStepLoop - skips subsequent steps after a failure', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'running' })),
    });
    mocks.getDb = (() => dbMock) as any;

    let stepCallCount = 0;
    mocks.callRuntimeRequest = async () => {
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
    } as any;

    const ctx = createJobQueueContext({
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
    state.runtimeSpaceId = 'ws-1';

    await executeStepLoop(ctx, state);

    assertEquals(state.stepResults.length, 2);
    assertEquals(state.stepResults[0].conclusion, 'failure');
    assertEquals(state.stepResults[1].conclusion, 'skipped');
    assertEquals(state.jobConclusion, 'failure');
})
  Deno.test('executeStepLoop - continues on error when step has continue-on-error', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'running' })),
    });
    mocks.getDb = (() => dbMock) as any;

    let stepCallCount = 0;
    mocks.callRuntimeRequest = async () => {
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
    } as any;

    const ctx = createJobQueueContext({
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
    state.runtimeSpaceId = 'ws-1';

    await executeStepLoop(ctx, state);

    assertEquals(state.stepResults.length, 2);
    assertEquals(state.stepResults[0].conclusion, 'failure');
    assertEquals(state.stepResults[1].conclusion, 'success');
    // jobConclusion stays success because continue-on-error
    assertEquals(state.jobConclusion, 'success');
})
  Deno.test('executeStepLoop - respects step.if condition to skip a step', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'running' })),
    });
    mocks.getDb = (() => dbMock) as any;

    mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })) as any;

    const ctx = createJobQueueContext({
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
    state.runtimeSpaceId = 'ws-1';

    await executeStepLoop(ctx, state);

    assertEquals(state.stepResults.length, 2);
    assertEquals(state.stepResults[0].conclusion, 'success');
    assertEquals(state.stepResults[1].conclusion, 'skipped');
    assertSpyCallArgs(engine.updateStepStatus, 0, ['job-1', 2, 'skipped', 'skipped']);
})
  Deno.test('executeStepLoop - stores step outputs when step has id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'running' })),
    });
    mocks.getDb = (() => dbMock) as any;

    mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputs: { version: '1.0.0' },
        conclusion: 'success',
      })) as any;

    const ctx = createJobQueueContext({
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
    state.runtimeSpaceId = 'ws-1';

    await executeStepLoop(ctx, state);

    assertEquals(state.stepOutputs['get_version'], { version: '1.0.0' });
})
  Deno.test('executeStepLoop - runs step with failure() condition after a failed step', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'running' })),
    });
    mocks.getDb = (() => dbMock) as any;

    let stepCallCount = 0;
    mocks.callRuntimeRequest = async () => {
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
    } as any;

    const ctx = createJobQueueContext({
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
    state.runtimeSpaceId = 'ws-1';

    await executeStepLoop(ctx, state);

    assertEquals(state.stepResults.length, 2);
    assertEquals(state.stepResults[0].conclusion, 'failure');
    assertEquals(state.stepResults[1].conclusion, 'success');
})
// ---------------------------------------------------------------------------
// completeJobSuccess
// ---------------------------------------------------------------------------


  Deno.test('completeJobSuccess - completes job with success conclusion', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    const ctx = createJobQueueContext({ engine: engine as any });
    const state = createInitialState();
    state.stepResults = [
      { stepNumber: 1, name: 'Build', status: 'completed', conclusion: 'success', outputs: {} },
    ];

    await completeJobSuccess(ctx, state);

    assert(engine.storeJobLogs.calls.length > 0);
    assertSpyCallArgs(engine.onJobComplete, 0, ['job-1', ({
      status: 'completed',
      conclusion: 'success',
    })]);
    assertEquals(state.completionConclusion, 'success');
})
  Deno.test('completeJobSuccess - reports success when job has continue-on-error and conclusion is failure', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    const ctx = createJobQueueContext({
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

    assertEquals(state.completionConclusion, 'success');
    assertSpyCallArgs(engine.onJobComplete, 0, ['job-1', ({
      conclusion: 'success',
    })]);
})
  Deno.test('completeJobSuccess - evaluates job outputs from step outputs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    const ctx = createJobQueueContext({
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

    assertSpyCallArgs(engine.onJobComplete, 0, ['job-1', ({
      outputs: { version: '1.0.0' },
    })]);
})
  Deno.test('completeJobSuccess - handles expression evaluation errors gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    const ctx = createJobQueueContext({
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
    assertSpyCallArgs(engine.onJobComplete, 0, ['job-1', ({
      outputs: {},
    })]);
})
// ---------------------------------------------------------------------------
// completeJobFailure
// ---------------------------------------------------------------------------


  Deno.test('completeJobFailure - sets job conclusion to failure and stores logs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    const ctx = createJobQueueContext({ engine: engine as any });
    const state = createInitialState();

    await completeJobFailure(ctx, state, new Error('build broke'));

    assertEquals(state.jobConclusion, 'failure');
    assertStringIncludes(state.logs, 'Error: build broke');
    assertSpyCallArgs(engine.storeJobLogs, 0, ['job-1', expect.stringContaining('build broke')]);
    assertSpyCallArgs(engine.onJobComplete, 0, ['job-1', ({
      conclusion: 'failure',
    })]);
})
  Deno.test('completeJobFailure - marks unseen steps as skipped', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    const ctx = createJobQueueContext({
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

    assertEquals(state.stepResults.length, 3);
    assertEquals(state.stepResults[1].conclusion, 'skipped');
    assertEquals(state.stepResults[2].conclusion, 'skipped');
    assertSpyCallArgs(engine.updateStepStatus, 0, ['job-1', 2, 'skipped', 'skipped']);
    assertSpyCallArgs(engine.updateStepStatus, 0, ['job-1', 3, 'skipped', 'skipped']);
})
  Deno.test('completeJobFailure - converts non-Error to string for error message', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    const ctx = createJobQueueContext({ engine: engine as any });
    const state = createInitialState();

    await completeJobFailure(ctx, state, 'string error');

    assertStringIncludes(state.logs, 'Error: string error');
})
  Deno.test('completeJobFailure - handles storeJobLogs failure gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    engine.storeJobLogs = (async () => { throw new Error('log storage failed'); }) as any;

    const ctx = createJobQueueContext({ engine: engine as any });
    const state = createInitialState();

    // Should not throw from storeJobLogs failure
    await completeJobFailure(ctx, state, new Error('original error'));

    assert(engine.onJobComplete.calls.length > 0);
})
  Deno.test('completeJobFailure - re-throws when onJobComplete fails', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    engine.onJobComplete = (async () => { throw new Error('db write failed'); }) as any;

    const ctx = createJobQueueContext({ engine: engine as any });
    const state = createInitialState();

    await await assertRejects(async () => { await completeJobFailure(ctx, state, new Error('original')); }, 'db write failed');
})
  Deno.test('completeJobFailure - handles updateStepStatus failure gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.example.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  const engine = createEngine();
    engine.updateStepStatus = (async () => { throw new Error('step update failed'); }) as any;

    const ctx = createJobQueueContext({
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

    assert(engine.onJobComplete.calls.length > 0);
})