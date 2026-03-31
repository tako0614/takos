// [Deno] vi.mock removed - manually stub imports from '@/services/agent/runner'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/run-lifecycle'
import { executeRun } from '@/services/agent/runner';
import { shouldResetRunToQueuedOnContainerError } from '@/services/agent/run-lifecycle';


import { assertEquals, assert } from 'jsr:@std/assert';

  Deno.test('public-runner re-exports - re-exports executeRun from runner module', () => {
  assert(executeRun !== undefined);
    assertEquals(typeof executeRun, 'function');
})
  Deno.test('public-runner re-exports - re-exports shouldResetRunToQueuedOnContainerError from run-lifecycle', () => {
  assert(shouldResetRunToQueuedOnContainerError !== undefined);
    assertEquals(typeof shouldResetRunToQueuedOnContainerError, 'function');
})
  Deno.test('public-runner re-exports - executeRun is callable', async () => {
  const result = await (executeRun as Function)();
    assertEquals(result, { success: true });
})
  Deno.test('public-runner re-exports - shouldResetRunToQueuedOnContainerError returns correct values', () => {
  assertEquals(shouldResetRunToQueuedOnContainerError('running'), true);
    assertEquals(shouldResetRunToQueuedOnContainerError('completed' as any), false);
})