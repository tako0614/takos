// Cron-driven maintenance dispatch for the web worker
// (see takos/../../../web.ts).
//
// Provides:
// - cron-family classifiers (quarter-hour, hourly) — production wrangler.toml
//   uses offset cron strings, dev callers use canonical forms; both must
//   dispatch to the same maintenance jobs
// - scheduledWorkflowWindowMinutes for the workflow-trigger scan window
// - runScheduledFamilyMaintenance: the core fanout used by both the
//   POST /internal/scheduled HTTP route and Workers cron triggers
import type { Env } from "../../../shared/types/index.ts";
import {
  cleanupDeadSessions,
  reconcileStuckDomains,
  runCustomDomainReverification,
  runSnapshotGcBatch,
} from "./index.ts";
import { runR2OrphanedObjectGcBatch } from "../r2/orphaned-object-gc.ts";
import { runWorkflowArtifactGcBatch } from "../execution/workflow-storage.ts";
import { processFeaturedAppPreinstallJobs } from "../source/featured-app-catalog.ts";
import { logInfo } from "../../../shared/utils/logger.ts";

// Cron schedule classifiers.
//
// Production wrangler.toml uses offset cron strings (e.g. `3,18,33,48 * * * *`,
// `5 * * * *`) to spread cron load and avoid provider cron storm windows.
// Local / dev callers use the canonical `*/15 * * * *` and `0 * * * *` forms.
// Both must dispatch to the same maintenance jobs, so the dispatcher matches
// on schedule *family* rather than literal equality.
const QUARTER_HOUR_CRONS = new Set([
  "*/15 * * * *",
  "3,18,33,48 * * * *",
]);

const HOURLY_CRONS = new Set([
  "0 * * * *",
  "5 * * * *",
]);

export function isQuarterHourCron(cron: string): boolean {
  return QUARTER_HOUR_CRONS.has(cron);
}

export function isHourlyCron(cron: string): boolean {
  return HOURLY_CRONS.has(cron);
}

export function scheduledWorkflowWindowMinutes(cron: string): number {
  if (isHourlyCron(cron)) return 60;
  if (isQuarterHourCron(cron)) return 15;
  return 1;
}

export type ScheduledJobError = { job: string; error: string };

export type ScheduledFamilyMaintenanceDeps = {
  cleanupDeadSessions: typeof cleanupDeadSessions;
  reconcileStuckDomains: typeof reconcileStuckDomains;
  runCustomDomainReverification: typeof runCustomDomainReverification;
  runR2OrphanedObjectGcBatch: typeof runR2OrphanedObjectGcBatch;
  runSnapshotGcBatch: typeof runSnapshotGcBatch;
  runWorkflowArtifactGcBatch: typeof runWorkflowArtifactGcBatch;
  processFeaturedAppPreinstallJobs: typeof processFeaturedAppPreinstallJobs;
  logInfo: typeof logInfo;
};

const defaultScheduledFamilyMaintenanceDeps: ScheduledFamilyMaintenanceDeps = {
  cleanupDeadSessions,
  reconcileStuckDomains,
  runCustomDomainReverification,
  runR2OrphanedObjectGcBatch,
  runSnapshotGcBatch,
  runWorkflowArtifactGcBatch,
  processFeaturedAppPreinstallJobs,
  logInfo,
};

function toScheduledError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runScheduledFamilyMaintenance(
  env: Env,
  cron: string,
  errors: ScheduledJobError[],
  options: { logSuccesses?: boolean } = {},
  deps: ScheduledFamilyMaintenanceDeps = defaultScheduledFamilyMaintenanceDeps,
): Promise<void> {
  const { logSuccesses = false } = options;
  const runQuarterHourJobs = isQuarterHourCron(cron) || cron === "* * * * *";
  const runHourlyJobs = isHourlyCron(cron) || cron === "* * * * *";

  if (runQuarterHourJobs) {
    try {
      const summary = await deps.runCustomDomainReverification(env, {
        batchSize: 200,
      });
      const reconSummary = await deps.reconcileStuckDomains(env);

      if (logSuccesses) {
        deps.logInfo("custom-domain reverification completed", {
          module: "cron",
          ...{
            cron,
            ...summary,
          },
        });
        deps.logInfo("stuck-domain reconciliation completed", {
          module: "cron",
          ...{
            cron,
            ...reconSummary,
          },
        });
      }
    } catch (error) {
      errors.push({
        job: "custom-domains",
        error: toScheduledError(error),
      });
    }

    try {
      const summary = await deps.processFeaturedAppPreinstallJobs(env, {
        limit: 10,
      });

      if (logSuccesses && summary.processed > 0) {
        deps.logInfo("featured app preinstall jobs processed", {
          module: "cron",
          cron,
          ...summary,
        });
      }
    } catch (error) {
      errors.push({
        job: "featured-app-preinstall",
        error: toScheduledError(error),
      });
    }
  }

  if (runHourlyJobs) {
    try {
      const sessionSummary = await deps.cleanupDeadSessions(env);

      if (logSuccesses) {
        deps.logInfo("dead session cleanup completed", {
          module: "cron",
          ...{
            cron,
            marked_dead: sessionSummary.markedDead,
            cutoff_time: sessionSummary.cutoffTime,
            startup_cutoff: sessionSummary.startupCutoff,
          },
        });
      }
    } catch (error) {
      errors.push({
        job: "sessions.cleanup-dead",
        error: toScheduledError(error),
      });
    }

    try {
      const gcSummary = await deps.runSnapshotGcBatch(env, {
        maxSpaces: 5,
      });

      if (logSuccesses) {
        deps.logInfo("snapshot GC batch completed", {
          module: "cron",
          ...{
            cron,
            ...gcSummary,
          },
        });
      }
    } catch (error) {
      errors.push({
        job: "snapshot-gc",
        error: toScheduledError(error),
      });
    }

    try {
      const orphanSummary = await deps.runR2OrphanedObjectGcBatch(env, {
        dryRun: false,
        minAgeMinutes: 24 * 60,
        listLimit: 200,
        maxDeletes: 200,
      });

      if (logSuccesses && !orphanSummary.skipped) {
        deps.logInfo("r2 orphaned object GC batch completed", {
          module: "cron",
          ...{ cron, ...orphanSummary },
        });
      }
    } catch (error) {
      errors.push({
        job: "r2-orphaned-object-gc",
        error: toScheduledError(error),
      });
    }

    try {
      const wfGcSummary = await deps.runWorkflowArtifactGcBatch(
        env.DB,
        env.GIT_OBJECTS,
        { maxDeletes: 100 },
      );

      if (logSuccesses && wfGcSummary.deletedRows > 0) {
        deps.logInfo("workflow artifact GC batch completed", {
          module: "cron",
          ...{ cron, ...wfGcSummary },
        });
      }
    } catch (error) {
      errors.push({
        job: "workflow-artifact-gc",
        error: toScheduledError(error),
      });
    }
  }
}
