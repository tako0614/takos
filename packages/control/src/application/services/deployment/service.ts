/**
 * Core deployment service — CRUD and lifecycle management.
 *
 * Provides the DeploymentService class that coordinates deployment creation,
 * execution, rollback, and query operations by delegating to the executor,
 * rollback, artifact, and helper sub-modules.
 */
import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { encrypt, encryptEnvVars } from "../../../shared/utils/crypto.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import { ServiceDesiredStateService } from "../platform/worker-desired-state.ts";
import type {
  ArtifactKind,
  CreateDeploymentInput,
  Deployment,
  DeploymentBackendName,
  DeploymentEnv,
  DeploymentEvent,
  DeploymentTarget,
  RollbackInput,
} from "./models.ts";
import {
  parseDeploymentBackendConfig,
  serializeDeploymentBackendTarget,
} from "./backend.ts";
import { resolveDefaultDeploymentBackendRef } from "./backend-defaults.ts";
import {
  createDeploymentWithVersion,
  getDeploymentById,
  getDeploymentByIdempotencyKey,
  getDeploymentEvents,
  getDeploymentHistory,
  getServiceDeploymentBasics,
  logDeploymentEvent,
  updateDeploymentRecord,
} from "./store.ts";
import { detectStuckDeployments, resetStuckDeployment } from "./state.ts";
import { getDb, services } from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import { logError } from "../../../shared/utils/logger.ts";
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";
import {
  assertMatchingIdempotentRequest,
  resolveDeploymentArtifactBaseRef,
  resolveDeploymentServiceId,
  snapshotFromOverride,
} from "./artifact-refs.ts";
// Re-export for backward compatibility — external code imports buildDeploymentArtifactRef / DeploymentEnv from here.
export { buildDeploymentArtifactRef } from "./artifact-refs.ts";
export type { DeploymentEnv } from "./models.ts";
import { buildDeploymentArtifactRef } from "./artifact-refs.ts";
import { executeDeploymentPipeline } from "./execute.ts";
import { executeRollback } from "./rollback-orchestrator.ts";
import {
  decryptBindings,
  getEnvVars,
  getMaskedEnvVars,
} from "./artifact-io.ts";

export function assertQueueConsumerBackendSupported(
  backendName: DeploymentBackendName,
  target: DeploymentTarget,
): void {
  if (
    (target.queue_consumers?.length ?? 0) > 0 &&
    backendName !== "workers-dispatch"
  ) {
    throw new BadRequestError(
      `queue consumers require the workers-dispatch backend (got: ${backendName})`,
    );
  }
}

export class DeploymentService {
  private encryptionKey: string;

  constructor(
    private env: DeploymentEnv,
    encryptionKey?: string,
  ) {
    this.encryptionKey = encryptionKey ?? env.ENCRYPTION_KEY ?? "";
    if (!this.encryptionKey) {
      throw new InternalError(
        "ENCRYPTION_KEY must be set for deployment service",
      );
    }
  }

