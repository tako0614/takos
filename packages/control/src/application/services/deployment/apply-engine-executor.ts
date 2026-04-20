import type { AppCompute } from "../source/app-manifest-types.ts";

// Legacy alias names used by this module to label compute entries.
type AppWorker = AppCompute & { kind: "worker" };
type AppService = AppCompute & { kind: "service" };
type AppContainer = AppCompute & { kind: "attached-container" };
import type { Env } from "../../../shared/types/env.ts";
import {
  type ApplyArtifactInput,
  type ApplyEngineArtifactDeps,
  assertApplyImageArtifact,
  resolveArtifactForApply,
} from "./apply-engine-artifacts.ts";
import type { DiffEntry, GroupState } from "./diff.ts";
import type { GroupDesiredState } from "./group-state.ts";
import type {
  ManagedServiceComponentKind,
  ManagedServiceRecord,
} from "../entities/group-managed-services.ts";
import type { CreateDeploymentInput, DeploymentBackendName } from "./models.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/logger.ts";
import {
  injectAttachedContainerBindings,
  resolveAttachedContainerBindingPlans,
} from "./attached-container-bindings.ts";
import { ServiceDesiredStateService } from "../platform/worker-desired-state.ts";

type ApplyGroupRecord = {
  id: string;
  spaceId: string;
  name: string;
  backend: string | null;
  env: string | null;
};

type ApplyExecutionOptions = {
  envName?: string;
  artifacts?: Record<string, unknown>;
  targetWorkloadNames?: string[];
};

export type ApplyEntryExecutionResult = {
  name: string;
  category: DiffEntry["category"];
  action: DiffEntry["action"];
  status: "success" | "failed";
  error?: string;
};

export type ApplyEngineExecutorDeps = ApplyEngineArtifactDeps & {
  listResources: typeof import("../entities/resource-ops.ts").listResources;
  createResource: typeof import("../entities/resource-ops.ts").createResource;
  deleteResource: typeof import("../entities/resource-ops.ts").deleteResource;
  updateManagedResource:
    typeof import("../entities/resource-ops.ts").updateManagedResource;
  deleteWorker: typeof import("../entities/worker-ops.ts").deleteWorker;
  deleteContainer:
    typeof import("../entities/container-ops.ts").deleteContainer;
  deleteService: typeof import("../entities/service-ops.ts").deleteService;
  upsertGroupManagedService:
    typeof import("../entities/group-managed-services.ts").upsertGroupManagedService;
  DeploymentService: typeof import("./service.ts").DeploymentService;
  syncGroupManagedDesiredState:
    typeof import("./group-managed-desired-state.ts").syncGroupManagedDesiredState;
  reconcileGroupRouting:
    typeof import("./group-routing.ts").reconcileGroupRouting;
  captureManagedWorkloadDesiredState:
    typeof import("./group-managed-desired-state.ts").captureManagedWorkloadDesiredState;
  restoreManagedWorkloadDesiredState:
    typeof import("./group-managed-desired-state.ts").restoreManagedWorkloadDesiredState;
};

type GroupStateLoader = (
  env: Env,
  groupId: string,
) => Promise<GroupState | null>;

function resolveManagedServiceShape(
  category: ManagedServiceComponentKind,
): {
  serviceType: "app" | "service";
  workloadKind: "worker-bundle" | "container-image";
} {
  if (category === "worker") {
    return {
      serviceType: "app",
      workloadKind: "worker-bundle",
    };
  }
  return {
    serviceType: "service",
    workloadKind: "container-image",
  };
}

function resolveWorkloadDeploymentBackend(
  backend: string,
  category: ManagedServiceComponentKind,
  artifact: ApplyArtifactInput | null,
): DeploymentBackendName {
  if (category === "worker") {
    if (backend === "cloudflare") {
      return "workers-dispatch";
    }
    return "runtime-host";
  }
  if (artifact?.kind === "container_image" && artifact.backend) {
    return artifact.backend;
  }
  if (backend === "aws") return "ecs";
  if (backend === "gcp") return "cloud-run";
  if (backend === "k8s") return "k8s";
  return "oci";
}

