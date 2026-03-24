import type { Env } from '../../../shared/types';
import { createCommonEnvService } from './service';
import { logInfo } from '../../../shared/utils/logger';

export async function runCommonEnvScheduledMaintenance(params: {
  env: Env;
  cron: string;
  errors: Array<{ job: string; error: string }>;
}): Promise<void> {
  const { env, cron, errors } = params;
  const commonEnvService = createCommonEnvService(env);

  if (cron === '*/15 * * * *') {
    try {
      const summary = await commonEnvService.processReconcileJobs(150);
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
      const enqueued = await commonEnvService.enqueuePeriodicDriftSweep(200);
      logInfo('common-env periodic drift enqueue completed', { module: 'cron', ...{ cron, enqueued } });
    } catch (error) {
      errors.push({
        job: 'common-env.drift-enqueue',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
