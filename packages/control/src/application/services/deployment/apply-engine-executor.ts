import type { AppCompute } from "../source/app-manifest-types.ts";
import type { AppStorage } from "../source/app-manifest-types.ts";

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
import type { DeploymentProviderName } from "./models.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/logger.ts";

type ApplyGroupRecord = {
  id: string;
  spaceId: string;
  name: string;
  provider: string | null;
  env: string | null;
};

type ApplyExecutionOptions = {
  envName?: string;
  artifacts?: Record<string, unknown>;
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

function resolveWorkloadDeploymentProvider(
  provider: string,
  category: ManagedServiceComponentKind,
  artifact: ApplyArtifactInput | null,
): DeploymentProviderName {
  if (category === "worker") {
    if (provider === "cloudflare") {
      return "workers-dispatch";
    }
    throw new Error(
      `Worker workload deploy provider is not configured for group provider '${provider}'.`,
    );
  }
  if (artifact?.kind === "container_image" && artifact.provider) {
    return artifact.provider;
  }
  if (provider === "aws") return "ecs";
  if (provider === "gcp") return "cloud-run";
  if (provider === "k8s") return "k8s";
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

  return {
    ...(managed.row.routeRef ? { route_ref: managed.row.routeRef } : {}),
    artifact: {
      kind: "container-image" as const,
      ...(imageRef ? { image_ref: imageRef } : {}),
      ...(typeof port === "number" ? { exposed_port: port } : {}),
    },
  };
}

async function syncGroupDesiredStateForWorkloads(
  deps: ApplyEngineExecutorDeps,
  getGroupState: GroupStateLoader,
  env: Env,
  groupId: string,
  desiredState: GroupDesiredState,
  spaceId: string,
): Promise<Array<{ name: string; error: string }>> {
  const observedState = await getGroupState(env, groupId);
  if (!observedState) return [];
  const resourceRows = await deps.listResources(env, groupId);
  return deps.syncGroupManagedDesiredState(env, {
    spaceId,
    desiredState,
    observedState,
    resourceRows,
  });
}

function getSyncFailure(
  failures: Array<{ name: string; error: string }>,
  workloadName: string,
): string | null {
  const failure = failures.find((entry) => entry.name === workloadName);
  return failure?.error ?? null;
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
  const providerName = resolveWorkloadDeploymentProvider(
    input.group.provider ?? "cloudflare",
    input.category,
    input.artifact,
  );
  const target = buildManagedDeploymentTarget(
    input.managed,
    input.category,
    input.artifact,
    input.workload.spec as AppWorker | AppContainer | AppService,
  );

  const deployment = await deploymentService.createDeployment({
    serviceId: input.managed.row.id,
    spaceId: input.group.spaceId,
    userId: null,
    artifactKind: input.category === "worker"
      ? "worker-bundle"
      : "container-image",
    bundleContent: input.artifact?.kind === "worker_bundle"
      ? input.artifact.bundleContent
      : undefined,
    deployMessage: input.artifact?.deployMessage ?? `takos apply ${input.name}`,
    provider: { name: providerName },
    target,
  });
  const executed = await deploymentService.executeDeployment(deployment.id);

  const resolvedProviderState = safeJsonParseOrDefault<Record<string, unknown>>(
    executed.provider_state_json,
    {},
  );
  const resolvedEndpoint = resolvedProviderState.resolved_endpoint;
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
    const syncFailures = await syncGroupDesiredStateForWorkloads(
      deps,
      getGroupState,
      env,
      input.groupId,
      input.desiredState,
      input.group.spaceId,
    );
    const syncFailure = getSyncFailure(syncFailures, input.entry.name);
    if (syncFailure) {
      throw new Error(
        `Failed to sync desired state for "${input.entry.name}": ${syncFailure}`,
      );
    }
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
    await deployManagedWorkload(deps, env, {
      group: input.group,
      groupId: input.groupId,
      envName: input.envName,
      name: input.entry.name,
      category: input.category,
      workload,
      managed,
      artifact,
    });
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
    case "resource": {
      const resource = input.desiredState.resources[input.entry.name];
      if (input.entry.action === "create") {
        if (!resource) {
          throw new Error(
            `Resource "${input.entry.name}" not found in desired state`,
          );
        }
        await deps.createResource(env, input.groupId, input.entry.name, {
          type: resource.type,
          binding: resource.binding,
          groupName: input.group.name,
          envName,
          spaceId: input.group.spaceId,
          providerName: input.desiredState.provider,
          specFingerprint: resource.specFingerprint,
          spec: resource.spec as AppStorage,
        });
      }
      if (input.entry.action === "update") {
        if (!resource) {
          throw new Error(
            `Resource "${input.entry.name}" not found in desired state`,
          );
        }
        await deps.updateManagedResource(env, input.groupId, input.entry.name, {
          binding: resource.binding,
          specFingerprint: resource.specFingerprint,
          spec: resource.spec as AppStorage,
        });
      }
      if (input.entry.action === "delete") {
        await deps.deleteResource(env, input.groupId, input.entry.name);
      }
      return;
    }

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
