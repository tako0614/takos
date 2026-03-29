import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCommonEnvDeps: vi.fn(),
  processReconcileJobs: vi.fn(),
  enqueuePeriodicDriftSweep: vi.fn(),
}));

vi.mock('@/services/common-env/deps', () => ({
  createCommonEnvDeps: mocks.createCommonEnvDeps,
}));

mocks.createCommonEnvDeps.mockImplementation(() => ({
  spaceEnv: {},
  serviceLink: {},
  manualLink: {},
  orchestrator: {
    processReconcileJobs: mocks.processReconcileJobs,
    enqueuePeriodicDriftSweep: mocks.enqueuePeriodicDriftSweep,
  },
  reconciler: {},
}));

import { runCommonEnvScheduledMaintenance } from '@/services/common-env/maintenance';
import type { Env } from '@/types';

describe('runCommonEnvScheduledMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes reconcile jobs on 15-minute cron', async () => {
    mocks.processReconcileJobs.mockResolvedValue({ processed: 5, completed: 3, retried: 2 });
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '*/15 * * * *',
      errors,
    });

    expect(mocks.processReconcileJobs).toHaveBeenCalledWith(150);
    expect(errors).toHaveLength(0);
  });

  it('enqueues periodic drift sweep on hourly cron', async () => {
    mocks.enqueuePeriodicDriftSweep.mockResolvedValue(10);
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '0 * * * *',
      errors,
    });

    expect(mocks.enqueuePeriodicDriftSweep).toHaveBeenCalledWith(200);
    expect(errors).toHaveLength(0);
  });

  it('captures reconcile job errors', async () => {
    mocks.processReconcileJobs.mockRejectedValue(new Error('DB error'));
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '*/15 * * * *',
      errors,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].job).toBe('common-env.reconcile');
    expect(errors[0].error).toBe('DB error');
  });

  it('captures drift sweep errors', async () => {
    mocks.enqueuePeriodicDriftSweep.mockRejectedValue(new Error('sweep failed'));
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '0 * * * *',
      errors,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].job).toBe('common-env.drift-enqueue');
    expect(errors[0].error).toBe('sweep failed');
  });

  it('does nothing for unrelated cron expressions', async () => {
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '0 0 * * *',
      errors,
    });

    expect(mocks.processReconcileJobs).not.toHaveBeenCalled();
    expect(mocks.enqueuePeriodicDriftSweep).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
  });

  it('handles non-Error objects in error capture', async () => {
    mocks.processReconcileJobs.mockRejectedValue('string error');
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '*/15 * * * *',
      errors,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe('string error');
  });
});
