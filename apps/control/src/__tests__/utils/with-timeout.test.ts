import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from '@/utils/with-timeout';

describe('withTimeout', () => {
  it('resolves when promise completes before timeout', async () => {
    const result = await withTimeout(
      Promise.resolve('ok'),
      1000,
      'Timed out'
    );
    expect(result).toBe('ok');
  });

  it('rejects with timeout error when promise is too slow', async () => {
    vi.useFakeTimers();
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 5000);
    });

    const promise = withTimeout(slow, 100, 'Operation timed out');
    vi.advanceTimersByTime(150);

    await expect(promise).rejects.toThrow('Operation timed out');
    vi.useRealTimers();
  });

  it('propagates the original error if promise rejects before timeout', async () => {
    const failing = Promise.reject(new Error('original error'));
    await expect(
      withTimeout(failing, 5000, 'Timed out')
    ).rejects.toThrow('original error');
  });

  it('accepts a factory function and passes abort signal', async () => {
    let receivedSignal: AbortSignal | undefined;

    const result = await withTimeout(
      (signal) => {
        receivedSignal = signal;
        return Promise.resolve(42);
      },
      1000,
      'Timed out'
    );

    expect(result).toBe(42);
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it('aborts the signal on timeout', async () => {
    vi.useFakeTimers();
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

    vi.advanceTimersByTime(150);
    await expect(promise).rejects.toThrow('Timed out');
    expect(receivedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('aborts the signal when factory function throws', async () => {
    let receivedSignal: AbortSignal | undefined;

    await expect(
      withTimeout(
        (signal) => {
          receivedSignal = signal;
          return Promise.reject(new Error('factory error'));
        },
        1000,
        'Timed out'
      )
    ).rejects.toThrow('factory error');

    expect(receivedSignal?.aborted).toBe(true);
  });

  it('clears timeout after successful resolution', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve('ok'), 5000, 'Timed out');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('handles zero timeout', async () => {
    vi.useFakeTimers();
    const promise = withTimeout(
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('late'), 100);
      }),
      0,
      'Zero timeout'
    );
    vi.advanceTimersByTime(1);
    await expect(promise).rejects.toThrow('Zero timeout');
    vi.useRealTimers();
  });
});
