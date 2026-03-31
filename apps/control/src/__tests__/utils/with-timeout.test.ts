import { withTimeout } from '@/utils/with-timeout';


import { assertEquals, assert, assertRejects } from 'jsr:@std/assert';
import { stub } from 'jsr:@std/testing/mock';
import { FakeTime } from 'jsr:@std/testing/time';

  Deno.test('withTimeout - resolves when promise completes before timeout', async () => {
  const result = await withTimeout(
      Promise.resolve('ok'),
      1000,
      'Timed out'
    );
    assertEquals(result, 'ok');
})
  Deno.test('withTimeout - rejects with timeout error when promise is too slow', async () => {
  new FakeTime();
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 5000);
    });

    const promise = withTimeout(slow, 100, 'Operation timed out');
    fakeTime.tick(150);

    await await assertRejects(async () => { await promise; }, 'Operation timed out');
    /* TODO: call fakeTime.restore() */ void 0;
})
  Deno.test('withTimeout - propagates the original error if promise rejects before timeout', async () => {
  const failing = Promise.reject(new Error('original error'));
    await await assertRejects(async () => { await 
      withTimeout(failing, 5000, 'Timed out')
    ; }, 'original error');
})
  Deno.test('withTimeout - accepts a factory function and passes abort signal', async () => {
  let receivedSignal: AbortSignal | undefined;

    const result = await withTimeout(
      (signal) => {
        receivedSignal = signal;
        return Promise.resolve(42);
      },
      1000,
      'Timed out'
    );

    assertEquals(result, 42);
    assert(receivedSignal instanceof AbortSignal);
})
  Deno.test('withTimeout - aborts the signal on timeout', async () => {
  new FakeTime();
    let receivedSignal: AbortSignal | undefined;

    const promise = withTimeout(
      (signal) => {
        receivedSignal = signal;
        return new Promise<string>((resolve) => {
          setTimeout(() => resolve('done'), 5000);
        });
      },
      100,
      'Timed out'
    );

    fakeTime.tick(150);
    await await assertRejects(async () => { await promise; }, 'Timed out');
    assertEquals(receivedSignal?.aborted, true);
    /* TODO: call fakeTime.restore() */ void 0;
})
  Deno.test('withTimeout - aborts the signal when factory function throws', async () => {
  let receivedSignal: AbortSignal | undefined;

    await await assertRejects(async () => { await 
      withTimeout(
        (signal) => {
          receivedSignal = signal;
          return Promise.reject(new Error('factory error'));
        },
        1000,
        'Timed out'
      )
    ; }, 'factory error');

    assertEquals(receivedSignal?.aborted, true);
})
  Deno.test('withTimeout - clears timeout after successful resolution', async () => {
  const clearSpy = stub(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve('ok'), 5000, 'Timed out');
    assert(clearSpy.calls.length > 0);
    clearSpy.restore();
})
  Deno.test('withTimeout - handles zero timeout', async () => {
  new FakeTime();
    const promise = withTimeout(
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('late'), 100);
      }),
      0,
      'Zero timeout'
    );
    fakeTime.tick(1);
    await await assertRejects(async () => { await promise; }, 'Zero timeout');
    /* TODO: call fakeTime.restore() */ void 0;
})