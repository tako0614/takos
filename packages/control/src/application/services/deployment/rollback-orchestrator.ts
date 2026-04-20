/**
 * Rollback orchestration logic.
 *
 * Implements the high-level rollback workflow: validate target, re-deploy
 * container artifacts if needed, switch routing pointers, and update DB
 * records. Extracted from DeploymentService to keep the main service file
 * focused on coordination.
 */
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import type { Deployment, DeploymentEnv, RollbackInput } from "./models.ts";
import {
  createDeploymentBackend,
  parseDeploymentBackendConfig,
} from "./backend.ts";
import {
  createDeploymentBackendRegistry,
  resolveDeploymentBackendConfigsFromEnv,
} from "../../../platform/deployment-backends.ts";
import {
  findDeploymentByServiceVersion,
  getDeploymentById,
  getDeploymentServiceId,
  getServiceRollbackInfo,
  logDeploymentEvent,
  updateDeploymentRecord,
  updateServiceDeploymentPointers,
} from "./store.ts";
import type { RoutingTarget } from "../routing/routing-models.ts";
import {
  applyRoutingToHostnames,
  buildRoutingTarget,
  collectHostnames,
  fetchServiceWithDomains,
  restoreRoutingSnapshot,
  runRoutingMutationWithRollback,
  snapshotRouting,
} from "./routing.ts";
import {
  deployments,
  getDb,
  serviceDeployments,
} from "../../../infra/db/index.ts";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "takos-common/errors";
import {
  parseRuntimeConfig,
  resolveDeploymentServiceId,
} from "./artifact-refs.ts";
import { decryptBindings, getEnvVars } from "./artifact-io.ts";
import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";

function mergeRuntimeEnvVars(
  envVars: Record<string, string>,
  bindings: WorkerBinding[],
): Record<string, string> {
  const merged = { ...envVars };
  for (const binding of bindings) {
    if (binding.type === "plain_text" || binding.type === "secret_text") {
      merged[binding.name] = binding.text ?? "";
    }
  }
  return merged;
}

/**
 * Execute a rollback to a previous deployment version.
 *
 * Validates rollback target, re-deploys container artifacts when needed,
 * switches routing pointers, and updates all DB records.
 */
