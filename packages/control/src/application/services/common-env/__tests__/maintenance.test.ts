import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  createCommonEnvDeps: ((..._args: any[]) => undefined) as any,
  processReconcileJobs: ((..._args: any[]) => undefined) as any,
  enqueuePeriodicDriftSweep: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/common-env/deps'
mocks.createCommonEnvDeps = () => ({
  spaceEnv: {},
  serviceLink: {},
  manualLink: {},
  orchestrator: {
    processReconcileJobs: mocks.processReconcileJobs,
    enqueuePeriodicDriftSweep: mocks.enqueuePeriodicDriftSweep,
  },
  reconciler: {},
}) as any;

import { runCommonEnvScheduledMaintenance } from '@/services/common-env/maintenance';
import type { Env } from '@/types';


  Deno.test('runCommonEnvScheduledMaintenance - processes reconcile jobs on 15-minute cron', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.processReconcileJobs = (async () => ({ processed: 5, completed: 3, retried: 2 })) as any;
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '*/15 * * * *',
      errors,
    });

    assertSpyCallArgs(mocks.processReconcileJobs, 0, [150]);
    assertEquals(errors.length, 0);
})
  Deno.test('runCommonEnvScheduledMaintenance - enqueues periodic drift sweep on hourly cron', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.enqueuePeriodicDriftSweep = (async () => 10) as any;
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '0 * * * *',
      errors,
    });

    assertSpyCallArgs(mocks.enqueuePeriodicDriftSweep, 0, [200]);
    assertEquals(errors.length, 0);
})
  Deno.test('runCommonEnvScheduledMaintenance - captures reconcile job errors', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.processReconcileJobs = (async () => { throw new Error('DB error'); }) as any;
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '*/15 * * * *',
      errors,
    });

    assertEquals(errors.length, 1);
    assertEquals(errors[0].job, 'common-env.reconcile');
    assertEquals(errors[0].error, 'DB error');
})
  Deno.test('runCommonEnvScheduledMaintenance - captures drift sweep errors', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.enqueuePeriodicDriftSweep = (async () => { throw new Error('sweep failed'); }) as any;
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '0 * * * *',
      errors,
    });

    assertEquals(errors.length, 1);
    assertEquals(errors[0].job, 'common-env.drift-enqueue');
    assertEquals(errors[0].error, 'sweep failed');
})
  Deno.test('runCommonEnvScheduledMaintenance - does nothing for unrelated cron expressions', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '0 0 * * *',
      errors,
    });

    assertSpyCalls(mocks.processReconcileJobs, 0);
    assertSpyCalls(mocks.enqueuePeriodicDriftSweep, 0);
    assertEquals(errors.length, 0);
})
  Deno.test('runCommonEnvScheduledMaintenance - handles non-Error objects in error capture', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.processReconcileJobs = (async () => { throw 'string error'; }) as any;
    const errors: Array<{ job: string; error: string }> = [];

    await runCommonEnvScheduledMaintenance({
      env: {} as Env,
      cron: '*/15 * * * *',
      errors,
    });

    assertEquals(errors.length, 1);
    assertEquals(errors[0].error, 'string error');
})