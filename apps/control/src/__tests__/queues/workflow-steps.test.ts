import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  callRuntimeRequest: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// Needed by workflow-runtime-client import chain
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/workflow-engine'
import { executeStep } from '@/queues/workflow-steps';
import type { StepExecutionContext } from '@/queues/workflow-types';
import type { Step } from 'takos-actions-engine';

function createContext(overrides: Partial<StepExecutionContext> = {}): StepExecutionContext {
  return {
    env: {
      RUNTIME_HOST: { fetch: ((..._args: any[]) => undefined) as any },
    } as any,
    jobId: 'job-1',
    stepNumber: 1,
    spaceId: 'space-1',
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

  Deno.test('executeStep - returns success for step with no uses and no run', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const step: Step = {};
    const result = await executeStep(step, createContext());

    assertEquals(result.success, true);
    assertEquals(result.stdout, 'No action to perform');
    assertEquals(result.outputs, {});
})
  Deno.test('executeStep - returns failure when RUNTIME_HOST is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const step: Step = { run: 'echo test' };
    const ctx = createContext({
      env: {} as any,
    });

    const result = await executeStep(step, ctx);

    assertEquals(result.success, false);
    assertEquals(result.error, 'RUNTIME_HOST binding is required');
})
  Deno.test('executeStep - executes a run step via runtime', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 0,
        stdout: 'hello world',
        stderr: '',
        outputs: { result: 'ok' },
        conclusion: 'success',
      })) as any;

    const step: Step = { run: 'echo hello' };
    const result = await executeStep(step, createContext());

    assertEquals(result.success, true);
    assertEquals(result.exitCode, 0);
    assertEquals(result.stdout, 'hello world');
    assertEquals(result.outputs, { result: 'ok' });
    assertEquals(result.error, undefined);
})
  Deno.test('executeStep - executes a uses step via runtime', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 0,
        stdout: 'action output',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })) as any;

    const step: Step = {
      uses: 'actions/checkout@v4',
      with: { fetch_depth: 1 },
    };
    const result = await executeStep(step, createContext());

    assertEquals(result.success, true);
    assertSpyCallArgs(mocks.callRuntimeRequest, 0, [
      expect.anything(),
      '/actions/jobs/job-1/step/1',
      ({
        method: 'POST',
        body: ({
          uses: 'actions/checkout@v4',
          with: { fetch_depth: 1 },
          space_id: 'space-1',
        }),
      })
    ]);
})
  Deno.test('executeStep - returns failure when conclusion is failure', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 1,
        stdout: '',
        stderr: 'command not found',
        outputs: {},
        conclusion: 'failure',
      })) as any;

    const step: Step = { run: 'invalid-command' };
    const result = await executeStep(step, createContext());

    assertEquals(result.success, false);
    assertEquals(result.exitCode, 1);
    assertEquals(result.error, 'command not found');
})
  Deno.test('executeStep - uses "Step failed" as error when stderr is empty', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 1,
        stdout: '',
        stderr: '',
        outputs: {},
        conclusion: 'failure',
      })) as any;

    const step: Step = { run: 'false' };
    const result = await executeStep(step, createContext());

    assertEquals(result.success, false);
    assertEquals(result.error, 'Step failed');
})
  Deno.test('executeStep - passes shell and working-directory to runtime', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })) as any;

    const step: Step = { run: 'echo test' };
    const ctx = createContext({ shell: 'bash', workingDirectory: '/app' });
    await executeStep(step, ctx);

    assertSpyCallArgs(mocks.callRuntimeRequest, 0, [
      expect.anything(),
      '/actions/jobs/job-1/step/1',
      ({
        body: ({
          shell: 'bash',
          'working-directory': '/app',
        }),
      })
    ]);
})
  Deno.test('executeStep - passes step env, name, and timeout to runtime', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 0,
        stdout: '',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })) as any;

    const step: Step = {
      run: 'echo test',
      name: 'My Step',
      env: { NODE_ENV: 'test' },
      'continue-on-error': true,
      'timeout-minutes': 10,
    };
    await executeStep(step, createContext());

    assertSpyCallArgs(mocks.callRuntimeRequest, 0, [
      expect.anything(),
      /* expect.any(String) */ {} as any,
      ({
        body: ({
          name: 'My Step',
          env: { NODE_ENV: 'test' },
          'continue-on-error': true,
          'timeout-minutes': 10,
        }),
      })
    ]);
})
  Deno.test('executeStep - handles missing outputs in response', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        conclusion: 'success',
        // no outputs field
      })) as any;

    const step: Step = { run: 'echo done' };
    const result = await executeStep(step, createContext());

    assertEquals(result.success, true);
    assertEquals(result.outputs, {});
})
  Deno.test('executeStep - uses correct endpoint for step number', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => jsonResponse({
        exitCode: 0,
        stdout: '',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })) as any;

    const step: Step = { run: 'echo test' };
    await executeStep(step, createContext({ stepNumber: 5, jobId: 'job-42' }));

    assertSpyCallArgs(mocks.callRuntimeRequest, 0, [
      expect.anything(),
      '/actions/jobs/job-42/step/5',
      expect.anything()
    ]);
})