function buildManagedDeploymentTarget(
  managed: ManagedServiceRecord,
  category: ManagedServiceComponentKind,
  artifact: ApplyArtifactInput | null,
  spec: AppWorker | AppContainer | AppService,
) {
  if (category === "worker") {
    // Worker readiness probe path: kernel が deploy 時に GET <path> を probe する。
    // 200 OK 以外は fail (timeout 10s, hard-coded)。default は `/`。
    // docs: docs/apps/workers.md "Worker readiness"
    const workerSpec = spec as AppWorker;
    const readinessPath = typeof workerSpec.readiness === "string" &&
        workerSpec.readiness.length > 0
      ? workerSpec.readiness
      : "/";
    return {
      route_ref: managed.row.routeRef ?? undefined,
      endpoint: managed.row.routeRef
        ? {
          kind: "service-ref" as const,
          ref: managed.row.routeRef,
        }
        : undefined,
      artifact: {
        kind: "worker-bundle" as const,
      },
      readiness: { path: readinessPath },
    };
  }

  // In the flat schema, the image ref for a service / attached container
  // lives in `compute.image`. The apply-time artifact override still wins
  // when supplied via the CLI.
  const imageRef = artifact?.kind === "container_image"
    ? artifact.imageRef
    : (typeof spec.image === "string" ? spec.image : undefined);
  const port = typeof spec.port === "number" ? spec.port : undefined;
  const healthPath = typeof spec.healthCheck?.path === "string" &&
      spec.healthCheck.path.length > 0
    ? spec.healthCheck.path
    : undefined;
  const healthInterval = typeof spec.healthCheck?.interval === "number"
    ? spec.healthCheck.interval
    : undefined;
  const healthTimeout = typeof spec.healthCheck?.timeout === "number"
    ? spec.healthCheck.timeout
    : undefined;
  const healthUnhealthyThreshold =
    typeof spec.healthCheck?.unhealthyThreshold === "number"
      ? spec.healthCheck.unhealthyThreshold
      : undefined;

  return {
    ...(managed.row.routeRef ? { route_ref: managed.row.routeRef } : {}),
    artifact: {
      kind: "container-image" as const,
      ...(imageRef ? { image_ref: imageRef } : {}),
      ...(typeof port === "number" ? { exposed_port: port } : {}),
      ...(healthPath ? { health_path: healthPath } : {}),
      ...(healthInterval != null ? { health_interval: healthInterval } : {}),
      ...(healthTimeout != null ? { health_timeout: healthTimeout } : {}),
      ...(healthUnhealthyThreshold != null
        ? { health_unhealthy_threshold: healthUnhealthyThreshold }
        : {}),
    },
  };
}

export async function syncGroupDesiredStateForWorkloads(
  deps: ApplyEngineExecutorDeps,
  getGroupState: GroupStateLoader,
  env: Env,
  groupId: string,
  desiredState: GroupDesiredState,
  spaceId: string,
  options: {
    targetWorkloadNames?: string[];
  } = {},
): Promise<Array<{ name: string; error: string }>> {
  const observedState = await getGroupState(env, groupId);
  if (!observedState) return [];
  const resourceRows = await deps.listResources(env, groupId);
  return deps.syncGroupManagedDesiredState(env, {
    spaceId,
    desiredState,
    observedState,
    resourceRows,
    targetWorkloadNames: options.targetWorkloadNames,
  });
}

async function upsertManagedWorkload(
  deps: ApplyEngineExecutorDeps,
  env: Env,
  input: {
    groupId: string;
    spaceId: string;
    envName: string;
    name: string;
    category: ManagedServiceComponentKind;
    workload: GroupDesiredState["workloads"][string];
  },
): Promise<ManagedServiceRecord> {
  const spec = input.workload.spec as AppWorker | AppContainer | AppService;
  const shape = resolveManagedServiceShape(input.category);
  const imageRef = typeof spec.image === "string" ? spec.image : undefined;
  const port = typeof spec.port === "number" ? spec.port : undefined;

  return deps.upsertGroupManagedService(env, {
    groupId: input.groupId,
    spaceId: input.spaceId,
    envName: input.envName,
    componentKind: input.category,
    manifestName: input.name,
    status: "pending",
    serviceType: shape.serviceType,
    workloadKind: shape.workloadKind,
    specFingerprint: input.workload.specFingerprint,
    desiredSpec: spec as Record<string, unknown>,
    routeNames: input.workload.routeNames,
    dependsOn: input.workload.dependsOn,
    ...(imageRef ? { imageRef } : {}),
    ...(typeof port === "number" ? { port } : {}),
  });
}

