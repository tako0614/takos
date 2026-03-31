import { shouldResetRunToQueuedOnContainerError } from '@/services/agent/run-lifecycle';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('shouldResetRunToQueuedOnContainerError - resets only actively running runs', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError('running'), true);
    assertEquals(shouldResetRunToQueuedOnContainerError('queued'), false);
    assertEquals(shouldResetRunToQueuedOnContainerError('pending'), false);
    assertEquals(shouldResetRunToQueuedOnContainerError('completed'), false);
    assertEquals(shouldResetRunToQueuedOnContainerError('failed'), false);
    assertEquals(shouldResetRunToQueuedOnContainerError('cancelled'), false);
    assertEquals(shouldResetRunToQueuedOnContainerError(null), false);
    assertEquals(shouldResetRunToQueuedOnContainerError(undefined), false);
})