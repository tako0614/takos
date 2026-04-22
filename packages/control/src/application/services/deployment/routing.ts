import type { DbEnv } from "../../../shared/types/index.ts";
import {
  deployments,
  getDb,
  serviceDeployments,
  services,
} from "../../../infra/db/index.ts";
import { and, eq, inArray, ne } from "drizzle-orm";
import {
  deleteHostnameRouting,
  resolveHostnameRouting,
  upsertHostnameRouting,
} from "../routing/service.ts";
import type {
  RoutingBindings,
  RoutingTarget,
} from "../routing/routing-models.ts";
import {
  createDeploymentBackend,
  parseDeploymentBackendConfig,
} from "./backend.ts";
import {
  createDeploymentBackendRegistry,
  resolveDeploymentBackendConfigsFromEnv,
} from "../../../platform/deployment-backends.ts";
import {
  type DeploymentRoutingServiceRecord,
  getDeploymentById,
  getDeploymentRoutingServiceRecord,
  logDeploymentEvent,
  updateServiceDeploymentPointers,
} from "./store.ts";
import type { Deployment, DeploymentEnv, DeploymentTarget } from "./models.ts";
import { parseRuntimeConfig } from "./artifact-refs.ts";
import { decryptBindings } from "./artifact-io.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "takos-common/errors";

type DeploymentRoutingEnv = DbEnv & RoutingBindings;

export type RoutingSnapshot = Array<
  { hostname: string; target: RoutingTarget | null }
>;

type ActiveDeploymentInfo = {
  id: string;
  artifactRef: string | null;
  targetJson: string;
  routingStatus: string;
};

type RoutingContext = {
  deploymentId: string;
  deploymentVersion: number;
  deployArtifactRef: string;
  deploymentTarget: DeploymentTarget;
  serviceRouteRecord: DeploymentRoutingServiceRecord;
  desiredRoutingStatus: string;
  desiredRoutingWeight: number;
  activeDeployment: ActiveDeploymentInfo | null;
};

type RoutingPlan = {
  target: RoutingTarget;
  auditDetails: Record<string, unknown>;
};

function resolveDeploymentRouteRef(input: {
  deploymentTarget?: DeploymentTarget;
  targetJson?: string;
  artifactRef: string | null;
}): string | null {
  const target = input.deploymentTarget ??
    (input.targetJson
      ? parseDeploymentBackendConfig({
        backend_name: "workers-dispatch",
        target_json: input.targetJson,
      })
      : undefined);
  const artifactRef = input.artifactRef?.trim() || "";
  if (target?.artifact?.kind === "worker-bundle" && artifactRef) {
    return artifactRef;
  }
  const routeRef = target?.route_ref?.trim() ||
    (target?.endpoint?.kind === "service-ref"
      ? target.endpoint.ref.trim()
      : "") ||
    artifactRef ||
    "";
  return routeRef || null;
}

function normalizeCanaryWeight(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  const normalized = Math.round(raw);
  return Math.min(99, Math.max(1, normalized));
}

export function collectHostnames(serviceRouteRecord: {
  hostname: string | null;
  customDomains: Array<{ domain: string | null }>;
}): string[] {
  const hostnames = new Set<string>();
  if (serviceRouteRecord.hostname) {
    hostnames.add(serviceRouteRecord.hostname.toLowerCase());
  }
  for (const customDomain of serviceRouteRecord.customDomains) {
    if (customDomain.domain) hostnames.add(customDomain.domain.toLowerCase());
  }
  return Array.from(hostnames);
}

export async function snapshotRouting(
  env: DeploymentRoutingEnv,
  hostnameList: string[],
): Promise<RoutingSnapshot> {
  const snapshots: RoutingSnapshot = [];
  for (const hostname of hostnameList) {
    const resolved = await resolveHostnameRouting({ env, hostname });
    snapshots.push({
      hostname,
      target: resolved.tombstone ? null : resolved.target,
    });
  }
  return snapshots;
}

export async function restoreRoutingSnapshot(
  env: DeploymentRoutingEnv,
  snapshot: RoutingSnapshot,
): Promise<void> {
  for (const item of snapshot) {
    if (item.target) {
      await upsertHostnameRouting({
        env,
        hostname: item.hostname,
        target: item.target,
      });
    } else {
      await deleteHostnameRouting({ env, hostname: item.hostname });
    }
  }
}