async function deployManagedWorkload(
  deps: ApplyEngineExecutorDeps,
  getGroupState: GroupStateLoader,
  env: Env,
  input: {
    group: ApplyGroupRecord;
    groupId: string;
    envName: string;
    name: string;
    category: ManagedServiceComponentKind;
    workload: GroupDesiredState["workloads"][string];
    managed: ManagedServiceRecord;
    artifact: ApplyArtifactInput | null;
  },
): Promise<void> {
  const deploymentService = new deps.DeploymentService(env);
  const backendName = resolveWorkloadDeploymentBackend(
    input.group.backend ?? "cloudflare",
    input.category,
    input.artifact,
  );
  const target = buildManagedDeploymentTarget(
    input.managed,
    input.category,
    input.artifact,
    input.workload.spec as AppWorker | AppContainer | AppService,
  );
  const workerDeploymentOverride = await buildWorkerDeploymentOverride(
    getGroupState,
    env,
    input,
  );

  const deployment = await deploymentService.createDeployment({
    serviceId: input.managed.row.id,
    spaceId: input.group.spaceId,
    userId: null,
    artifactKind: input.category === "worker"
      ? "worker-bundle"
      : "container-image",
    bundleContent: input.artifact?.kind === "worker_bundle"
      ? workerDeploymentOverride.bundleContent ?? input.artifact.bundleContent
      : undefined,
    deployMessage: input.artifact?.deployMessage ??
      `takos deploy ${input.name}`,
    backend: { name: backendName },
    target,
    ...(workerDeploymentOverride.snapshotOverride
      ? { snapshotOverride: workerDeploymentOverride.snapshotOverride }
      : {}),
  });
  const executed = await deploymentService.executeDeployment(deployment.id);

  const resolvedBackendState = safeJsonParseOrDefault<Record<string, unknown>>(
    executed.backend_state_json,
    {},
  );
  const resolvedEndpoint = resolvedBackendState.resolved_endpoint;
  const resolvedBaseUrl =
    resolvedEndpoint && typeof resolvedEndpoint === "object" &&
      !Array.isArray(resolvedEndpoint) &&
      typeof (resolvedEndpoint as Record<string, unknown>).base_url === "string"
      ? (resolvedEndpoint as Record<string, string>).base_url
      : undefined;
  const spec = input.workload.spec as AppWorker | AppContainer | AppService;
  const shape = resolveManagedServiceShape(input.category);
  const imageRef = input.artifact?.kind === "container_image"
    ? input.artifact.imageRef
    : (typeof spec.image === "string" ? spec.image : undefined);
  const port = typeof spec.port === "number" ? spec.port : undefined;

  await deps.upsertGroupManagedService(env, {
    groupId: input.groupId,
    spaceId: input.group.spaceId,
    envName: input.envName,
    componentKind: input.category,
    manifestName: input.name,
    status: "deployed",
    serviceType: shape.serviceType,
    workloadKind: shape.workloadKind,
    specFingerprint: input.workload.specFingerprint,
    desiredSpec: spec as Record<string, unknown>,
    routeNames: input.workload.routeNames,
    dependsOn: input.workload.dependsOn,
    deployedAt: executed.completed_at ?? new Date().toISOString(),
    ...(executed.bundle_hash ? { codeHash: executed.bundle_hash } : {}),
    ...(imageRef ? { imageRef } : {}),
    ...(typeof port === "number" ? { port } : {}),
    ...(resolvedBaseUrl ? { resolvedBaseUrl } : {}),
  });
}

async function buildWorkerDeploymentOverride(
  getGroupState: GroupStateLoader,
  env: Env,
  input: {
    group: ApplyGroupRecord;
    groupId: string;
    name: string;
    category: ManagedServiceComponentKind;
    workload: GroupDesiredState["workloads"][string];
    managed: ManagedServiceRecord;
    artifact: ApplyArtifactInput | null;
  },
): Promise<{
  bundleContent?: string;
  snapshotOverride?: CreateDeploymentInput["snapshotOverride"];
}> {
  if (
    input.category !== "worker" ||
    input.artifact?.kind !== "worker_bundle"
  ) {
    return {};
  }

  const workerSpec = input.workload.spec as AppWorker;
  if (
    !workerSpec.containers || Object.keys(workerSpec.containers).length === 0
  ) {
    return {};
  }

  const observedState = await getGroupState(env, input.groupId);
  const plans = resolveAttachedContainerBindingPlans(
    input.name,
    workerSpec,
    observedState,
  );
  const desiredStateService = new ServiceDesiredStateService(env);
  const snapshot = await desiredStateService.resolveDeploymentState(
    input.group.spaceId,
    input.managed.row.id,
  );
  const injected = injectAttachedContainerBindings({
    bundleContent: input.artifact.bundleContent,
    bindings: snapshot.bindings,
    plans,
  });

  return {
    bundleContent: injected.bundleContent,
    snapshotOverride: {
      envVars: snapshot.envVars,
      bindings: injected.bindings,
      runtimeConfig: snapshot.runtimeConfig,
    },
  };
}

