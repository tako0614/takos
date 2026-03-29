import type { Env } from '../../../shared/types';
import { createCommonEnvDeps } from './deps';
import { logInfo } from '../../../shared/utils/logger';

export async function runCommonEnvScheduledMaintenance(params: {
  env: Env;
  cron: string;
  errors: Array<{ job: string; error: string }>;
}): Promise<void> {
  const { env, cron, errors } = params;
  const deps = createCommonEnvDeps(env);

  if (cron === '*/15 * * * *') {
    try {
      const summary = await deps.orchestrator.processReconcileJobs(150);
      logInfo('common-env reconcile batch completed', { module: 'cron', ...{ cron, ...summary } });
    } catch (error) {
      errors.push({
        job: 'common-env.reconcile',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (cron === '0 * * * *') {
    try {
      const enqueued = await deps.orchestrator.enqueuePeriodicDriftSweep(200);
      logInfo('common-env periodic drift enqueue completed', { module: 'cron', ...{ cron, enqueued } });
    } catch (error) {
      errors.push({
        job: 'common-env.drift-enqueue',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
