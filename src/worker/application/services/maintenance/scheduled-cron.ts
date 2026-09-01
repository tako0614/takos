// Cron-driven maintenance dispatch for the web worker
// (see takos/../../../web.ts).
//
// Provides:
// - cron-family classifiers (quarter-hour, hourly) — production wrangler.toml
//   uses offset cron strings, dev callers use canonical forms; both must
//   dispatch to the same maintenance jobs
// - runScheduledFamilyMaintenance: the core fanout used by both the
//   POST /internal/scheduled HTTP route and Workers cron triggers
import type { Env } from "../../../shared/types/index.ts";
import { cleanupDeadSessions, runSnapshotGcBatch } from "./index.ts";
import { runR2OrphanedObjectGcBatch } from "../r2/orphaned-object-gc.ts";
import { runWorkflowArtifactGcBatch } from "../execution/workflow-storage.ts";
import { processFeaturedAppPreinstallJobs } from "../source/featured-app-catalog.ts";
import { pruneStaleNotificationPushers } from "../notifications/mobile-push-delivery.ts";
import { runPendingStorageUploadGcBatch } from "../source/space-storage-cleanup.ts";
import { logInfo } from "../../../shared/utils/logger.ts";
import { pruneWorkspaceDeletionReceipts } from "../identity/space-crud-write.ts";
import { runAgentResourceDeletionOutboxBatch } from "../agent/resource-deletion.ts";
import { retireDeletedThreadTurnProjectionsBatch } from "../agent/memory-projection.ts";

// Cron schedule classifiers.
//
// Production wrangler.toml uses offset cron strings (e.g. `3,18,33,48 * * * *`,
// `5 * * * *`) to spread cron load and avoid provider cron storm windows.
// Local / dev callers use the canonical `*/15 * * * *` and `0 * * * *` forms.
// Both must dispatch to the same maintenance jobs, so the dispatcher matches
// on schedule *family* rather than literal equality.
const QUARTER_HOUR_CRONS = new Set(["*/15 * * * *", "3,18,33,48 * * * *"]);

const HOURLY_CRONS = new Set(["0 * * * *", "5 * * * *"]);

export function isQuarterHourCron(cron: string): boolean {
  return QUARTER_HOUR_CRONS.has(cron);
}

export function isHourlyCron(cron: string): boolean {
  return HOURLY_CRONS.has(cron);
}

export type ScheduledJobError = { job: string; error: string };

export type ScheduledFamilyMaintenanceDeps = {
  cleanupDeadSessions: typeof cleanupDeadSessions;
  runR2OrphanedObjectGcBatch: typeof runR2OrphanedObjectGcBatch;
  runSnapshotGcBatch: typeof runSnapshotGcBatch;
  runWorkflowArtifactGcBatch: typeof runWorkflowArtifactGcBatch;
  processFeaturedAppPreinstallJobs: typeof processFeaturedAppPreinstallJobs;
  pruneStaleNotificationPushers: typeof pruneStaleNotificationPushers;
  runPendingStorageUploadGcBatch: typeof runPendingStorageUploadGcBatch;
  pruneWorkspaceDeletionReceipts: typeof pruneWorkspaceDeletionReceipts;
  runAgentResourceDeletionOutboxBatch:
    typeof runAgentResourceDeletionOutboxBatch;
  retireDeletedThreadTurnProjectionsBatch:
    typeof retireDeletedThreadTurnProjectionsBatch;
  logInfo: typeof logInfo;
};

const defaultScheduledFamilyMaintenanceDeps: ScheduledFamilyMaintenanceDeps = {
  cleanupDeadSessions,
  runR2OrphanedObjectGcBatch,
  runSnapshotGcBatch,
  runWorkflowArtifactGcBatch,
  processFeaturedAppPreinstallJobs,
  pruneStaleNotificationPushers,
  runPendingStorageUploadGcBatch,
  pruneWorkspaceDeletionReceipts,
  runAgentResourceDeletionOutboxBatch,
  retireDeletedThreadTurnProjectionsBatch,
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
      const retirement =
        await deps.retireDeletedThreadTurnProjectionsBatch(env.DB, {
          limit: 25,
        });
      if (
        logSuccesses &&
        (retirement.retired > 0 || retirement.remaining)
      ) {
        deps.logInfo("Deleted Thread TurnProjection retirement completed", {
          module: "cron",
          ...{ cron, ...retirement },
        });
      }
    } catch (error) {
      errors.push({
        job: "deleted-thread-turn-projection-retirement",
        error: toScheduledError(error),
      });
    }

    try {
      const deletionSummary = await deps.runAgentResourceDeletionOutboxBatch(
        env,
        { limit: 50 },
      );
      if (
        logSuccesses &&
        (deletionSummary.completed > 0 || deletionSummary.failed > 0)
      ) {
        deps.logInfo("Agent resource deletion outbox batch completed", {
          module: "cron",
          ...{ cron, ...deletionSummary },
        });
      }
    } catch (error) {
      errors.push({
        job: "agent-resource-deletion-outbox",
        error: toScheduledError(error),
      });
    }

    try {
      const deletionReceipts = await deps.pruneWorkspaceDeletionReceipts(
        env.DB,
        { maxAgeMs: 30 * 24 * 60 * 60 * 1000, limit: 100 },
      );
      if (logSuccesses && deletionReceipts.deleted > 0) {
        deps.logInfo("Workspace deletion receipt retention completed", {
          module: "cron",
          ...{ cron, ...deletionReceipts },
        });
      }
    } catch (error) {
      errors.push({
        job: "workspace-deletion-receipt-retention",
        error: toScheduledError(error),
      });
    }

    try {
      const pushRetention = await deps.pruneStaleNotificationPushers(env);
      if (logSuccesses && pushRetention.deleted > 0) {
        deps.logInfo("notification pusher retention completed", {
          module: "cron",
          ...{ cron, ...pushRetention },
        });
      }
    } catch (error) {
      errors.push({
        job: "notification-pusher-retention",
        error: toScheduledError(error),
      });
    }

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
      const uploadGcSummary = await deps.runPendingStorageUploadGcBatch(
        env.DB,
        env.GIT_OBJECTS,
        { maxAgeMs: 24 * 60 * 60 * 1000, maxRecords: 100 },
      );

      if (
        logSuccesses &&
        (uploadGcSummary.recovered > 0 || uploadGcSummary.deleted > 0)
      ) {
        deps.logInfo("pending Storage upload GC batch completed", {
          module: "cron",
          ...{ cron, ...uploadGcSummary },
        });
      }
    } catch (error) {
      errors.push({
        job: "storage-pending-upload-gc",
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