async function executeWorkloadEntry(
  deps: ApplyEngineExecutorDeps,
  getGroupState: GroupStateLoader,
  env: Env,
  input: {
    entry: DiffEntry;
    desiredState: GroupDesiredState;
    groupId: string;
    group: ApplyGroupRecord;
    envName: string;
    category: ManagedServiceComponentKind;
    opts: ApplyExecutionOptions;
  },
): Promise<void> {
  const workload = input.desiredState.workloads[input.entry.name];
  if (
    (input.entry.action === "create" || input.entry.action === "update") &&
    workload &&
    workload.category === input.category
  ) {
    const managed = await upsertManagedWorkload(deps, env, {
      groupId: input.groupId,
      spaceId: input.group.spaceId,
      envName: input.envName,
      name: input.entry.name,
      category: input.category,
      workload,
    });
    const artifact = await resolveArtifactForApply(
      deps,
      env,
      workload,
      input.opts.artifacts?.[input.entry.name],
    );
    if (input.category === "worker") {
      if (!artifact || artifact.kind !== "worker_bundle") {
        throw new Error(
          `Worker "${input.entry.name}" requires a worker-bundle artifact during apply`,
        );
      }
    } else {
      assertApplyImageArtifact(input.entry.name, input.category, artifact);
    }

    const desiredStateSnapshot = await deps.captureManagedWorkloadDesiredState(
      env,
      {
        spaceId: input.group.spaceId,
        serviceId: managed.row.id,
        serviceName: `${input.desiredState.manifest.name}:${input.entry.name}`,
      },
    );

    const syncFailures = await syncGroupDesiredStateForWorkloads(
      deps,
      getGroupState,
      env,
      input.groupId,
      input.desiredState,
      input.group.spaceId,
      { targetWorkloadNames: [input.entry.name] },
    );
    if (syncFailures.length > 0) {
      try {
        await deps.restoreManagedWorkloadDesiredState(
          env,
          desiredStateSnapshot,
        );
      } catch (rollbackError) {
        throw new Error(
          `Failed to sync desired state for "${input.entry.name}": ${
            syncFailures.map((failure) => failure.error).join("; ")
          }; rollback failed: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        );
      }
      throw new Error(
        `Failed to sync desired state for "${input.entry.name}": ${
          syncFailures.map((failure) => failure.error).join("; ")
        }`,
      );
    }
    try {
      await deployManagedWorkload(deps, getGroupState, env, {
        group: input.group,
        groupId: input.groupId,
        envName: input.envName,
        name: input.entry.name,
        category: input.category,
        workload,
        managed,
        artifact,
      });
    } catch (error) {
      try {
        await deps.restoreManagedWorkloadDesiredState(
          env,
          desiredStateSnapshot,
        );
      } catch (rollbackError) {
        throw new Error(
          `${
            error instanceof Error ? error.message : String(error)
          }; rollback failed: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError)
          }`,
        );
      }
      throw error;
    }
  }

  if (input.entry.action !== "delete") return;
  if (input.category === "worker") {
    await deps.deleteWorker(env, input.groupId, input.entry.name);
    return;
  }
  if (input.category === "container") {
    await deps.deleteContainer(env, input.groupId, input.entry.name);
    return;
  }
  await deps.deleteService(env, input.groupId, input.entry.name);
}

export async function executeApplyEntry(
  deps: ApplyEngineExecutorDeps,
  getGroupState: GroupStateLoader,
  env: Env,
  input: {
    entry: DiffEntry;
    desiredState: GroupDesiredState;
    groupId: string;
    group: ApplyGroupRecord;
    opts: ApplyExecutionOptions;
  },
): Promise<void> {
  const envName = input.opts.envName ?? input.group.env ?? "default";

  switch (input.entry.category) {
    case "worker":
    case "container":
    case "service":
      return await executeWorkloadEntry(deps, getGroupState, env, {
        ...input,
        envName,
        category: input.entry.category,
      });

    case "route":
      return;
  }
}

export async function reconcileAppliedRoutes(
  deps: ApplyEngineExecutorDeps,
  env: Env,
  input: {
    groupId: string;
    spaceId: string;
    desiredState: GroupDesiredState;
    currentRoutes: GroupState["routes"];
    refreshedWorkloads: GroupState["workloads"];
    routeEntries: DiffEntry[];
    appliedAt: string;
  },
): Promise<ApplyEntryExecutionResult[]> {
  const routingResult = await deps.reconcileGroupRouting(
    env,
    input.desiredState,
    input.currentRoutes,
    input.refreshedWorkloads,
    input.appliedAt,
    {
      groupId: input.groupId,
      spaceId: input.spaceId,
    },
  );
  const failedRouteMap = new Map(
    routingResult.failedRoutes.map(
      (entry: { name: string; error: string }) =>
        [entry.name, entry.error] as const,
    ),
  );
  return input.routeEntries.map((entry) => {
    const error = failedRouteMap.get(entry.name);
    return {
      name: entry.name,
      category: entry.category,
      action: entry.action,
      status: error ? "failed" : "success",
      ...(typeof error === "string" ? { error } : {}),
    };
  });
}
