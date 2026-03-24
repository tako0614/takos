/**
 * Core deployment service — CRUD and lifecycle management.
 *
 * Provides the DeploymentService class that coordinates deployment creation,
 * execution, rollback, and query operations by delegating to the executor
 * and rollback sub-modules.
 */
import type { Env, DbEnv } from '../../../shared/types';
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import { generateId, safeJsonParseOrDefault } from '../../../shared/utils';
import { encrypt, decrypt, encryptEnvVars, decryptEnvVars, maskEnvVars, type EncryptedData } from '../../../shared/utils/crypto';
import { computeSHA256, constantTimeEqual } from '../../../shared/utils/hash';
import { createServiceDesiredStateService, type ServiceRuntimeConfigState } from '../platform/worker-desired-state';
import type { DurableNamespaceBinding, KvStoreBinding, ObjectStoreBinding } from '../../../shared/types/bindings.ts';
import type {
  Deployment,
  DeploymentEvent,
  CreateDeploymentInput,
  DeploymentTarget,
  RollbackInput,
} from './types';
import {
  type CloudflareDeploymentProviderEnv,
  type DeploymentProviderRegistryLike,
  createDeploymentProvider,
  parseDeploymentTargetConfig,
  serializeDeploymentTarget,
} from './provider';
import {
  createDeploymentWithVersion,
  getDeploymentServiceId,
  getDeploymentById,
  getDeploymentByIdempotencyKey,
  getDeploymentEvents,
  getDeploymentHistory,
  getServiceDeploymentBasics,
  getServiceRollbackInfo,
  findDeploymentByServiceVersion,
  logDeploymentEvent,
  updateServiceDeploymentPointers,
  updateDeploymentRecord,
} from './store';
import { executeDeploymentStep, updateDeploymentState, detectStuckDeployments, resetStuckDeployment } from './state';
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
import { deployments, getDb, serviceDeployments, services } from '../../../infra/db';
import { eq, and, ne, inArray } from 'drizzle-orm';
import { CF_COMPATIBILITY_DATE } from '../../../shared/constants';
import { logError } from '../../../shared/utils/logger';

export type DeploymentEnv = DbEnv & CloudflareDeploymentProviderEnv & {
  ENCRYPTION_KEY?: string;
  ADMIN_DOMAIN: string;
  WORKER_BUNDLES?: ObjectStoreBinding;
  OCI_ORCHESTRATOR_URL?: string;
  OCI_ORCHESTRATOR_TOKEN?: string;
  HOSTNAME_ROUTING: KvStoreBinding;
  ROUTING_DO?: DurableNamespaceBinding;
  ROUTING_DO_PHASE?: string;
  SERVICE_INTERNAL_JWT_ISSUER?: string;
  DEPLOYMENT_PROVIDER_REGISTRY?: DeploymentProviderRegistryLike;
};

function getDeploymentProviderRegistry(env: DeploymentEnv): DeploymentProviderRegistryLike | undefined {
  return env.DEPLOYMENT_PROVIDER_REGISTRY;
}

function resolveDeploymentArtifactBaseRef(serviceId: string, target?: DeploymentTarget): string {
  const routeRef = target?.route_ref?.trim()
    || (target?.endpoint?.kind === 'service-ref' ? target.endpoint.ref.trim() : '')
    || '';
  return routeRef || `worker-${serviceId}`;
}

export function buildDeploymentArtifactRef(baseRef: string, version: number): string {
  return `${baseRef}-v${version}`;
}

function resolveDeploymentArtifactRef(options: {
  serviceId: string;
  version: number;
  target?: DeploymentTarget;
  persistedArtifactRef?: string | null;
}): string {
  const persistedArtifactRef = options.persistedArtifactRef?.trim();
  if (persistedArtifactRef) {
    return persistedArtifactRef;
  }
  return buildDeploymentArtifactRef(
    resolveDeploymentArtifactBaseRef(options.serviceId, options.target),
    options.version,
  );
}

function resolveDeploymentServiceId(input: {
  workerId?: string | null;
  serviceId?: string | null;
}): string {
  const serviceId = input.serviceId?.trim() || input.workerId?.trim() || '';
  if (!serviceId) {
    throw new Error('Deployment requires a service identifier');
  }
  return serviceId;
}

