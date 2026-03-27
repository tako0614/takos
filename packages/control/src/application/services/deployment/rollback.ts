import type { DbEnv } from '../../../shared/types';
import type { RoutingBindings } from '../routing/types';
import type { ObjectStoreBinding } from '../../../shared/types/bindings.ts';
import { deleteHostnameRouting } from '../routing/service';
import { restoreRoutingSnapshot, type RoutingSnapshot } from './routing';
import { logDeploymentEvent } from './store';
import type { Deployment } from './types';
import type { DeploymentProvider } from './provider';
import { logError } from '../../../shared/utils/logger';

type RollbackEnv = DbEnv & RoutingBindings & { WORKER_BUNDLES?: ObjectStoreBinding };

type RollbackContext = {
  env: RollbackEnv;
  deploymentId: string;
  deployment: Deployment;
  completedStepNames: string[];
  routingRollbackSnapshot: RoutingSnapshot | null;
  workerHostname: string | null;
  deploymentArtifactRef: string | null;
  provider: DeploymentProvider;
};

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function rollbackDeploymentSteps(ctx: RollbackContext): Promise<void> {
  if (ctx.completedStepNames.includes('update_routing')) {
    try {
      let snapshot: RoutingSnapshot | null = ctx.routingRollbackSnapshot;
      if (!snapshot && ctx.env.WORKER_BUNDLES) {
        const snapshotKey = `deployment-snapshots/${ctx.deploymentId}.json`;
        const object = await ctx.env.WORKER_BUNDLES.get(snapshotKey);
        if (object) {
          try {
            const parsed: unknown = JSON.parse(await object.text());
            if (Array.isArray(parsed) && parsed.every((item) =>
              typeof item === 'object'
              && item !== null
              && typeof (item as Record<string, unknown>).hostname === 'string'
            )) {
              snapshot = parsed as RoutingSnapshot;
            } else {
              logError(`Invalid routing snapshot structure for deployment ${ctx.deploymentId}`, undefined, { module: 'deployment' });
            }
          } catch (parseError) {
            logError(`Failed to parse routing snapshot for deployment ${ctx.deploymentId}`, parseError, { module: 'deployment' });
          }
        }
      }

      if (snapshot && snapshot.length > 0) {
        await restoreRoutingSnapshot(ctx.env, snapshot);
      } else if (ctx.workerHostname) {
        await deleteHostnameRouting({ env: ctx.env, hostname: ctx.workerHostname });
      }

      await logDeploymentEvent(ctx.env.DB, ctx.deploymentId, 'rollback_step', 'update_routing', 'Restored hostname routing after failure');
    } catch (routingCleanupError) {
      logError('Failed to restore hostname routing after failure', routingCleanupError, { module: 'deployment' });
      await logDeploymentEvent(
        ctx.env.DB,
        ctx.deploymentId,
        'rollback_failed',
        'update_routing',
        `Failed to restore routing: ${extractErrorMessage(routingCleanupError)}`,
      ).catch((e) => {
        logError('Failed to log rollback event for routing', e, { module: 'deployment' });
      });
    }
  }

  if (ctx.completedStepNames.includes('deploy_worker') && ctx.deploymentArtifactRef) {
    try {
      if (ctx.provider.cleanupDeploymentArtifact) {
        await ctx.provider.cleanupDeploymentArtifact(ctx.deploymentArtifactRef);
        await logDeploymentEvent(ctx.env.DB, ctx.deploymentId, 'rollback_step', 'deploy_worker', 'Rolled back deployment artifact');
      }
    } catch (wfpCleanupError) {
      logError(`Failed to roll back deployment artifact ${ctx.deploymentArtifactRef}`, wfpCleanupError, { module: 'deployment' });
      await logDeploymentEvent(
        ctx.env.DB,
        ctx.deploymentId,
        'rollback_failed',
        'deploy_worker',
        `Failed to roll back deployment artifact: ${extractErrorMessage(wfpCleanupError)}`,
      ).catch((e) => {
        logError('Failed to log rollback event for deploy_worker', e, { module: 'deployment' });
      });
    }
  }

  if (ctx.env.WORKER_BUNDLES && ctx.deployment.bundle_r2_key) {
    try {
      await ctx.env.WORKER_BUNDLES.delete(ctx.deployment.bundle_r2_key);
      await logDeploymentEvent(ctx.env.DB, ctx.deploymentId, 'rollback_step', 'upload_bundle', 'Rolled back R2 bundle');
    } catch (bundleCleanupError) {
      logError(`Failed to roll back R2 bundle ${ctx.deployment.bundle_r2_key}`, bundleCleanupError, { module: 'deployment' });
    }
  }

  if (ctx.env.WORKER_BUNDLES && ctx.deployment.wasm_r2_key) {
    try {
      await ctx.env.WORKER_BUNDLES.delete(ctx.deployment.wasm_r2_key);
    } catch (wasmCleanupError) {
      logError(`Failed to roll back R2 WASM ${ctx.deployment.wasm_r2_key}`, wasmCleanupError, { module: 'deployment' });
    }
  }
}
