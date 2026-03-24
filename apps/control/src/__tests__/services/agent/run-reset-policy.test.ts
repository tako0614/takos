import { describe, expect, it } from 'vitest';

import { shouldResetRunToQueuedOnContainerError } from '@/services/agent/run-lifecycle';

describe('shouldResetRunToQueuedOnContainerError', () => {
  it('resets only actively running runs', () => {
    expect(shouldResetRunToQueuedOnContainerError('running')).toBe(true);
    expect(shouldResetRunToQueuedOnContainerError('queued')).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError('pending')).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError('completed')).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError('failed')).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError('cancelled')).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError(null)).toBe(false);
    expect(shouldResetRunToQueuedOnContainerError(undefined)).toBe(false);
  });
});
