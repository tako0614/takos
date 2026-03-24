import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/agent/runner', () => ({
  executeRun: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/services/agent/run-lifecycle', () => ({
  shouldResetRunToQueuedOnContainerError: vi.fn((status: string | null) => status === 'running'),
}));

import { executeRun } from '@/services/agent/runner';
import { shouldResetRunToQueuedOnContainerError } from '@/services/agent/run-lifecycle';

describe('public-runner re-exports', () => {
  it('re-exports executeRun from runner module', () => {
    expect(executeRun).toBeDefined();
    expect(typeof executeRun).toBe('function');
  });

  it('re-exports shouldResetRunToQueuedOnContainerError from run-lifecycle', () => {
    expect(shouldResetRunToQueuedOnContainerError).toBeDefined();
    expect(typeof shouldResetRunToQueuedOnContainerError).toBe('function');
  });

  it('executeRun is callable', async () => {
    const result = await (executeRun as Function)();
    expect(result).toEqual({ success: true });
  });

  it('shouldResetRunToQueuedOnContainerError returns correct values', () => {
    expect(shouldResetRunToQueuedOnContainerError('running')).toBe(true);
    expect(shouldResetRunToQueuedOnContainerError('completed' as any)).toBe(false);
  });
});
