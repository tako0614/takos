// [Deno] vi.mock removed - manually stub imports from '@/utils/logger'
import {
  RunCancelledError,
  shouldResetRunToQueuedOnContainerError,
  handleSuccessfulRunCompletion,
  handleCancelledRun,
  handleFailedRun,
  type RunLifecycleDeps,
} from '@/services/agent/run-lifecycle';

import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

function createMockDeps(): RunLifecycleDeps {
  return {
    updateRunStatus: async () => {},
    emitEvent: async () => {},
    buildTerminalEventPayload: (status, details) => ({
      run: { id: 'run-1', status, ...details },
    }) as any,
    autoCloseSession: async () => {},
    enqueuePostRunJobs: async () => {},
    sanitizeErrorMessage: (msg: string) => msg.slice(0, 100),
  };
}


  Deno.test('RunCancelledError - creates an error with default message', () => {
  const err = new RunCancelledError();
    assertEquals(err.name, 'RunCancelledError');
    assertEquals(err.message, 'Run cancelled');
    assert(err instanceof Error);
})
  Deno.test('RunCancelledError - creates an error with custom message', () => {
  const err = new RunCancelledError('Custom cancellation');
    assertEquals(err.message, 'Custom cancellation');
})

  Deno.test('shouldResetRunToQueuedOnContainerError - resets only actively running runs', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError('running'), true);
})
  Deno.test('shouldResetRunToQueuedOnContainerError - does not reset non-running statuses', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError('queued'), false);
    assertEquals(shouldResetRunToQueuedOnContainerError('pending'), false);
    assertEquals(shouldResetRunToQueuedOnContainerError('completed'), false);
    assertEquals(shouldResetRunToQueuedOnContainerError('failed'), false);
    assertEquals(shouldResetRunToQueuedOnContainerError('cancelled'), false);
})
  Deno.test('shouldResetRunToQueuedOnContainerError - handles null and undefined', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError(null), false);
    assertEquals(shouldResetRunToQueuedOnContainerError(undefined), false);
})

  let deps: RunLifecycleDeps;
  Deno.test('handleSuccessfulRunCompletion - enqueues post-run jobs and auto-closes session on success', async () => {
  deps = createMockDeps();
  await handleSuccessfulRunCompletion(deps);

    assert(deps.enqueuePostRunJobs.calls.length > 0);
    assertSpyCallArgs(deps.autoCloseSession, 0, ['completed']);
})
  Deno.test('handleSuccessfulRunCompletion - calls enqueuePostRunJobs before autoCloseSession', async () => {
  deps = createMockDeps();
  const callOrder: string[] = [];
    (deps.enqueuePostRunJobs as any) = async () => callOrder.push('enqueue') as any;
    (deps.autoCloseSession as any) = async () => callOrder.push('close') as any;

    await handleSuccessfulRunCompletion(deps);
    assertEquals(callOrder, ['enqueue', 'close']);
})

  let deps: RunLifecycleDeps;
  Deno.test('handleCancelledRun - updates status to cancelled and emits cancelled event', async () => {
  deps = createMockDeps();
  await handleCancelledRun(deps);

    assertSpyCallArgs(deps.updateRunStatus, 0, ['cancelled', undefined, 'Run cancelled']);
    assertSpyCallArgs(deps.emitEvent, 0, [
      'cancelled',
      ({ run: ({ status: 'cancelled' }) }),
    ]);
})
  Deno.test('handleCancelledRun - auto-closes session as failed', async () => {
  deps = createMockDeps();
  await handleCancelledRun(deps);
    assertSpyCallArgs(deps.autoCloseSession, 0, ['failed']);
})
  Deno.test('handleCancelledRun - enqueues post-run jobs', async () => {
  deps = createMockDeps();
  await handleCancelledRun(deps);
    assert(deps.enqueuePostRunJobs.calls.length > 0);
})

  let deps: RunLifecycleDeps;
  Deno.test('handleFailedRun - updates status to failed with sanitized error message', async () => {
  deps = createMockDeps();
  await handleFailedRun(deps, new Error('Something went wrong'));

    assert(deps.sanitizeErrorMessage.calls.length > 0);
    assertSpyCallArgs(deps.updateRunStatus, 0, [
      'failed',
      undefined,
      /* expect.any(String) */ {} as any,
    ]);
})
  Deno.test('handleFailedRun - emits error event with terminal payload', async () => {
  deps = createMockDeps();
  await handleFailedRun(deps, 'Raw error string');

    assertSpyCallArgs(deps.emitEvent, 0, [
      'error',
      ({ run: /* expect.any(Object) */ {} as any }),
    ]);
})
  Deno.test('handleFailedRun - auto-closes session as failed', async () => {
  deps = createMockDeps();
  await handleFailedRun(deps, new Error('fail'));
    assertSpyCallArgs(deps.autoCloseSession, 0, ['failed']);
})
  Deno.test('handleFailedRun - enqueues post-run jobs', async () => {
  deps = createMockDeps();
  await handleFailedRun(deps, new Error('fail'));
    assert(deps.enqueuePostRunJobs.calls.length > 0);
})
  Deno.test('handleFailedRun - converts non-Error objects to string', async () => {
  deps = createMockDeps();
  await handleFailedRun(deps, { code: 500, message: 'Internal error' });
    assertSpyCallArgs(deps.updateRunStatus, 0, [
      'failed',
      undefined,
      /* expect.any(String) */ {} as any,
    ]);
})