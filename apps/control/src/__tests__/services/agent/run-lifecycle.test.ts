import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/logger', () => ({
  logError: vi.fn(),
}));

import {
  RunCancelledError,
  shouldResetRunToQueuedOnContainerError,
  handleSuccessfulRunCompletion,
  handleCancelledRun,
  handleFailedRun,
  type RunLifecycleDeps,
} from '@/services/agent/run-lifecycle';

function createMockDeps(): RunLifecycleDeps {
  return {
    updateRunStatus: vi.fn(async () => {}),
    emitEvent: vi.fn(async () => {}),
    buildTerminalEventPayload: vi.fn((status, details) => ({
      run: { id: 'run-1', status, ...details },
    })) as any,
    autoCloseSession: vi.fn(async () => {}),
    enqueuePostRunJobs: vi.fn(async () => {}),
    sanitizeErrorMessage: vi.fn((msg: string) => msg.slice(0, 100)),
  };
}

describe('RunCancelledError', () => {
  it('creates an error with default message', () => {
    const err = new RunCancelledError();
    expect(err.name).toBe('RunCancelledError');
    expect(err.message).toBe('Run cancelled');
    expect(err).toBeInstanceOf(Error);
  });

  it('creates an error with custom message', () => {
    const err = new RunCancelledError('Custom cancellation');
    expect(err.message).toBe('Custom cancellation');
  });
});

describe('shouldResetRunToQueuedOnContainerError', () => {
  it('resets only actively running runs', () => {
    expect(shouldResetRunToQueuedOnContainerError('running')).toBe(true);
  });

  it('does not reset non-running statuses', () => {
    expect(shouldResetRunToQueuedOnContainerError('queued')).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError('pending')).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError('completed')).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError('failed')).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError('cancelled')).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(shouldResetRunToQueuedOnContainerError(null)).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError(undefined)).toBe(false);
  });
});

describe('handleSuccessfulRunCompletion', () => {
  let deps: RunLifecycleDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('enqueues post-run jobs and auto-closes session on success', async () => {
    await handleSuccessfulRunCompletion(deps);

    expect(deps.enqueuePostRunJobs).toHaveBeenCalled();
    expect(deps.autoCloseSession).toHaveBeenCalledWith('completed');
  });

  it('calls enqueuePostRunJobs before autoCloseSession', async () => {
    const callOrder: string[] = [];
    (deps.enqueuePostRunJobs as any).mockImplementation(async () => callOrder.push('enqueue'));
    (deps.autoCloseSession as any).mockImplementation(async () => callOrder.push('close'));

    await handleSuccessfulRunCompletion(deps);
    expect(callOrder).toEqual(['enqueue', 'close']);
  });
});

describe('handleCancelledRun', () => {
  let deps: RunLifecycleDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('updates status to cancelled and emits cancelled event', async () => {
    await handleCancelledRun(deps);

    expect(deps.updateRunStatus).toHaveBeenCalledWith('cancelled', undefined, 'Run cancelled');
    expect(deps.emitEvent).toHaveBeenCalledWith(
      'cancelled',
      expect.objectContaining({ run: expect.objectContaining({ status: 'cancelled' }) }),
    );
  });

  it('auto-closes session as failed', async () => {
    await handleCancelledRun(deps);
    expect(deps.autoCloseSession).toHaveBeenCalledWith('failed');
  });

  it('enqueues post-run jobs', async () => {
    await handleCancelledRun(deps);
    expect(deps.enqueuePostRunJobs).toHaveBeenCalled();
  });
});

describe('handleFailedRun', () => {
  let deps: RunLifecycleDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('updates status to failed with sanitized error message', async () => {
    await handleFailedRun(deps, new Error('Something went wrong'));

    expect(deps.sanitizeErrorMessage).toHaveBeenCalled();
    expect(deps.updateRunStatus).toHaveBeenCalledWith(
      'failed',
      undefined,
      expect.any(String),
    );
  });

  it('emits error event with terminal payload', async () => {
    await handleFailedRun(deps, 'Raw error string');

    expect(deps.emitEvent).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ run: expect.any(Object) }),
    );
  });

  it('auto-closes session as failed', async () => {
    await handleFailedRun(deps, new Error('fail'));
    expect(deps.autoCloseSession).toHaveBeenCalledWith('failed');
  });

  it('enqueues post-run jobs', async () => {
    await handleFailedRun(deps, new Error('fail'));
    expect(deps.enqueuePostRunJobs).toHaveBeenCalled();
  });

  it('converts non-Error objects to string', async () => {
    await handleFailedRun(deps, { code: 500, message: 'Internal error' });
    expect(deps.updateRunStatus).toHaveBeenCalledWith(
      'failed',
      undefined,
      expect.any(String),
    );
  });
});