type RoutingMutationRollbackLogContext = {
  module?: string;
  message?: string;
};

export async function runRoutingMutationWithRollback<T>(
  env: DeploymentRoutingEnv,
  snapshot: RoutingSnapshot | null | undefined,
  operation: () => Promise<T>,
  logContext: RoutingMutationRollbackLogContext = {},
): Promise<T> {
  const rollbackSnapshot = snapshot ?? [];

  try {
    return await operation();
  } catch (error) {
    if (rollbackSnapshot.length > 0) {
      await restoreRoutingSnapshot(env, rollbackSnapshot).catch(
        (restoreError) => {
          logWarn(
            logContext.message ??
              "Failed to restore routing snapshot during routing mutation (non-critical)",
            {
              module: logContext.module ?? "routing",
              error: restoreError instanceof Error
                ? restoreError.message
                : String(restoreError),
            },
          );
        },
      );
    }
    throw error;
  }
}

export function buildRoutingTarget(
  ctx: RoutingContext,
  hostnameList: string[],
): RoutingPlan {
  const baseDetails: Record<string, unknown> = {
    hostnames: hostnameList,
    desired_routing_status: ctx.desiredRoutingStatus,
    desired_routing_weight: ctx.desiredRoutingWeight,
    deployment_target_endpoint_kind: ctx.deploymentTarget.endpoint?.kind ??
      null,
  };

  if (ctx.deploymentTarget.endpoint?.kind === "http-url") {
    if (ctx.desiredRoutingStatus === "canary") {
      throw new Error(
        "http-url deployment targets do not support canary routing",
      );
    }

    const endpointName = ctx.deploymentTarget.route_ref ||
      ctx.deployArtifactRef;
    return {
      target: {
        type: "http-endpoint-set",
        endpoints: [
          {
            name: endpointName,
            routes: [],
            target: {
              kind: "http-url",
              baseUrl: ctx.deploymentTarget.endpoint.base_url,
            },
          },
        ],
      },
      auditDetails: {
        ...baseDetails,
        mode: "http-url",
        http_endpoint: ctx.deploymentTarget.endpoint.base_url,
        route_ref: ctx.deploymentTarget.route_ref ?? null,
      },
    };
  }

  const deploymentRouteRef = resolveDeploymentRouteRef({
    deploymentTarget: ctx.deploymentTarget,
    artifactRef: ctx.deployArtifactRef,
  });
  if (!deploymentRouteRef) {
    throw new Error("Deployment route ref is missing");
  }

  if (ctx.desiredRoutingStatus !== "canary") {
    const deploymentStatus = ctx.desiredRoutingStatus === "rollback"
      ? "rollback"
      : "active";
    return {
      target: {
        type: "deployments",
        deployments: [
          {
            routeRef: deploymentRouteRef,
            weight: 100,
            deploymentId: ctx.deploymentId,
            status: deploymentStatus,
          },
        ],
      },
      auditDetails: {
        ...baseDetails,
        mode: deploymentStatus,
        artifact_ref: ctx.deployArtifactRef,
        route_ref: deploymentRouteRef,
        active_deployment_id: ctx.serviceRouteRecord.activeDeploymentId,
      },
    };
  }

  const canaryWeight = normalizeCanaryWeight(ctx.desiredRoutingWeight);
  const activeWeight = 100 - canaryWeight;
  const activeRouteRef = ctx.activeDeployment
    ? resolveDeploymentRouteRef({
      targetJson: ctx.activeDeployment.targetJson,
      artifactRef: ctx.activeDeployment.artifactRef,
    })
    : null;
  if (!activeRouteRef) {
    throw new Error("Active deployment route ref is missing");
  }

  return {
    target: {
      type: "deployments",
      deployments: [
        {
          routeRef: activeRouteRef,
          weight: activeWeight,
          deploymentId: ctx.activeDeployment?.id,
          status: ctx.activeDeployment?.routingStatus === "rollback"
            ? "rollback"
            : "active",
        },
        {
          routeRef: deploymentRouteRef,
          weight: canaryWeight,
          deploymentId: ctx.deploymentId,
          status: "canary",
        },
      ],
    },
    auditDetails: {
      ...baseDetails,
      mode: "canary",
      active_weight: activeWeight,
      canary_weight: canaryWeight,
      active_deployment_id: ctx.activeDeployment?.id,
      active_route_ref: activeRouteRef,
      canary_route_ref: deploymentRouteRef,
    },
  };
}