function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRuntimeConfig(raw: string | null | undefined): ServiceRuntimeConfigState {
  const parsed = safeJsonParseOrDefault<{
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
    mcp_server?: ServiceRuntimeConfigState['mcp_server'];
  }>(raw, {});

  return {
    compatibility_date: parsed.compatibility_date,
    compatibility_flags: Array.isArray(parsed.compatibility_flags) ? parsed.compatibility_flags : [],
    limits: parsed.limits && typeof parsed.limits === 'object' ? parsed.limits : {},
    mcp_server: parsed.mcp_server,
    updated_at: null,
  };
}

function snapshotFromOverride(
  override: NonNullable<CreateDeploymentInput['snapshotOverride']>
): {
  envVars: Record<string, string>;
  bindings: WorkerBinding[];
  runtimeConfig: ServiceRuntimeConfigState;
} {
  return {
    envVars: { ...override.envVars },
    bindings: [...override.bindings],
    runtimeConfig: {
      compatibility_date: override.runtimeConfig?.compatibility_date,
      compatibility_flags: override.runtimeConfig?.compatibility_flags ?? [],
      limits: override.runtimeConfig?.limits ?? {},
      mcp_server: override.runtimeConfig?.mcp_server,
      updated_at: null,
    },
  };
}

function assertMatchingIdempotentRequest(
  deployment: Deployment,
  expected: {
    bundleHash: string;
    bundleSize: number;
    strategy: 'direct' | 'canary';
    canaryWeight?: number;
  }
): void {
  const expectedRoutingStatus = expected.strategy === 'canary' ? 'canary' : 'active';
  const expectedRoutingWeight = expected.strategy === 'canary'
    ? expected.canaryWeight ?? 1
    : 100;

  if (
    deployment.bundle_hash !== expected.bundleHash ||
    deployment.bundle_size !== expected.bundleSize ||
    deployment.routing_status !== expectedRoutingStatus ||
    deployment.routing_weight !== expectedRoutingWeight
  ) {
    throw new Error('Idempotency-Key reuse does not match the original deployment request');
  }
}

export class DeploymentService {
  constructor(
    private env: DeploymentEnv,
    private encryptionKey: string
  ) {}

  async createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
    const deploymentId = generateId();
    const now = new Date().toISOString();
    const serviceId = resolveDeploymentServiceId(input);

    const serviceBasics = await getServiceDeploymentBasics(this.env.DB, serviceId);
    if (!serviceBasics.exists) {
      throw new Error('Worker not found');
    }

    const strategy = input.strategy ?? 'direct';
    const requestedCanaryWeight = input.canaryWeight ?? 1;
    const serializedTarget = serializeDeploymentTarget({
      provider: input.provider,
      target: input.target,
    });
    const normalizedTarget = parseDeploymentTargetConfig({
      provider_name: serializedTarget.providerName,
      target_json: serializedTarget.targetJson,
    });
    const artifactBaseRef = resolveDeploymentArtifactBaseRef(serviceId, normalizedTarget);

    const bundleHash = await computeSHA256(input.bundleContent);
    const bundleSize = new TextEncoder().encode(input.bundleContent).byteLength;

    if (input.idempotencyKey) {
      const existing = await getDeploymentByIdempotencyKey(this.env.DB, serviceId, input.idempotencyKey);
      if (existing) {
        assertMatchingIdempotentRequest(existing, {
          bundleHash,
          bundleSize,
          strategy,
          canaryWeight: requestedCanaryWeight,
        });
        return existing;
      }
    }
    const desiredState = createServiceDesiredStateService(this.env);
    const snapshot = input.snapshotOverride
      ? snapshotFromOverride(input.snapshotOverride)
      : await desiredState.resolveDeploymentState(input.spaceId, serviceId);

    let envVarsSnapshotEncrypted: string | null = null;
    if (Object.keys(snapshot.envVars).length > 0) {
      envVarsSnapshotEncrypted = await encryptEnvVars(
        snapshot.envVars,
        this.encryptionKey,
        deploymentId
      );
    }

    let bindingsSnapshotEncrypted: string | null = null;
    if (snapshot.bindings.length > 0) {
      const bindingsJson = JSON.stringify(snapshot.bindings);
      const encrypted = await encrypt(bindingsJson, this.encryptionKey, deploymentId);
      bindingsSnapshotEncrypted = JSON.stringify(encrypted);
    }
    const runtimeConfigSnapshotJson = JSON.stringify({
      compatibility_date: snapshot.runtimeConfig.compatibility_date,
      compatibility_flags: snapshot.runtimeConfig.compatibility_flags,
      limits: snapshot.runtimeConfig.limits,
      mcp_server: snapshot.runtimeConfig.mcp_server,
    });