export async function executeRollback(
  env: DeploymentEnv,
  input: RollbackInput,
): Promise<Deployment> {
  const serviceId = resolveDeploymentServiceId(input);
  const serviceRollbackInfo = await getServiceRollbackInfo(env.DB, serviceId);

  if (!serviceRollbackInfo) {
    throw new NotFoundError(`Worker ${serviceId}`);
  }

  let targetDeployment: Deployment | null = null;

  if (input.targetVersion) {
    targetDeployment = await findDeploymentByServiceVersion(
      env.DB,
      serviceId,
      input.targetVersion,
    );
  } else if (serviceRollbackInfo.fallbackDeploymentId) {
    targetDeployment = await getDeploymentById(
      env.DB,
      serviceRollbackInfo.fallbackDeploymentId,
    );
  }

  if (
    !targetDeployment || getDeploymentServiceId(targetDeployment) !== serviceId
  ) {
    throw new NotFoundError("No valid deployment found for rollback");
  }

  if (
    serviceRollbackInfo.activeDeploymentId &&
    targetDeployment.id === serviceRollbackInfo.activeDeploymentId
  ) {
    throw new ConflictError("Target deployment is already active");
  }

  const targetArtifactRef = targetDeployment.artifact_ref;
  if (!targetArtifactRef) {
    throw new BadRequestError(
      "Rollback target has no artifact_ref; cannot rollback via routing pointer",
    );
  }

  const rollbackBackend = createDeploymentBackend(targetDeployment, {
    cloudflareEnv: env,
    orchestratorUrl: env.OCI_ORCHESTRATOR_URL,
    orchestratorToken: env.OCI_ORCHESTRATOR_TOKEN,
    backendRegistry: createDeploymentBackendRegistry(
      resolveDeploymentBackendConfigsFromEnv(env),
    ),
  });

  const isContainerRollback =
    targetDeployment.artifact_kind === "container-image";
  const encryptionKey = env.ENCRYPTION_KEY ?? "";

  // For container rollback, re-deploy the target image via the backend
  if (isContainerRollback) {
    const runtimeConfig = parseRuntimeConfig(
      targetDeployment.runtime_config_snapshot_json,
    );
    const runtimeBindings = targetDeployment.bindings_snapshot_encrypted
      ? await decryptBindings(encryptionKey, targetDeployment)
      : [];
    const envVars = await getEnvVars(encryptionKey, targetDeployment);
    const deployResult = await rollbackBackend.deploy({
      deployment: targetDeployment,
      artifactRef: targetArtifactRef,
      wasmContent: null,
      runtime: {
        profile: "container-service",
        bindings: [],
        envVars: mergeRuntimeEnvVars(envVars, runtimeBindings),
        config: {
          compatibility_date: runtimeConfig.compatibility_date || "2024-01-01",
          compatibility_flags: runtimeConfig.compatibility_flags,
          limits: runtimeConfig.limits,
        },
      },
    });

    // Update backend_state_json with fresh resolved endpoint
    if (deployResult?.resolvedEndpoint) {
      const backendState = safeJsonParseOrDefault<Record<string, unknown>>(
        targetDeployment.backend_state_json,
        {},
      );
      backendState.resolved_endpoint = deployResult.resolvedEndpoint;
      if (deployResult.logsRef) {
        backendState.logs_ref = deployResult.logsRef;
      }
      await updateDeploymentRecord(env.DB, targetDeployment.id, {
        backendStateJson: JSON.stringify(backendState),
      });
      targetDeployment.backend_state_json = JSON.stringify(backendState);
    }
  } else {
    await rollbackBackend.assertRollbackTarget(targetArtifactRef);
  }

  const db = getDb(env.DB);
  const serviceRouteRecord = await fetchServiceWithDomains(env, serviceId);

  if (!serviceRouteRecord) {
    throw new NotFoundError("Worker");
  }

  const hostnameList = collectHostnames(serviceRouteRecord);

  // Snapshot existing routing so we can restore if DB update fails after switching routing.
  const routingRollbackSnapshot = hostnameList.length > 0
    ? await snapshotRouting(env, hostnameList)
    : [];

  // Persist snapshot to R2 for crash recovery
  if (env.WORKER_BUNDLES && routingRollbackSnapshot.length > 0) {
    const snapshotKey =
      `deployment-snapshots/rollback-${targetDeployment.id}.json`;
    await env.WORKER_BUNDLES.put(
      snapshotKey,
      JSON.stringify(routingRollbackSnapshot),
    );
  }

  // For container rollback, inject resolved endpoint into the deployment target
  let rollbackDeploymentTarget = parseDeploymentBackendConfig(targetDeployment);
  if (isContainerRollback) {
    const backendState = safeJsonParseOrDefault<Record<string, unknown>>(
      targetDeployment.backend_state_json,
      {},
    );
    const resolvedEp = backendState.resolved_endpoint as
      | { base_url?: string }
      | undefined;
    if (resolvedEp?.base_url) {
      rollbackDeploymentTarget = {
        ...rollbackDeploymentTarget,
        endpoint: { kind: "http-url", base_url: resolvedEp.base_url },
      };
    }
  }

  const rollbackRouting = buildRoutingTarget({
    deploymentId: targetDeployment.id,
    deploymentVersion: targetDeployment.version,
    deployArtifactRef: targetArtifactRef,
    deploymentTarget: rollbackDeploymentTarget,
    serviceRouteRecord,
    desiredRoutingStatus: "rollback",
    desiredRoutingWeight: 100,
    activeDeployment: null,
  }, hostnameList);

  const nextTarget: RoutingTarget = rollbackRouting.target;

  if (hostnameList.length > 0) {
    await runRoutingMutationWithRollback(
      env,
      routingRollbackSnapshot,
      () => applyRoutingToHostnames(env, hostnameList, nextTarget),
      {
        module: "rollback-orchestrator",
        message:
          "Failed to restore routing snapshot during rollback routing update (non-critical)",
      },
    );
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
        routingStatus: "archived",
        routingWeight: 0,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(serviceDeployments.serviceId, serviceRouteRecord.id),
          inArray(deployments.routingStatus, ["active", "rollback", "canary"]),
          ne(deployments.id, targetDeployment.id),
        ),
      )
      .run();

    await db.update(deployments)
      .set({
        routingStatus: "rollback",
        routingWeight: 100,
        updatedAt: nowIso,
      })
      .where(eq(deployments.id, targetDeployment.id))
      .run();

    await updateServiceDeploymentPointers(env.DB, serviceRouteRecord.id, {
      status: "deployed",
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
          status: "rolled_back",
          updatedAt: nowIso,
        })
        .where(eq(deployments.id, serviceRollbackInfo.activeDeploymentId))
        .run();
    }
  } catch (dbErr) {
    // Best-effort restore previous routing snapshot.
    if (routingRollbackSnapshot.length > 0) {
      await restoreRoutingSnapshot(env, routingRollbackSnapshot).catch((e) => {
        logWarn(
          "Failed to restore routing snapshot during rollback (non-critical)",
          {
            module: "rollback-orchestrator",
            error: e instanceof Error ? e.message : String(e),
          },
        );
      });
    }
    throw dbErr;
  }

  await logDeploymentEvent(
    env.DB,
    targetDeployment.id,
    "rollback_pointer",
    null,
    "Switched routing pointer to rollback deployment",
    {
      actorAccountId: input.userId,
      details: auditDetails,
    },
  );

  // Clean up routing snapshot after successful rollback
  if (env.WORKER_BUNDLES) {
    const snapshotKey =
      `deployment-snapshots/rollback-${targetDeployment.id}.json`;
    await env.WORKER_BUNDLES.delete(snapshotKey).catch((e: unknown) => {
      logWarn("Failed to clean up rollback snapshot (non-critical)", {
        module: "rollback-orchestrator",
        error: e instanceof Error ? e.message : String(e),
      });
    });
  }

  return (await getDeploymentById(env.DB, targetDeployment.id)) ??
    targetDeployment;
}