export async function applyRoutingDbUpdates(
  env: DeploymentRoutingEnv,
  ctx: RoutingContext,
  nowIso: string,
): Promise<void> {
  const db = getDb(env.DB);

  if (ctx.desiredRoutingStatus !== "canary") {
    await db.update(deployments)
      .set({
        routingStatus: "archived",
        routingWeight: 0,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(serviceDeployments.serviceId, ctx.serviceRouteRecord.id),
          ne(deployments.id, ctx.deploymentId),
          inArray(deployments.routingStatus, ["active", "rollback", "canary"]),
        ),
      )
      .run();

    await db.update(deployments)
      .set({
        routingStatus: "active",
        routingWeight: 100,
        updatedAt: nowIso,
      })
      .where(eq(deployments.id, ctx.deploymentId))
      .run();

    await updateServiceDeploymentPointers(env.DB, ctx.serviceRouteRecord.id, {
      status: "deployed",
      fallbackDeploymentId: ctx.serviceRouteRecord.activeDeploymentId ?? null,
      activeDeploymentId: ctx.deploymentId,
      activeDeploymentVersion: ctx.deploymentVersion,
      updatedAt: nowIso,
    });

    return;
  }

  const canaryWeight = normalizeCanaryWeight(ctx.desiredRoutingWeight);
  const activeWeight = 100 - canaryWeight;

  if (ctx.activeDeployment?.id) {
    await db.update(deployments)
      .set({
        routingStatus: ctx.activeDeployment.routingStatus === "rollback"
          ? "rollback"
          : "active",
        routingWeight: activeWeight,
        updatedAt: nowIso,
      })
      .where(eq(deployments.id, ctx.activeDeployment.id))
      .run();
  }

  await db.update(deployments)
    .set({
      routingStatus: "archived",
      routingWeight: 0,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(serviceDeployments.serviceId, ctx.serviceRouteRecord.id),
        eq(deployments.routingStatus, "canary"),
        ne(deployments.id, ctx.deploymentId),
      ),
    )
    .run();

  await db.update(deployments)
    .set({
      routingStatus: "canary",
      routingWeight: canaryWeight,
      updatedAt: nowIso,
    })
    .where(eq(deployments.id, ctx.deploymentId))
    .run();

  await db.update(services)
    .set({
      status: "deployed",
      updatedAt: nowIso,
    })
    .where(eq(services.id, ctx.serviceRouteRecord.id))
    .run();
}

export async function applyRoutingToHostnames(
  env: DeploymentRoutingEnv,
  hostnameList: string[],
  target: RoutingTarget,
): Promise<void> {
  for (const hostname of hostnameList) {
    await upsertHostnameRouting({ env, hostname, target });
  }
}

export async function fetchServiceWithDomains(
  env: DeploymentRoutingEnv,
  serviceId: string,
): Promise<DeploymentRoutingServiceRecord | null> {
  return getDeploymentRoutingServiceRecord(env.DB, serviceId);
}

export interface CanaryDeploymentInput {
  serviceId: string;
  deploymentId: string;
  userId: string;
}

export interface PromoteCanaryResult {
  deploymentId: string;
}

export interface AbortCanaryResult {
  deploymentId: string;
  rolledBackTo: string;
}

/**
 * Resolve the deployment target for a deployment, injecting the resolved
 * container endpoint when the artifact is a container image.
 */
function resolveDeploymentTargetForRouting(
  deployment: Deployment,
): DeploymentTarget {
  const baseTarget = parseDeploymentBackendConfig(deployment);
  if (deployment.artifact_kind !== "container-image") {
    return baseTarget;
  }
  const backendState = safeJsonParseOrDefault<Record<string, unknown>>(
    deployment.backend_state_json,
    {},
  );
  const resolvedEp = backendState.resolved_endpoint as
    | { base_url?: string }
    | undefined;
  if (resolvedEp?.base_url) {
    return {
      ...baseTarget,
      endpoint: { kind: "http-url", base_url: resolvedEp.base_url },
    };
  }
  return baseTarget;
}