  async createDeployment(input: CreateDeploymentInput): Promise<Deployment> {
    const deploymentId = generateId();
    const now = new Date().toISOString();
    const serviceId = resolveDeploymentServiceId(input);
    const artifactKind: ArtifactKind = input.artifactKind ?? "worker-bundle";
    const isContainerDeploy = artifactKind === "container-image";

    if (!isContainerDeploy && !this.env.WORKER_BUNDLES) {
      throw new InternalError(
        "WORKER_BUNDLES must be configured for worker-bundle deployments",
      );
    }

    const serviceBasics = await getServiceDeploymentBasics(
      this.env.DB,
      serviceId,
    );
    if (!serviceBasics.exists) {
      throw new NotFoundError("Worker");
    }

    // Enforce same-kind rule: a service cannot mix artifact kinds after its first deploy.
    if (
      serviceBasics.workloadKind && serviceBasics.workloadKind !== artifactKind
    ) {
      throw new BadRequestError(
        `Service workload kind is '${serviceBasics.workloadKind}'; cannot deploy '${artifactKind}'`,
      );
    }

    const strategy = input.strategy ?? "direct";
    const requestedCanaryWeight = input.canaryWeight ?? 1;
    const serializedTarget = serializeDeploymentBackendTarget({
      backend: input.backend ??
        resolveDefaultDeploymentBackendRef(this.env, artifactKind),
      target: input.target,
    });
    const normalizedTarget = parseDeploymentBackendConfig({
      backend_name: serializedTarget.backendName,
      target_json: serializedTarget.targetJson,
    });
    if (
      strategy === "canary" &&
      (normalizedTarget.queue_consumers?.length ?? 0) > 0
    ) {
      throw new BadRequestError(
        "canary strategy is not supported for deployments with queue consumers",
      );
    }
    assertQueueConsumerBackendSupported(
      serializedTarget.backendName,
      normalizedTarget,
    );
    const artifactBaseRef = resolveDeploymentArtifactBaseRef(
      serviceId,
      normalizedTarget,
    );

    const bundleHash = isContainerDeploy
      ? null
      : await computeSHA256(input.bundleContent!);
    const bundleSize = isContainerDeploy
      ? null
      : new TextEncoder().encode(input.bundleContent!).byteLength;
    const imageRef = normalizedTarget.artifact?.image_ref;

    if (input.idempotencyKey) {
      const existing = await getDeploymentByIdempotencyKey(
        this.env.DB,
        serviceId,
        input.idempotencyKey,
      );
      if (existing) {
        assertMatchingIdempotentRequest(existing, {
          artifactKind,
          bundleHash,
          bundleSize,
          imageRef,
          targetJson: serializedTarget.targetJson,
          strategy,
          canaryWeight: requestedCanaryWeight,
        });
        return existing;
      }
    }

    const desiredState = new ServiceDesiredStateService(this.env);
    const snapshot = input.snapshotOverride
      ? snapshotFromOverride(input.snapshotOverride)
      : await desiredState.resolveDeploymentState(input.spaceId, serviceId);

    let envVarsSnapshotEncrypted: string | null = null;
    if (Object.keys(snapshot.envVars).length > 0) {
      envVarsSnapshotEncrypted = await encryptEnvVars(
        snapshot.envVars,
        this.encryptionKey,
        deploymentId,
      );
    }

    let bindingsSnapshotEncrypted: string | null = null;
    if (snapshot.bindings.length > 0) {
      const bindingsJson = JSON.stringify(snapshot.bindings);
      const encrypted = await encrypt(
        bindingsJson,
        this.encryptionKey,
        deploymentId,
      );
      bindingsSnapshotEncrypted = JSON.stringify(encrypted);
    }
    const runtimeConfigSnapshotJson = JSON.stringify({
      compatibility_date: snapshot.runtimeConfig.compatibility_date,
      compatibility_flags: snapshot.runtimeConfig.compatibility_flags,
      limits: snapshot.runtimeConfig.limits,
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
          artifactKind,
          id: deploymentId,
          serviceId,
          accountId: input.spaceId,
          version,
          bundleR2Key: isContainerDeploy
            ? null
            : `deployments/${serviceId}/${version}/bundle.js`,
          bundleHash,
          bundleSize,
          wasmR2Key: (!isContainerDeploy && input.wasmContent)
            ? `deployments/${serviceId}/${version}/module.wasm`
            : null,
          wasmHash: null,
          runtimeConfigSnapshotJson,
          bindingsSnapshotEncrypted,
          envVarsSnapshotEncrypted,
          deployState: "pending",
          status: "pending",
          routingStatus: strategy === "canary" ? "canary" : "active",
          routingWeight: strategy === "canary" ? requestedCanaryWeight : 100,
          deployedBy: input.userId,
          deployMessage: input.deployMessage || null,
          backendName: serializedTarget.backendName,
          targetJson: serializedTarget.targetJson,
          backendStateJson: serializedTarget.backendStateJson,
          idempotencyKey: input.idempotencyKey ?? null,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      );

      // Lock workload_kind on first deploy
      if (!serviceBasics.workloadKind) {
        const db = getDb(this.env.DB);
        await db.update(services)
          .set({ workloadKind: artifactKind, updatedAt: now })
          .where(eq(services.id, serviceId))
          .run();
      }

      if (!isContainerDeploy) {
        const bundleR2Key = `deployments/${serviceId}/${version}/bundle.js`;

        if (this.env.WORKER_BUNDLES) {
          await this.env.WORKER_BUNDLES.put(bundleR2Key, input.bundleContent!);
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
      }

      await logDeploymentEvent(
        this.env.DB,
        deploymentId,
        "started",
        null,
        "Deployment created",
        {
          actorAccountId: input.userId ?? null,
        },
      );

      return deployment;
    } catch (error) {
      if (input.idempotencyKey) {
        const existing = await getDeploymentByIdempotencyKey(
          this.env.DB,
          serviceId,
          input.idempotencyKey,
        );
        if (existing) {
          assertMatchingIdempotentRequest(existing, {
            artifactKind,
            bundleHash,
            bundleSize,
            imageRef,
            targetJson: serializedTarget.targetJson,
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
            logError(`Failed to clean up R2 artifact ${key}`, cleanupErr, {
              module: "deployment",
            });
          }
        }
      }
      throw error;
    }
  }

  async executeDeployment(deploymentId: string): Promise<Deployment> {
    return executeDeploymentPipeline(
      this.env,
      this.encryptionKey,
      deploymentId,
    );
  }

  async rollback(input: RollbackInput): Promise<Deployment> {
    return executeRollback(this.env, input);
  }

  async rollbackWorker(
    workerId: string,
    userId: string,
    targetVersion?: number,
  ): Promise<Deployment> {
    return this.rollback({
      serviceId: workerId,
      workerId,
      userId,
      targetVersion,
    });
  }

  async resumeDeployment(deploymentId: string): Promise<Deployment> {
    const deployment = await getDeploymentById(this.env.DB, deploymentId);

    if (!deployment) {
      throw new NotFoundError(`Deployment ${deploymentId}`);
    }

    if (
      deployment.status === "success" || deployment.status === "rolled_back"
    ) {
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

  async getDeploymentHistory(
    serviceId: string,
    limit: number = 10,
  ): Promise<Deployment[]> {
    return getDeploymentHistory(this.env.DB, serviceId, limit);
  }

  async getDeploymentEvents(deploymentId: string): Promise<DeploymentEvent[]> {
    return getDeploymentEvents(this.env.DB, deploymentId);
  }

  async getEnvVars(deployment: Deployment): Promise<Record<string, string>> {
    return getEnvVars(this.encryptionKey, deployment);
  }

  async getMaskedEnvVars(
    deployment: Deployment,
  ): Promise<Record<string, string>> {
    return getMaskedEnvVars(this.encryptionKey, deployment);
  }

  async getBindings(deployment: Deployment): Promise<WorkerBinding[]> {
    return decryptBindings(this.encryptionKey, deployment);
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
        `Deployment stuck in step "${deployment.current_step}" for over ${
          Math.round((timeoutMs || 600000) / 60000)
        } minutes; auto-reset to failed`,
      );
    }
    return stuck.length;
  }
}
