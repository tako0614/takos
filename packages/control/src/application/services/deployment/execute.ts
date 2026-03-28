/**
 * Deployment execution orchestrator.
 *
 * Implements the multi-step deployment pipeline: deploy worker, update routing,
 * reconcile MCP, and handle failure rollback. Extracted from DeploymentService
 * to keep the main service file focused on coordination.
 */
import { safeJsonParseOrDefault } from '../../../shared/utils';
import type { ServiceRuntimeConfigState } from '../platform/worker-desired-state';
import type { Deployment, DeploymentEnv } from './models';
import {
  createDeploymentProvider,
  parseDeploymentTargetConfig,
} from './provider';
import {
  getDeploymentById,
  getDeploymentEvents,
  getDeploymentServiceId,
  getServiceDeploymentBasics,
  logDeploymentEvent,
  updateDeploymentRecord,
} from './store';
import { executeDeploymentStep, updateDeploymentState } from './state';
import { reconcileManagedWorkerMcpServer } from '../platform/mcp';
import type { RoutingTarget } from '../routing/types';
import {
  applyRoutingDbUpdates,
  applyRoutingToHostnames,
  buildRoutingTarget,
  collectHostnames,
  fetchServiceWithDomains,
  restoreRoutingSnapshot,
  snapshotRouting,
  type RoutingSnapshot,
} from './routing';
import { rollbackDeploymentSteps } from './rollback';
import { deployments, getDb, services } from '../../../infra/db';
import { eq } from 'drizzle-orm';
import { CF_COMPATIBILITY_DATE } from '../../../shared/constants';
import { logError } from '../../../shared/utils/logger';
import { InternalError, NotFoundError } from 'takos-common/errors';
import {
  getDeploymentProviderRegistry,
  resolveDeploymentArtifactRef,
  parseRuntimeConfig,
  extractErrorMessage,
} from './deployment-artifacts';
import {
  getBundleContent,
  verifyBundleIntegrity,
  getWasmContent,
  decryptBindings,
} from './artifacts';

/**
 * Execute a deployment through all pipeline steps (deploy_worker, update_routing, finalize).
 *
 * This is the core orchestration extracted from DeploymentService.executeDeployment.
 */