function deploymentHasQueueConsumers(deployment: Deployment | null): boolean {
  return deployment
    ? (parseDeploymentBackendConfig(deployment).queue_consumers?.length ?? 0) >
      0
    : false;
}

/**
 * Promote a canary deployment to 100% active routing.
 *
 * Validates that the target deployment is currently in `canary` state, then
 * shifts routing fully to it, archives previous active/canary deployments,
 * and updates service pointers so the canary becomes the new active.
 */
export async function promoteCanaryDeployment(
  env: DeploymentEnv,
  input: CanaryDeploymentInput,
): Promise<PromoteCanaryResult> {
  const canary = await getDeploymentById(env.DB, input.deploymentId);
  if (!canary || canary.service_id !== input.serviceId) {
    throw new NotFoundError("Deployment");
  }
  if (canary.routing_status !== "canary") {
    throw new ConflictError("Deployment is not in canary state");
  }
  if (!canary.artifact_ref) {
    throw new BadRequestError(
      "Canary deployment has no artifact_ref; cannot promote via routing pointer",
    );
  }

  const serviceRouteRecord = await fetchServiceWithDomains(
    env,
    input.serviceId,
  );
  if (!serviceRouteRecord) {
    throw new NotFoundError("Service");
  }

  const hostnameList = collectHostnames(serviceRouteRecord);
  const routingRollbackSnapshot = hostnameList.length > 0
    ? await snapshotRouting(env, hostnameList)
    : [];

  const deploymentTarget = resolveDeploymentTargetForRouting(canary);

  const routingCtx = {
    deploymentId: canary.id,
    deploymentVersion: canary.version,
    deployArtifactRef: canary.artifact_ref,
    deploymentTarget,
    serviceRouteRecord,
    desiredRoutingStatus: "active",
    desiredRoutingWeight: 100,
    activeDeployment: null,
  };

  const { target, auditDetails } = buildRoutingTarget(routingCtx, hostnameList);

  const previousActive = serviceRouteRecord.activeDeploymentId
    ? await getDeploymentById(env.DB, serviceRouteRecord.activeDeploymentId)
    : null;
  const queueSyncNeeded = deploymentHasQueueConsumers(canary) ||
    deploymentHasQueueConsumers(previousActive);
  const queueBackend = queueSyncNeeded
    ? createDeploymentBackend(canary, {
      cloudflareEnv: env,
      orchestratorUrl: env.OCI_ORCHESTRATOR_URL,
      orchestratorToken: env.OCI_ORCHESTRATOR_TOKEN,
      backendRegistry: createDeploymentBackendRegistry(
        resolveDeploymentBackendConfigsFromEnv(env),
      ),
    })
    : null;
  if (queueSyncNeeded && !queueBackend?.syncQueueConsumers) {
    throw new ConflictError(
      "Cannot promote canary over queue consumer deployment on a backend without queue consumer sync",
    );
  }

  let queueConsumersSynced = false;
  const nowIso = new Date().toISOString();
  try {
    if (queueSyncNeeded && queueBackend?.syncQueueConsumers) {
      const encryptionKey = env.ENCRYPTION_KEY ?? "";
      const canaryRuntimeConfig = parseRuntimeConfig(
        canary.runtime_config_snapshot_json,
      );
      const canaryBindings = canary.bindings_snapshot_encrypted
        ? await decryptBindings(encryptionKey, canary)
        : [];
      const previousBindings = previousActive?.bindings_snapshot_encrypted
        ? await decryptBindings(encryptionKey, previousActive)
        : [];
      const previousRuntimeConfig = previousActive
        ? parseRuntimeConfig(previousActive.runtime_config_snapshot_json)
        : null;
      await queueBackend.syncQueueConsumers({
        deployment: canary,
        artifactRef: canary.artifact_ref,
        runtime: {
          profile: "workers",
          bindings: canaryBindings,
          config: {
            compatibility_date: canaryRuntimeConfig.compatibility_date ||
              "2024-01-01",
            compatibility_flags: canaryRuntimeConfig.compatibility_flags,
            limits: canaryRuntimeConfig.limits,
          },
        },
        previousDeployment: previousActive,
        previousArtifactRef: previousActive?.artifact_ref ?? null,
        previousRuntime: previousRuntimeConfig
          ? {
            profile: "workers",
            bindings: previousBindings,
            config: {
              compatibility_date: previousRuntimeConfig.compatibility_date ||
                "2024-01-01",
              compatibility_flags: previousRuntimeConfig.compatibility_flags,
              limits: previousRuntimeConfig.limits,
            },
          }
          : null,
      });
      queueConsumersSynced = true;
    }

    if (hostnameList.length > 0) {
      await runRoutingMutationWithRollback(
        env,
        routingRollbackSnapshot,
        () => applyRoutingToHostnames(env, hostnameList, target),
        {
          module: "routing",
          message:
            "Failed to restore routing snapshot during canary promote (non-critical)",
        },
      );
    }

    await applyRoutingDbUpdates(env, routingCtx, nowIso);
  } catch (dbErr) {
    if (
      queueConsumersSynced &&
      queueBackend?.syncQueueConsumers &&
      previousActive?.artifact_ref
    ) {
      const encryptionKey = env.ENCRYPTION_KEY ?? "";
      const previousBindings = previousActive.bindings_snapshot_encrypted
        ? await decryptBindings(encryptionKey, previousActive)
        : [];
      const canaryBindings = canary.bindings_snapshot_encrypted
        ? await decryptBindings(encryptionKey, canary)
        : [];
      const previousRuntimeConfig = parseRuntimeConfig(
        previousActive.runtime_config_snapshot_json,
      );
      const canaryRuntimeConfig = parseRuntimeConfig(
        canary.runtime_config_snapshot_json,
      );
      await queueBackend.syncQueueConsumers({
        deployment: previousActive,
        artifactRef: previousActive.artifact_ref,
        runtime: {
          profile: "workers",
          bindings: previousBindings,
          config: {
            compatibility_date: previousRuntimeConfig.compatibility_date ||
              "2024-01-01",
            compatibility_flags: previousRuntimeConfig.compatibility_flags,
            limits: previousRuntimeConfig.limits,
          },
        },
        previousDeployment: canary,
        previousArtifactRef: canary.artifact_ref,
        previousRuntime: {
          profile: "workers",
          bindings: canaryBindings,
          config: {
            compatibility_date: canaryRuntimeConfig.compatibility_date ||
              "2024-01-01",
            compatibility_flags: canaryRuntimeConfig.compatibility_flags,
            limits: canaryRuntimeConfig.limits,
          },
        },
      }).catch((queueRollbackError: unknown) => {
        logWarn(
          "Failed to restore queue consumers during canary promote failure",
          {
            module: "routing",
            error: queueRollbackError instanceof Error
              ? queueRollbackError.message
              : String(queueRollbackError),
          },
        );
      });
    }
    if (routingRollbackSnapshot.length > 0) {
      await restoreRoutingSnapshot(env, routingRollbackSnapshot).catch((e) => {
        logWarn(
          "Failed to restore routing snapshot during canary promote (non-critical)",
          {
            module: "routing",
            error: e instanceof Error ? e.message : String(e),
          },
        );
      });
    }
    throw dbErr;
  }

  await logDeploymentEvent(
    env.DB,
    canary.id,
    "canary_promoted",
    null,
    "Promoted canary deployment to 100% active routing",
    {
      actorAccountId: input.userId,
      details: {
        ...auditDetails,
        previous_active_deployment_id: serviceRouteRecord.activeDeploymentId,
      },
    },
  );

  return { deploymentId: canary.id };
}

