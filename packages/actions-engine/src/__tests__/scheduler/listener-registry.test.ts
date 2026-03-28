import { describe, expect, it } from 'vitest';

import { JobScheduler, type JobSchedulerEvent } from '../../scheduler/job.js';
import { createBaseContext } from '../../context.js';
import type { Workflow } from '../../types.js';

/**
 * Minimal workflow used purely to construct a JobScheduler instance.
 */
function createMinimalWorkflow(): Workflow {
  return {
    name: 'listener-test',
    on: 'push',
    jobs: {
      a: { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo ok' }] },
    },
  };
}

describe('JobScheduler listener management', () => {
  it('keeps current emit stable when a listener is removed during emit', async () => {
    const scheduler = new JobScheduler(createMinimalWorkflow());
    const callOrder: string[] = [];

    let unsubscribeSecond = () => {};

    scheduler.on(() => {
      callOrder.push('first');
      unsubscribeSecond();
    });
    unsubscribeSecond = scheduler.on(() => {
      callOrder.push('second');
    });

    // Run triggers multiple emit calls; capture events from the first emit
    await scheduler.run(createBaseContext());

    // The first event emitted is 'workflow:start'. Both listeners should have
    // been called for that first emit because removal happens on a snapshot.
    expect(callOrder[0]).toBe('first');
    expect(callOrder[1]).toBe('second');
    // After the first emit, the second listener should be gone.
    // Subsequent emits should only include 'first'.
    const afterFirstEmit = callOrder.slice(2);
    expect(afterFirstEmit.every((v) => v === 'first')).toBe(true);
  });

  it('defers listeners added during emit until the next emit cycle', async () => {
    const scheduler = new JobScheduler(createMinimalWorkflow());
    const callOrder: string[] = [];

    const lateListener = () => {
      callOrder.push('late');
    };

    let addedLate = false;
    scheduler.on(() => {
      callOrder.push('first');
      if (!addedLate) {
        scheduler.on(lateListener);
        addedLate = true;
      }
    });

    await scheduler.run(createBaseContext());

    // 'late' should NOT appear for the first emit, only for subsequent emits.
    expect(callOrder[0]).toBe('first');
    expect(callOrder[1]).not.toBe('late');
  });

  it('continues calling remaining listeners even if an earlier listener throws', async () => {
    const scheduler = new JobScheduler(createMinimalWorkflow());
    const callOrder: string[] = [];

    scheduler.on(() => {
      callOrder.push('first');
      throw new Error('listener failed');
    });
    scheduler.on(() => {
      callOrder.push('second');
    });
    scheduler.on(() => {
      callOrder.push('third');
    });

    // Should not throw despite a listener throwing
    await expect(scheduler.run(createBaseContext())).resolves.toBeDefined();

    // All three listeners should have been called for at least the first emit
    expect(callOrder.includes('first')).toBe(true);
    expect(callOrder.includes('second')).toBe(true);
    expect(callOrder.includes('third')).toBe(true);
  });
});