    const uploadedR2Keys: string[] = [];

    try {
      // Atomically allocate version using unique constraint on (serviceId, version).
      // Retries on version collision from concurrent deployments.
      const { deployment, version } = await createDeploymentWithVersion(
        this.env.DB,
        serviceId,
        (version) => ({
          artifactRef: buildDeploymentArtifactRef(artifactBaseRef, version),
          id: deploymentId,
          serviceId,
          accountId: input.spaceId,
          version,
          bundleR2Key: `deployments/${serviceId}/${version}/bundle.js`,
          bundleHash,
          bundleSize,
          wasmR2Key: input.wasmContent ? `deployments/${serviceId}/${version}/module.wasm` : null,
          wasmHash: null,
          runtimeConfigSnapshotJson,
          bindingsSnapshotEncrypted,
          envVarsSnapshotEncrypted,
          deployState: 'pending',
          status: 'pending',
          routingStatus: strategy === 'canary' ? 'canary' : 'active',
          routingWeight: strategy === 'canary' ? requestedCanaryWeight : 100,
          deployedBy: input.userId,
          deployMessage: input.deployMessage || null,
          providerName: serializedTarget.providerName,
          targetJson: serializedTarget.targetJson,
          providerStateJson: serializedTarget.providerStateJson,
          idempotencyKey: input.idempotencyKey ?? null,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        })
      );

      const bundleR2Key = `deployments/${serviceId}/${version}/bundle.js`;

      if (this.env.WORKER_BUNDLES) {
        await this.env.WORKER_BUNDLES.put(bundleR2Key, input.bundleContent);
        uploadedR2Keys.push(bundleR2Key);
      }

      if (input.wasmContent) {
        const wasmR2Key = `deployments/${serviceId}/${version}/module.wasm`;
        const wasmHash = await computeSHA256(input.wasmContent);
        if (this.env.WORKER_BUNDLES) {
          await this.env.WORKER_BUNDLES.put(wasmR2Key, input.wasmContent);
          uploadedR2Keys.push(wasmR2Key);
        }
        await updateDeploymentRecord(this.env.DB, deploymentId, { wasmHash });
      }

      await logDeploymentEvent(this.env.DB, deploymentId, 'started', null, 'Deployment created', {
        actorAccountId: input.userId ?? null,
      });

      return deployment;
    } catch (error) {
      if (input.idempotencyKey) {
        const existing = await getDeploymentByIdempotencyKey(this.env.DB, serviceId, input.idempotencyKey);
        if (existing) {
          assertMatchingIdempotentRequest(existing, {
            bundleHash,
            bundleSize,
            strategy,
            canaryWeight: requestedCanaryWeight,
          });
          return existing;
        }
      }
      if (this.env.WORKER_BUNDLES) {
        for (const key of uploadedR2Keys) {
          try {
            await this.env.WORKER_BUNDLES.delete(key);
          } catch (cleanupErr) {
            logError(`Failed to clean up R2 artifact ${key}`, cleanupErr, { module: 'deployment' });
          }
        }
      }
      throw error;
    }
  }

  async executeDeployment(deploymentId: string): Promise<Deployment> {
    const deployment = await getDeploymentById(this.env.DB, deploymentId);

    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    if (deployment.status === 'success' || deployment.status === 'rolled_back') {
      return deployment;
    }

    const completedStepNames = (await getDeploymentEvents(this.env.DB, deploymentId))
      .filter((event) => event.event_type === 'step_completed' && event.step_name)
      .map((event) => event.step_name as string);

    await updateDeploymentState(this.env.DB, deploymentId, 'in_progress', deployment.deploy_state);
    const deploymentServiceId = getDeploymentServiceId(deployment);

    let workerHostname: string | null = null;
    let deploymentArtifactRef: string | null = null;
    let routingRollbackSnapshot: RoutingSnapshot | null = null;

    try {
      const serviceBasics = await getServiceDeploymentBasics(this.env.DB, deploymentServiceId);
      if (!serviceBasics.exists) {
        throw new Error('Worker not found');
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
        providerRegistry: getDeploymentProviderRegistry(this.env),
        cloudflareEnv: this.env,
        orchestratorUrl: this.env.OCI_ORCHESTRATOR_URL,
        orchestratorToken: this.env.OCI_ORCHESTRATOR_TOKEN,
      });

      if (!deployArtifactRef) {
        throw new Error('Deployment artifact ref is missing');
      }

      if (!completedStepNames.includes('deploy_worker')) {
        await executeDeploymentStep(this.env.DB, deploymentId, 'deploying_worker', 'deploy_worker', async () => {
          const bundleContent = await this.getBundleContent(deployment);
          await this.verifyBundleIntegrity(bundleContent, deployment);
          const wasmContent = deployment.wasm_r2_key
            ? await this.getWasmContent(deployment)
            : null;
          const runtimeConfig = parseRuntimeConfig(deployment.runtime_config_snapshot_json);
          const compatibilityDate = runtimeConfig.compatibility_date || CF_COMPATIBILITY_DATE;
          const compatibilityFlags = runtimeConfig.compatibility_flags.length > 0
            ? runtimeConfig.compatibility_flags
            : wasmContent
              ? ['nodejs_compat']
              : [];

          const bindings = deployment.bindings_snapshot_encrypted
            ? await this.decryptBindings(deployment)
            : [];
          await provider.deploy({
            deployment,
            artifactRef: deployArtifactRef,
            bundleContent,
            wasmContent,
            bindings,
            compatibilityDate,
            compatibilityFlags,
            limits: runtimeConfig.limits,
          });
        });
        completedStepNames.push('deploy_worker');
      }

      if (!completedStepNames.includes('update_routing')) {
        await executeDeploymentStep(this.env.DB, deploymentId, 'routing', 'update_routing', async () => {
          const db = getDb(this.env.DB);

          const serviceRouteRecord = await fetchServiceWithDomains(this.env, deploymentServiceId);

          if (!serviceRouteRecord) {
            throw new Error('Worker not found');
          }

          const hostnameList = collectHostnames(serviceRouteRecord);

          if (hostnameList.length === 0) {
            return;
          }

          routingRollbackSnapshot = await snapshotRouting(this.env, hostnameList);

          if (this.env.WORKER_BUNDLES && routingRollbackSnapshot) {
            const snapshotKey = `deployment-snapshots/${deploymentId}.json`;
            await this.env.WORKER_BUNDLES.put(snapshotKey, JSON.stringify(routingRollbackSnapshot));
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

          const routingCtx = {
            deploymentId,
            deploymentVersion: deployment.version,
            deployArtifactRef,
            deploymentTarget: parseDeploymentTargetConfig(deployment),
            serviceRouteRecord,
            desiredRoutingStatus: deployment.routing_status,
            desiredRoutingWeight: deployment.routing_weight,
            activeDeployment,
          };

          const { target, auditDetails } = buildRoutingTarget(routingCtx, hostnameList);

          await applyRoutingToHostnames(this.env, hostnameList, target);

          try {
            await applyRoutingDbUpdates(this.env, routingCtx, nowIso);
          } catch (dbErr) {
            if (routingRollbackSnapshot) {
              await restoreRoutingSnapshot(this.env, routingRollbackSnapshot).catch(() => {});
            }
            throw dbErr;
          }

          await logDeploymentEvent(
            this.env.DB,
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
      await updateDeploymentRecord(this.env.DB, deploymentId, {
        deployState: 'completed',
        status: 'success',
        completedAt: finishedAt,
        updatedAt: finishedAt,
      });
      try {
        const db = getDb(this.env.DB);
        await db.update(services)
          .set({
            status: 'deployed',
            updatedAt: finishedAt,
          })
          .where(eq(services.id, deploymentServiceId))
          .run();
      } catch { /* ignored */ }

      const runtimeConfig = safeJsonParseOrDefault<Partial<ServiceRuntimeConfigState>>(
        deployment.runtime_config_snapshot_json,
        {},
      );
      const currentService = await getServiceDeploymentBasics(this.env.DB, deploymentServiceId);

      await reconcileManagedWorkerMcpServer(this.env.DB, this.env, {
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

      await logDeploymentEvent(this.env.DB, deploymentId, 'completed', null, 'Deployment completed successfully');

      // Clean up routing snapshot after successful deployment
      if (this.env.WORKER_BUNDLES) {
        const snapshotKey = `deployment-snapshots/${deploymentId}.json`;
        await this.env.WORKER_BUNDLES.delete(snapshotKey).catch(() => {});
      }

      const finalDeployment = await getDeploymentById(this.env.DB, deploymentId);
      if (!finalDeployment) {
        throw new Error(`Deployment ${deploymentId} not found after successful completion`);
      }
      return finalDeployment;
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      const now = new Date().toISOString();

      await rollbackDeploymentSteps({
        env: this.env,
        deploymentId,
        deployment,
        completedStepNames,
        routingRollbackSnapshot,
        workerHostname,
        deploymentArtifactRef,
        provider: createDeploymentProvider(deployment, {
          providerRegistry: getDeploymentProviderRegistry(this.env),
          cloudflareEnv: this.env,
          orchestratorUrl: this.env.OCI_ORCHESTRATOR_URL,
          orchestratorToken: this.env.OCI_ORCHESTRATOR_TOKEN,
        }),
      });

      await updateDeploymentRecord(this.env.DB, deploymentId, {
        deployState: 'failed',
        status: 'failed',
        stepError: errorMessage,
        updatedAt: now,
      });
      const currentService = await getServiceDeploymentBasics(this.env.DB, deploymentServiceId);
      if (!currentService.activeDeploymentId) {
        try {
          const db = getDb(this.env.DB);
          await db.update(services)
            .set({
              status: 'failed',
              updatedAt: now,
            })
            .where(eq(services.id, deploymentServiceId))
            .run();
        } catch { /* ignored */ }
      }

      await logDeploymentEvent(this.env.DB, deploymentId, 'failed', deployment.current_step, errorMessage);

      throw error;
    }
  }

  async rollback(input: RollbackInput): Promise<Deployment> {
    const serviceId = resolveDeploymentServiceId(input);
    const serviceRollbackInfo = await getServiceRollbackInfo(this.env.DB, serviceId);

    if (!serviceRollbackInfo) {
      throw new Error(`Worker ${serviceId} not found`);
    }

    let targetDeployment: Deployment | null = null;

    if (input.targetVersion) {
      targetDeployment = await findDeploymentByServiceVersion(this.env.DB, serviceId, input.targetVersion);
    } else if (serviceRollbackInfo.fallbackDeploymentId) {
      targetDeployment = await getDeploymentById(this.env.DB, serviceRollbackInfo.fallbackDeploymentId);
    }

    if (!targetDeployment || getDeploymentServiceId(targetDeployment) !== serviceId) {
      throw new Error('No valid deployment found for rollback');
    }

    if (serviceRollbackInfo.activeDeploymentId && targetDeployment.id === serviceRollbackInfo.activeDeploymentId) {
      throw new Error('Target deployment is already active');
    }

    const targetArtifactRef = targetDeployment.artifact_ref;
    if (!targetArtifactRef) {
      throw new Error('Rollback target has no artifact_ref; cannot rollback via routing pointer');
    }

    const rollbackProvider = createDeploymentProvider(targetDeployment, {
      providerRegistry: getDeploymentProviderRegistry(this.env),
      cloudflareEnv: this.env,
      orchestratorUrl: this.env.OCI_ORCHESTRATOR_URL,
      orchestratorToken: this.env.OCI_ORCHESTRATOR_TOKEN,
    });
    await rollbackProvider.assertRollbackTarget(targetArtifactRef);

    const db = getDb(this.env.DB);
    const serviceRouteRecord = await fetchServiceWithDomains(this.env, serviceId);

    if (!serviceRouteRecord) {
      throw new Error('Worker not found');
    }

    const hostnameList = collectHostnames(serviceRouteRecord);

    // Snapshot existing routing so we can restore if DB update fails after switching routing.
    const routingRollbackSnapshot = hostnameList.length > 0
      ? await snapshotRouting(this.env, hostnameList)
      : [];

    // Persist snapshot to R2 for crash recovery
    if (this.env.WORKER_BUNDLES && routingRollbackSnapshot.length > 0) {
      const snapshotKey = `deployment-snapshots/rollback-${targetDeployment.id}.json`;
      await this.env.WORKER_BUNDLES.put(snapshotKey, JSON.stringify(routingRollbackSnapshot));
    }

    const rollbackRouting = buildRoutingTarget({
      deploymentId: targetDeployment.id,
      deploymentVersion: targetDeployment.version,
      deployArtifactRef: targetArtifactRef,
      deploymentTarget: parseDeploymentTargetConfig(targetDeployment),
      serviceRouteRecord,
      desiredRoutingStatus: 'rollback',
      desiredRoutingWeight: 100,
      activeDeployment: null,
    }, hostnameList);

    const nextTarget: RoutingTarget = rollbackRouting.target;

    if (hostnameList.length > 0) {
      await applyRoutingToHostnames(this.env, hostnameList, nextTarget);
    }

    const nowIso = new Date().toISOString();
    const auditDetails: Record<string, unknown> = {
      ...rollbackRouting.auditDetails,
      from_deployment_id: serviceRollbackInfo.activeDeploymentId,
      to_deployment_id: targetDeployment.id,
      from_version: serviceRollbackInfo.activeDeploymentVersion,
      to_version: targetDeployment.version,
    };

    try {
      await db.update(deployments)
        .set({
          routingStatus: 'archived',
          routingWeight: 0,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(serviceDeployments.serviceId, serviceRouteRecord.id),
            inArray(deployments.routingStatus, ['active', 'rollback', 'canary']),
            ne(deployments.id, targetDeployment.id),
          )
        )
        .run();

      await db.update(deployments)
        .set({
          routingStatus: 'rollback',
          routingWeight: 100,
          updatedAt: nowIso,
        })
        .where(eq(deployments.id, targetDeployment.id))
        .run();

      await updateServiceDeploymentPointers(this.env.DB, serviceRouteRecord.id, {
        status: 'deployed',
        fallbackDeploymentId: serviceRollbackInfo.activeDeploymentId ?? null,
        activeDeploymentId: targetDeployment.id,
        activeDeploymentVersion: targetDeployment.version,
        updatedAt: nowIso,
      });

      if (serviceRollbackInfo.activeDeploymentId) {
        await db.update(deployments)
          .set({
            rolledBackAt: nowIso,
            rolledBackBy: input.userId,
            status: 'rolled_back',
            updatedAt: nowIso,
          })
          .where(eq(deployments.id, serviceRollbackInfo.activeDeploymentId))
          .run();
      }
    } catch (dbErr) {
      // Best-effort restore previous routing snapshot.
      if (routingRollbackSnapshot.length > 0) {
        await restoreRoutingSnapshot(this.env, routingRollbackSnapshot).catch(() => {});
      }
      throw dbErr;
    }

    await logDeploymentEvent(
      this.env.DB,
      targetDeployment.id,
      'rollback_pointer',
      null,
      'Switched routing pointer to rollback deployment',
      {
        actorAccountId: input.userId,
        details: auditDetails,
      }
    );

    // Clean up routing snapshot after successful rollback
    if (this.env.WORKER_BUNDLES) {
      const snapshotKey = `deployment-snapshots/rollback-${targetDeployment.id}.json`;
      await this.env.WORKER_BUNDLES.delete(snapshotKey).catch(() => {});
    }

    return (await getDeploymentById(this.env.DB, targetDeployment.id)) ?? targetDeployment;
  }

  async rollbackWorker(workerId: string, userId: string, targetVersion?: number): Promise<Deployment> {
    return this.rollback({ serviceId: workerId, workerId, userId, targetVersion });
  }

  async resumeDeployment(deploymentId: string): Promise<Deployment> {
    const deployment = await getDeploymentById(this.env.DB, deploymentId);

    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    if (deployment.status === 'success' || deployment.status === 'rolled_back') {
      return deployment;
    }

    const now = new Date().toISOString();
    await updateDeploymentRecord(this.env.DB, deploymentId, {
      stepError: null,
      currentStep: null,
      updatedAt: now,
    });

    return this.executeDeployment(deploymentId);
  }

  async getDeploymentById(deploymentId: string): Promise<Deployment | null> {
    return getDeploymentById(this.env.DB, deploymentId);
  }

  async getDeploymentHistory(serviceId: string, limit: number = 10): Promise<Deployment[]> {
    return getDeploymentHistory(this.env.DB, serviceId, limit);
  }

  async getDeploymentEvents(deploymentId: string): Promise<DeploymentEvent[]> {
    return getDeploymentEvents(this.env.DB, deploymentId);
  }

  async getEnvVars(deployment: Deployment): Promise<Record<string, string>> {
    if (!deployment.env_vars_snapshot_encrypted) {
      return {};
    }

    return decryptEnvVars(
      deployment.env_vars_snapshot_encrypted,
      this.encryptionKey,
      deployment.id
    );
  }

  async getMaskedEnvVars(deployment: Deployment): Promise<Record<string, string>> {
    const envVars = await this.getEnvVars(deployment);
    return maskEnvVars(envVars);
  }

  async getBindings(deployment: Deployment): Promise<WorkerBinding[]> {
    return this.decryptBindings(deployment);
  }

  private async getBundleContent(deployment: Deployment): Promise<string> {
    if (!deployment.bundle_r2_key || !this.env.WORKER_BUNDLES) {
      throw new Error('Bundle not found');
    }

    const object = await this.env.WORKER_BUNDLES.get(deployment.bundle_r2_key);
    if (!object) {
      throw new Error(`Bundle not found at ${deployment.bundle_r2_key}`);
    }

    return object.text();
  }

  private async verifyBundleIntegrity(bundleContent: string, deployment: Deployment): Promise<void> {
    if (deployment.bundle_hash) {
      const actual = await computeSHA256(bundleContent);
      if (!constantTimeEqual(actual, deployment.bundle_hash)) {
        throw new Error(`Bundle hash mismatch: expected ${deployment.bundle_hash}, got ${actual}`);
      }
    }

    if (typeof deployment.bundle_size === 'number') {
      const size = new TextEncoder().encode(bundleContent).byteLength;
      if (size !== deployment.bundle_size) {
        throw new Error(`Bundle size mismatch: expected ${deployment.bundle_size}, got ${size}`);
      }
    }
  }

  private async getWasmContent(deployment: Deployment): Promise<ArrayBuffer | null> {
    if (!deployment.wasm_r2_key || !this.env.WORKER_BUNDLES) {
      return null;
    }

    const object = await this.env.WORKER_BUNDLES.get(deployment.wasm_r2_key);
    if (!object) {
      return null;
    }

    return object.arrayBuffer();
  }

  private async decryptBindings(deployment: Deployment): Promise<WorkerBinding[]> {
    if (!deployment.bindings_snapshot_encrypted) {
      return [];
    }

    let encryptedParsed: unknown;
    try {
      encryptedParsed = JSON.parse(deployment.bindings_snapshot_encrypted);
    } catch (err) {
      throw new Error(`Failed to parse bindings_snapshot_encrypted for deployment ${deployment.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (
      typeof encryptedParsed !== 'object' || encryptedParsed === null ||
      typeof (encryptedParsed as Record<string, unknown>).ciphertext !== 'string' ||
      typeof (encryptedParsed as Record<string, unknown>).iv !== 'string'
    ) {
      throw new Error(`Invalid encrypted data structure for deployment ${deployment.id}: missing ciphertext or iv`);
    }
    const encrypted = encryptedParsed as EncryptedData;

    const decrypted = await decrypt(encrypted, this.encryptionKey, deployment.id);

    let bindingsParsed: unknown;
    try {
      bindingsParsed = JSON.parse(decrypted);
    } catch (err) {
      throw new Error(`Failed to parse decrypted bindings for deployment ${deployment.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!Array.isArray(bindingsParsed)) {
      throw new Error(`Decrypted bindings for deployment ${deployment.id} is not an array`);
    }
    return bindingsParsed as WorkerBinding[];
  }

  /**
   * Detect and reset stuck deployments.
   *
   * Finds deployments that have been in "in_progress" status for longer than
   * timeoutMs (default: 10 minutes) and marks them as failed so they can be
   * retried via resumeDeployment().
   *
   * Returns the number of deployments that were reset.
   */
  async cleanupStuckDeployments(timeoutMs?: number): Promise<number> {
    const stuck = await detectStuckDeployments(this.env.DB, timeoutMs);
    for (const deployment of stuck) {
      await resetStuckDeployment(
        this.env.DB,
        deployment.id,
        `Deployment stuck in step "${deployment.current_step}" for over ${Math.round((timeoutMs || 600000) / 60000)} minutes; auto-reset to failed`
      );
    }
    return stuck.length;
  }
}

export function createDeploymentService(env: DeploymentEnv): DeploymentService {
  const encryptionKey = env.ENCRYPTION_KEY || '';

  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY must be set for deployment service');
  }

  return new DeploymentService(env, encryptionKey);
}