/**
 * Abort a canary deployment, restoring the previously active deployment to
 * 100% routing weight and marking the canary as rolled back.
 */
export async function abortCanaryDeployment(
  env: DeploymentEnv,
  input: CanaryDeploymentInput,
): Promise<AbortCanaryResult> {
  const canary = await getDeploymentById(env.DB, input.deploymentId);
  if (!canary || canary.service_id !== input.serviceId) {
    throw new NotFoundError("Deployment");
  }
  if (canary.routing_status !== "canary") {
    throw new ConflictError("Deployment is not in canary state");
  }

  const serviceRouteRecord = await fetchServiceWithDomains(
    env,
    input.serviceId,
  );
  if (!serviceRouteRecord) {
    throw new NotFoundError("Service");
  }

  const previousActiveId = serviceRouteRecord.activeDeploymentId;
  if (!previousActiveId) {
    throw new ConflictError("No previously active deployment to roll back to");
  }

  const previousActive = await getDeploymentById(env.DB, previousActiveId);
  if (!previousActive || previousActive.service_id !== input.serviceId) {
    throw new ConflictError(
      "Previously active deployment is missing or invalid",
    );
  }
  if (!previousActive.artifact_ref) {
    throw new BadRequestError(
      "Previously active deployment has no artifact_ref; cannot restore routing",
    );
  }

  const hostnameList = collectHostnames(serviceRouteRecord);
  const routingRollbackSnapshot = hostnameList.length > 0
    ? await snapshotRouting(env, hostnameList)
    : [];

  const restoreTarget = resolveDeploymentTargetForRouting(previousActive);

  const routingCtx = {
    deploymentId: previousActive.id,
    deploymentVersion: previousActive.version,
    deployArtifactRef: previousActive.artifact_ref,
    deploymentTarget: restoreTarget,
    serviceRouteRecord,
    desiredRoutingStatus: "active",
    desiredRoutingWeight: 100,
    activeDeployment: null,
  };

  const { target, auditDetails } = buildRoutingTarget(routingCtx, hostnameList);

  if (hostnameList.length > 0) {
    await runRoutingMutationWithRollback(
      env,
      routingRollbackSnapshot,
      () => applyRoutingToHostnames(env, hostnameList, target),
      {
        module: "routing",
        message:
          "Failed to restore routing snapshot during canary abort (non-critical)",
      },
    );
  }

  const nowIso = new Date().toISOString();
  const db = getDb(env.DB);

  try {
    // Restore the previously active deployment to active/100%.
    await db.update(deployments)
      .set({
        routingStatus: "active",
        routingWeight: 100,
        updatedAt: nowIso,
      })
      .where(eq(deployments.id, previousActive.id))
      .run();

    // Archive any other active/rollback/canary entries for this service besides
    // the restored active and the canary that we are aborting (which we mark
    // as rolled_back below).
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
          ne(deployments.id, previousActive.id),
          ne(deployments.id, canary.id),
        ),
      )
      .run();

    // Mark the canary as rolled back. routing_status='rollback' makes the
    // operational state visible; status='rolled_back' tracks the lifecycle.
    await db.update(deployments)
      .set({
        routingStatus: "rollback",
        routingWeight: 0,
        status: "rolled_back",
        rolledBackAt: nowIso,
        rolledBackBy: input.userId,
        updatedAt: nowIso,
      })
      .where(eq(deployments.id, canary.id))
      .run();

    // services.activeDeploymentId / fallbackDeploymentId remain unchanged
    // across the abort: canary routing never moved the active pointer, so the
    // restored deployment is already the recorded active. Only refresh
    // status / updatedAt so the lifecycle reflects the abort.
    await db.update(services)
      .set({
        status: "deployed",
        updatedAt: nowIso,
      })
      .where(eq(services.id, serviceRouteRecord.id))
      .run();
  } catch (dbErr) {
    if (routingRollbackSnapshot.length > 0) {
      await restoreRoutingSnapshot(env, routingRollbackSnapshot).catch((e) => {
        logWarn(
          "Failed to restore routing snapshot during canary abort (non-critical)",
          {
            module: "routing",
            error: e instanceof Error ? e.message : String(e),
          },
        );
      });
    }
    throw dbErr;
  }

  await logDeploymentEvent(
    env.DB,
    canary.id,
    "canary_aborted",
    null,
    "Aborted canary deployment and restored previous active routing",
    {
      actorAccountId: input.userId,
      details: {
        ...auditDetails,
        rolled_back_to_deployment_id: previousActive.id,
        rolled_back_to_version: previousActive.version,
      },
    },
  );

  return { deploymentId: canary.id, rolledBackTo: previousActive.id };
}