export async function executeDeploymentPipeline(
  env: DeploymentEnv,
  encryptionKey: string,
  deploymentId: string,
): Promise<Deployment> {
  const deployment = await getDeploymentById(env.DB, deploymentId);

  if (!deployment) {
    throw new NotFoundError(`Deployment ${deploymentId}`);
  }

  if (deployment.status === 'success' || deployment.status === 'rolled_back') {
    return deployment;
  }

  const completedStepNames = (await getDeploymentEvents(env.DB, deploymentId))
    .filter((event) => event.event_type === 'step_completed' && event.step_name)
    .map((event) => event.step_name as string);

  await updateDeploymentState(env.DB, deploymentId, 'in_progress', deployment.deploy_state);
  const deploymentServiceId = getDeploymentServiceId(deployment);

  let workerHostname: string | null = null;
  let deploymentArtifactRef: string | null = null;
  let routingRollbackSnapshot: RoutingSnapshot | null = null;

  try {
    const serviceBasics = await getServiceDeploymentBasics(env.DB, deploymentServiceId);
    if (!serviceBasics.exists) {
      throw new NotFoundError('Worker');
    }

    workerHostname = serviceBasics.hostname;
    deploymentArtifactRef = resolveDeploymentArtifactRef({
      serviceId: deploymentServiceId,
      version: deployment.version,
      target: parseDeploymentTargetConfig(deployment),
      persistedArtifactRef: deployment.artifact_ref,
    });

    const deployArtifactRef = deploymentArtifactRef;
    const provider = createDeploymentProvider(deployment, {
      providerRegistry: getDeploymentProviderRegistry(env),
      cloudflareEnv: env,
      orchestratorUrl: env.OCI_ORCHESTRATOR_URL,
      orchestratorToken: env.OCI_ORCHESTRATOR_TOKEN,
    });

    if (!deployArtifactRef) {
      throw new InternalError('Deployment artifact ref is missing');
    }

    const isContainerDeploy = deployment.artifact_kind === 'container-image';

    if (!completedStepNames.includes('deploy_worker')) {
      await executeDeploymentStep(env.DB, deploymentId, 'deploying_worker', 'deploy_worker', async () => {
        let bundleContent: string | undefined;
        let wasmContent: ArrayBuffer | null = null;

        if (!isContainerDeploy) {
          bundleContent = await getBundleContent(env, deployment);
          await verifyBundleIntegrity(bundleContent, deployment);
          wasmContent = deployment.wasm_r2_key
            ? await getWasmContent(env, deployment)
            : null;
        }

        const runtimeConfig = parseRuntimeConfig(deployment.runtime_config_snapshot_json);
        const compatibilityDate = runtimeConfig.compatibility_date || CF_COMPATIBILITY_DATE;
        const compatibilityFlags = runtimeConfig.compatibility_flags.length > 0
          ? runtimeConfig.compatibility_flags
          : wasmContent
            ? ['nodejs_compat']
            : [];

        const bindings = (!isContainerDeploy && deployment.bindings_snapshot_encrypted)
          ? await decryptBindings(encryptionKey, deployment)
          : [];
        const deployResult = await provider.deploy({
          deployment,
          artifactRef: deployArtifactRef,
          bundleContent,
          wasmContent,
          bindings,
          compatibilityDate,
          compatibilityFlags,
          limits: runtimeConfig.limits,
        });

        // Store resolved endpoint from container provider in provider_state_json
        if (deployResult?.resolvedEndpoint) {
          const providerState = safeJsonParseOrDefault<Record<string, unknown>>(
            deployment.provider_state_json,
            {},
          );
          providerState.resolved_endpoint = deployResult.resolvedEndpoint;
          if (deployResult.logsRef) {
            providerState.logs_ref = deployResult.logsRef;
          }
          await updateDeploymentRecord(env.DB, deploymentId, {
            providerStateJson: JSON.stringify(providerState),
          });
          // Update in-memory deployment for routing step
          deployment.provider_state_json = JSON.stringify(providerState);
        }
      });
      completedStepNames.push('deploy_worker');
    }

    if (!completedStepNames.includes('update_routing')) {
      await executeDeploymentStep(env.DB, deploymentId, 'routing', 'update_routing', async () => {
        const db = getDb(env.DB);

        const serviceRouteRecord = await fetchServiceWithDomains(env, deploymentServiceId);

        if (!serviceRouteRecord) {
          throw new NotFoundError('Worker');
        }

        const hostnameList = collectHostnames(serviceRouteRecord);

        if (hostnameList.length === 0) {
          return;
        }

        routingRollbackSnapshot = await snapshotRouting(env, hostnameList);

        if (env.WORKER_BUNDLES && routingRollbackSnapshot) {
          const snapshotKey = `deployment-snapshots/${deploymentId}.json`;
          await env.WORKER_BUNDLES.put(snapshotKey, JSON.stringify(routingRollbackSnapshot));
        }

        const nowIso = new Date().toISOString();
        const promoteToActive = deployment.routing_status !== 'canary';

        let activeDeployment = null;
        if (!promoteToActive && serviceRouteRecord.activeDeploymentId) {
          activeDeployment = await db.select({
            id: deployments.id,
            artifactRef: deployments.artifactRef,
            targetJson: deployments.targetJson,
            routingStatus: deployments.routingStatus,
          })
            .from(deployments)
            .where(eq(deployments.id, serviceRouteRecord.activeDeploymentId))
            .get() ?? null;
        }

        // For container deploys, inject the resolved endpoint as the routing target
        let deploymentTarget = parseDeploymentTargetConfig(deployment);
        if (isContainerDeploy) {
          const providerState = safeJsonParseOrDefault<Record<string, unknown>>(
            deployment.provider_state_json,
            {},
          );
          const resolvedEp = providerState.resolved_endpoint as { base_url?: string } | undefined;
          if (resolvedEp?.base_url) {
            deploymentTarget = {
              ...deploymentTarget,
              endpoint: { kind: 'http-url', base_url: resolvedEp.base_url },
            };
          }
        }

        const routingCtx = {
          deploymentId,
          deploymentVersion: deployment.version,
          deployArtifactRef,
          deploymentTarget,
          serviceRouteRecord,
          desiredRoutingStatus: deployment.routing_status,
          desiredRoutingWeight: deployment.routing_weight,
          activeDeployment,
        };

        const { target, auditDetails } = buildRoutingTarget(routingCtx, hostnameList);

        await applyRoutingToHostnames(env, hostnameList, target);

        try {
          await applyRoutingDbUpdates(env, routingCtx, nowIso);
        } catch (dbErr) {
          if (routingRollbackSnapshot) {
            await restoreRoutingSnapshot(env, routingRollbackSnapshot).catch((e) => {
              logError('Failed to restore routing snapshot during rollback', e, { module: 'deployment' });
            });
          }
          throw dbErr;
        }

        await logDeploymentEvent(
          env.DB,
          deploymentId,
          'routing_updated',
          'update_routing',
          promoteToActive ? 'Promoted deployment to active routing' : 'Configured canary routing',
          {
            actorAccountId: deployment.deployed_by ?? null,
            details: auditDetails,
          }
        );
      });
      completedStepNames.push('update_routing');
    }

    const finishedAt = new Date().toISOString();
    await updateDeploymentRecord(env.DB, deploymentId, {
      deployState: 'completed',
      status: 'success',
      completedAt: finishedAt,
      updatedAt: finishedAt,
    });
    try {
      const db = getDb(env.DB);
      await db.update(services)
        .set({
          status: 'deployed',
          updatedAt: finishedAt,
        })
        .where(eq(services.id, deploymentServiceId))
        .run();
    } catch (e) {
      logError('Failed to update service status to deployed (non-critical)', e, { module: 'deployment' });
    }

    const runtimeConfig = safeJsonParseOrDefault<Partial<ServiceRuntimeConfigState>>(
      deployment.runtime_config_snapshot_json,
      {},
    );
    const currentService = await getServiceDeploymentBasics(env.DB, deploymentServiceId);

    await reconcileManagedWorkerMcpServer(env.DB, env, {
      spaceId: deployment.space_id,
      serviceId: deploymentServiceId,
      enabled: runtimeConfig.mcp_server?.enabled === true,
      name: runtimeConfig.mcp_server?.name ?? null,
      url: currentService.hostname && runtimeConfig.mcp_server?.path
        ? `https://${currentService.hostname}${runtimeConfig.mcp_server.path}`
        : null,
    }).catch((err) => {
      logError('Failed to reconcile managed worker MCP server', err, { module: 'deploymentservice' });
    });

    await logDeploymentEvent(env.DB, deploymentId, 'completed', null, 'Deployment completed successfully');

    // Clean up routing snapshot after successful deployment
    if (env.WORKER_BUNDLES) {
      const snapshotKey = `deployment-snapshots/${deploymentId}.json`;
      await env.WORKER_BUNDLES.delete(snapshotKey).catch((e) => {
        logError('Failed to clean up deployment snapshot (non-critical)', e, { module: 'deployment' });
      });
    }

    const finalDeployment = await getDeploymentById(env.DB, deploymentId);
    if (!finalDeployment) {
      throw new InternalError(`Deployment ${deploymentId} not found after successful completion`);
    }
    return finalDeployment;
  } catch (error) {
    const errorMessage = extractErrorMessage(error);
    const now = new Date().toISOString();

    await rollbackDeploymentSteps({
      env,
      deploymentId,
      deployment,
      completedStepNames,
      routingRollbackSnapshot,
      workerHostname,
      deploymentArtifactRef,
      provider: createDeploymentProvider(deployment, {
        providerRegistry: getDeploymentProviderRegistry(env),
        cloudflareEnv: env,
        orchestratorUrl: env.OCI_ORCHESTRATOR_URL,
        orchestratorToken: env.OCI_ORCHESTRATOR_TOKEN,
      }),
    });

    await updateDeploymentRecord(env.DB, deploymentId, {
      deployState: 'failed',
      status: 'failed',
      stepError: errorMessage,
      updatedAt: now,
    });
    const currentService = await getServiceDeploymentBasics(env.DB, deploymentServiceId);
    if (!currentService.activeDeploymentId) {
      try {
        const db = getDb(env.DB);
        await db.update(services)
          .set({
            status: 'failed',
            updatedAt: now,
          })
          .where(eq(services.id, deploymentServiceId))
          .run();
      } catch (e) {
        logError('Failed to update service status to failed (non-critical)', e, { module: 'deployment' });
      }
    }

    await logDeploymentEvent(env.DB, deploymentId, 'failed', deployment.current_step, errorMessage);

    throw error;
  }
}
