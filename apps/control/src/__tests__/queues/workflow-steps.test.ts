import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callRuntimeRequest: vi.fn(),
}));

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: mocks.callRuntimeRequest,
}));

// Needed by workflow-runtime-client import chain
vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: vi.fn() };
});

vi.mock('@/utils', () => ({
  safeJsonParseOrDefault: vi.fn(),
}));

vi.mock('@/services/execution/workflow-engine', () => ({
  createWorkflowEngine: vi.fn(),
}));

import { executeStep } from '@/queues/workflow-steps';
import type { StepExecutionContext } from '@/queues/workflow-types';
import type { Step } from '@takos/actions-engine';

function createContext(overrides: Partial<StepExecutionContext> = {}): StepExecutionContext {
  return {
    env: {
      RUNTIME_HOST: { fetch: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeStep', () => {
  it('returns success for step with no uses and no run', async () => {
    const step: Step = {};
    const result = await executeStep(step, createContext());

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('No action to perform');
    expect(result.outputs).toEqual({});
  });

  it('returns failure when RUNTIME_HOST is not configured', async () => {
    const step: Step = { run: 'echo test' };
    const ctx = createContext({
      env: {} as any,
    });

    const result = await executeStep(step, ctx);

    expect(result.success).toBe(false);
    expect(result.error).toBe('RUNTIME_HOST binding is required');
  });

  it('executes a run step via runtime', async () => {
    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 0,
        stdout: 'hello world',
        stderr: '',
        outputs: { result: 'ok' },
        conclusion: 'success',
      })
    );

    const step: Step = { run: 'echo hello' };
    const result = await executeStep(step, createContext());

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello world');
    expect(result.outputs).toEqual({ result: 'ok' });
    expect(result.error).toBeUndefined();
  });

  it('executes a uses step via runtime', async () => {
    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 0,
        stdout: 'action output',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })
    );

    const step: Step = {
      uses: 'actions/checkout@v4',
      with: { fetch_depth: 1 },
    };
    const result = await executeStep(step, createContext());

    expect(result.success).toBe(true);
    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(
      expect.anything(),
      '/actions/jobs/job-1/step/1',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          uses: 'actions/checkout@v4',
          with: { fetch_depth: 1 },
          space_id: 'space-1',
        }),
      })
    );
  });

  it('returns failure when conclusion is failure', async () => {
    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 1,
        stdout: '',
        stderr: 'command not found',
        outputs: {},
        conclusion: 'failure',
      })
    );

    const step: Step = { run: 'invalid-command' };
    const result = await executeStep(step, createContext());

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe('command not found');
  });

  it('uses "Step failed" as error when stderr is empty', async () => {
    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 1,
        stdout: '',
        stderr: '',
        outputs: {},
        conclusion: 'failure',
      })
    );

    const step: Step = { run: 'false' };
    const result = await executeStep(step, createContext());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Step failed');
  });

  it('passes shell and working-directory to runtime', async () => {
    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 0,
        stdout: 'ok',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })
    );

    const step: Step = { run: 'echo test' };
    const ctx = createContext({ shell: 'bash', workingDirectory: '/app' });
    await executeStep(step, ctx);

    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(
      expect.anything(),
      '/actions/jobs/job-1/step/1',
      expect.objectContaining({
        body: expect.objectContaining({
          shell: 'bash',
          'working-directory': '/app',
        }),
      })
    );
  });

  it('passes step env, name, and timeout to runtime', async () => {
    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 0,
        stdout: '',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })
    );

    const step: Step = {
      run: 'echo test',
      name: 'My Step',
      env: { NODE_ENV: 'test' },
      'continue-on-error': true,
      'timeout-minutes': 10,
    };
    await executeStep(step, createContext());

    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        body: expect.objectContaining({
          name: 'My Step',
          env: { NODE_ENV: 'test' },
          'continue-on-error': true,
          'timeout-minutes': 10,
        }),
      })
    );
  });

  it('handles missing outputs in response', async () => {
    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 0,
        stdout: 'done',
        stderr: '',
        conclusion: 'success',
        // no outputs field
      })
    );

    const step: Step = { run: 'echo done' };
    const result = await executeStep(step, createContext());

    expect(result.success).toBe(true);
    expect(result.outputs).toEqual({});
  });

  it('uses correct endpoint for step number', async () => {
    mocks.callRuntimeRequest.mockResolvedValue(
      jsonResponse({
        exitCode: 0,
        stdout: '',
        stderr: '',
        outputs: {},
        conclusion: 'success',
      })
    );

    const step: Step = { run: 'echo test' };
    await executeStep(step, createContext({ stepNumber: 5, jobId: 'job-42' }));

    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(
      expect.anything(),
      '/actions/jobs/job-42/step/5',
      expect.anything()
    );
  });
});
