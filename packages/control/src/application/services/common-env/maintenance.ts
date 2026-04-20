import type { Env } from "../../../shared/types/index.ts";
import { createCommonEnvDeps } from "./deps.ts";
import { logInfo } from "../../../shared/utils/logger.ts";

// Production wrangler.toml uses offset cron strings to avoid Cloudflare cron-storm
// windows. The dev / HTTP-trigger path uses canonical forms. Match on family.
const QUARTER_HOUR_CRONS = new Set([
  "*/15 * * * *",
  "3,18,33,48 * * * *",
]);

const HOURLY_CRONS = new Set([
  "0 * * * *",
  "5 * * * *",
]);

export async function runCommonEnvScheduledMaintenance(params: {
  env: Env;
  cron: string;
  errors: Array<{ job: string; error: string }>;
}): Promise<void> {
  const { env, cron, errors } = params;
  const deps = createCommonEnvDeps(env);

  if (QUARTER_HOUR_CRONS.has(cron)) {
    try {
      const summary = await deps.orchestrator.processReconcileJobs(150);
      logInfo("common-env reconcile batch completed", {
        module: "cron",
        ...{ cron, ...summary },
      });
    } catch (error) {
      errors.push({
        job: "common-env.reconcile",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (HOURLY_CRONS.has(cron)) {
    try {
      const enqueued = await deps.orchestrator.enqueuePeriodicDriftSweep(200);
      logInfo("common-env periodic drift enqueue completed", {
        module: "cron",
        ...{ cron, enqueued },
      });
    } catch (error) {
      errors.push({
        job: "common-env.drift-enqueue",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
