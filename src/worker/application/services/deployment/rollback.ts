import type { DbEnv } from "../../../shared/types/index.ts";
import type { RoutingBindings } from "../routing/routing-models.ts";
import type { ObjectStoreBinding } from "../../../shared/types/bindings.ts";
import { deleteHostnameRouting } from "../routing/service.ts";
import { restoreRoutingSnapshot, type RoutingSnapshot } from "./routing.ts";
import { logDeploymentEvent } from "./store.ts";
import type { Deployment } from "./models.ts";
import type { DeploymentBackend } from "./backend.ts";
import { logError } from "../../../shared/utils/logger.ts";

type RollbackEnv = DbEnv & RoutingBindings & {
  WORKER_BUNDLES?: ObjectStoreBinding;
};

type RollbackContext = {
  env: RollbackEnv;
  deploymentId: string;
  deployment: Deployment;
  completedStepNames: string[];
  routingRollbackSnapshot: RoutingSnapshot | null;
  workerHostname: string | null;
  deploymentArtifactRef: string | null;
  backend: DeploymentBackend;
};

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function rollbackDeploymentSteps(
  ctx: RollbackContext,
): Promise<void> {
  if (ctx.completedStepNames.includes("update_routing")) {
    try {
      let snapshot: RoutingSnapshot | null = ctx.routingRollbackSnapshot;
      if (!snapshot && ctx.env.WORKER_BUNDLES) {
        const snapshotKey = `deployment-snapshots/${ctx.deploymentId}.json`;
        const object = await ctx.env.WORKER_BUNDLES.get(snapshotKey);
        if (object) {
          try {
            const parsed: unknown = JSON.parse(await object.text());
            if (
              Array.isArray(parsed) &&
              parsed.every((item) =>
                typeof item === "object" &&
                item !== null &&
                typeof (item as Record<string, unknown>).hostname === "string"
              )
            ) {
              snapshot = parsed as RoutingSnapshot;
            } else {
              logError(
                `Invalid routing snapshot structure for deployment ${ctx.deploymentId}`,
                undefined,
                { module: "deployment" },
              );
            }
          } catch (parseError) {
            logError(
              `Failed to parse routing snapshot for deployment ${ctx.deploymentId}`,
              parseError,
              { module: "deployment" },
            );
          }
        }
      }

      if (snapshot && snapshot.length > 0) {
        await restoreRoutingSnapshot(ctx.env, snapshot);
      } else if (ctx.workerHostname) {
        await deleteHostnameRouting({
          env: ctx.env,
          hostname: ctx.workerHostname,
        });
      }

      await logDeploymentEvent(
        ctx.env.DB,
        ctx.deploymentId,
        "rollback_step",
        "update_routing",
        "Restored hostname routing after failure",
      );
    } catch (routingCleanupError) {
      logError(
        "Failed to restore hostname routing after failure",
        routingCleanupError,
        { module: "deployment" },
      );
      await logDeploymentEvent(
        ctx.env.DB,
        ctx.deploymentId,
        "rollback_failed",
        "update_routing",
        `Failed to restore routing: ${
          extractErrorMessage(routingCleanupError)
        }`,
      ).catch((e) => {
        logError("Failed to log rollback event for routing", e, {
          module: "deployment",
        });
      });
    }
  }

  if (
    ctx.completedStepNames.includes("deploy_worker") &&
    ctx.deploymentArtifactRef
  ) {
    try {
      if (ctx.backend.cleanupDeploymentArtifact) {
        await ctx.backend.cleanupDeploymentArtifact(ctx.deploymentArtifactRef);
        await logDeploymentEvent(
          ctx.env.DB,
          ctx.deploymentId,
          "rollback_step",
          "deploy_worker",
          "Rolled back deployment artifact",
        );
      }
    } catch (wfpCleanupError) {
      logError(
        `Failed to roll back deployment artifact ${ctx.deploymentArtifactRef}`,
        wfpCleanupError,
        { module: "deployment" },
      );
      await logDeploymentEvent(
        ctx.env.DB,
        ctx.deploymentId,
        "rollback_failed",
        "deploy_worker",
        `Failed to roll back deployment artifact: ${
          extractErrorMessage(wfpCleanupError)
        }`,
      ).catch((e) => {
        logError("Failed to log rollback event for deploy_worker", e, {
          module: "deployment",
        });
      });
    }
  }

  // NOTE: the source bundle/wasm in WORKER_BUNDLES is deliberately NOT deleted
  // here. The deployment pipeline is designed to retry/resume on the SAME
  // deploymentId (CF queue redelivery -> claimDeploymentForExecution reclaims a
  // `failed` row -> deploy_worker re-runs and re-reads bundle_r2_key, which the
  // retry path never re-uploads). Deleting the source bundle on every failed
  // attempt turned a transient deploy_worker error into a permanent failure
  // (NotFoundError "Bundle at ..."). Terminal source-artifact cleanup is
  // deferred to deleteDeploymentSourceArtifacts(), invoked only from the DLQ
  // handler after retries are exhausted.
}

/**
 * Delete a deployment's source bundle + wasm from WORKER_BUNDLES. Call this only
 * for a TERMINALLY failed deployment (DLQ after max retries), never in the
 * per-attempt rollback — otherwise a queued retry can no longer re-read the
 * source it needs to resume.
 */
export async function deleteDeploymentSourceArtifacts(
  env: RollbackEnv,
  deploymentId: string,
  deployment: Pick<Deployment, "bundle_r2_key" | "wasm_r2_key">,
): Promise<void> {
  if (env.WORKER_BUNDLES && deployment.bundle_r2_key) {
    try {
      await env.WORKER_BUNDLES.delete(deployment.bundle_r2_key);
      await logDeploymentEvent(
        env.DB,
        deploymentId,
        "rollback_step",
        "upload_bundle",
        "Deleted object-store bundle after terminal failure",
      ).catch(() => {});
    } catch (bundleCleanupError) {
      logError(
        `Failed to delete object-store bundle ${deployment.bundle_r2_key}`,
        bundleCleanupError,
        { module: "deployment" },
      );
    }
  }

  if (env.WORKER_BUNDLES && deployment.wasm_r2_key) {
    try {
      await env.WORKER_BUNDLES.delete(deployment.wasm_r2_key);
    } catch (wasmCleanupError) {
      logError(
        `Failed to delete object-store WASM ${deployment.wasm_r2_key}`,
        wasmCleanupError,
        { module: "deployment" },
      );
    }
  }
}
