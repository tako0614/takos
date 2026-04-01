/**
 * Canonical group reconciler for the control plane.
 *
 * `.takos/app.yml` is compiled into `GroupDesiredState`, diffed against
 * canonical resources/services state, then reconciled through provider ops.
 */

import { eq } from "drizzle-orm";
import { getDb } from "../../../infra/db/client.ts";
import { groups } from "../../../infra/db/schema-groups.ts";
import type {
  AppContainer,
  AppManifest,
  AppService,
  AppWorker,
} from "../source/app-manifest-types.ts";
import {
  compileGroupDesiredState,
  type GroupDesiredState,
  materializeRoutes,
} from "./group-state.ts";
import {
  computeDiff,
  type DiffEntry,
  type DiffResult,
  type GroupState,
} from "./diff.ts";
import {
  assertTranslationSupported,
  buildTranslationReport,
  type TranslationReport,
} from "./translation-report.ts";
import {
  createResource,
  deleteResource,
  listResources,
  updateManagedResource,
} from "../entities/resource-ops.ts";
import { deleteWorker } from "../entities/worker-ops.ts";
import { deleteContainer } from "../entities/container-ops.ts";
import { deleteService } from "../entities/service-ops.ts";
import {
  listGroupManagedServices,
  type ManagedServiceComponentKind,
  type ManagedServiceRecord,
  upsertGroupManagedService,
} from "../entities/group-managed-services.ts";
import { DeploymentService } from "./service.ts";
import { getDeploymentById } from "./store.ts";
import { getBundleContent } from "./artifact-io.ts";
import { syncGroupManagedDesiredState } from "./group-managed-desired-state.ts";
import { reconcileGroupRouting } from "./group-routing.ts";
import type { DeploymentProviderName } from "./models.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/logger.ts";
import type { Env } from "../../../shared/types/env.ts";
import { type AppTokenResult, AppTokenService } from "./app-token-service.ts";

export interface ApplyEntryResult {
  name: string;
  category: string;
  action: string;
  status: "success" | "failed";
  error?: string;
}

export interface ApplyResult {
  groupId: string;
  applied: ApplyEntryResult[];
  skipped: string[];
  diff: DiffResult;
  translationReport: TranslationReport;
  appToken?: AppTokenResult;
}

export interface SafeApplyResult extends Omit<ApplyResult, "appToken"> {
  appToken?: {
    issued: true;
    scopes: string[];
    expiresIn: number;
  };
}

export interface AppTokenPlan {
  willIssue: true;
  scopes: string[];
}

export interface PlanResult {
  diff: DiffResult;
  translationReport: TranslationReport;
  appTokenPlan?: AppTokenPlan;
}

export interface ApplyManifestOpts {
  target?: string[];
  autoApprove?: boolean;
  groupName?: string;
  envName?: string;
  dispatchNamespace?: string;
  rollbackOnFailure?: boolean;
  artifacts?: Record<string, unknown>;
}

type GroupRow = {
  id: string;
  spaceId: string;
  name: string;
  provider: string | null;
  env: string | null;
  appVersion: string | null;
  desiredSpecJson: string | null;
  providerStateJson: string | null;
  reconcileStatus: string;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const applyEngineDeps = {
  getDb,
  listResources,
  createResource,
  deleteResource,
  updateManagedResource,
  deleteWorker,
  deleteContainer,
  deleteService,
  listGroupManagedServices,
  upsertGroupManagedService,
  DeploymentService,
  getDeploymentById,
  getBundleContent,
  syncGroupManagedDesiredState,
  reconcileGroupRouting,
  buildTranslationReport,
  assertTranslationSupported,
  compileGroupDesiredState,
};

type ApplyWorkerArtifact = {
  kind: "worker_bundle";
  bundleContent: string;
  deployMessage?: string;
};

type ApplyContainerArtifact = {
  kind: "container_image";
  imageRef: string;
  provider?: "oci" | "ecs" | "cloud-run" | "k8s";
  deployMessage?: string;
};

type ApplyArtifactInput = ApplyWorkerArtifact | ApplyContainerArtifact;

type WorkerDirectArtifact = {
  kind: "bundle";
  deploymentId?: string;
  artifactRef?: string;
};

type ImageDirectArtifact = {
  kind: "image";
  imageRef: string;
  provider?: "oci" | "ecs" | "cloud-run" | "k8s";
};

async function getGroupRecord(
  env: Env,
  groupId: string,
): Promise<GroupRow | null> {
  const db = applyEngineDeps.getDb(env.DB);
  return db.select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .get() as Promise<GroupRow | null>;
}

function loadDesiredManifest(group: GroupRow): AppManifest | null {
  return safeJsonParseOrDefault<AppManifest | null>(
    group.desiredSpecJson,
    null,
  );
}

function loadDesiredState(group: GroupRow): GroupDesiredState | null {
  const manifest = loadDesiredManifest(group);
  if (!manifest) return null;
  try {
    return compileGroupDesiredState(manifest, {
      groupName: group.name,
      provider: group.provider ?? "cloudflare",
      envName: group.env ?? "default",
    });
  } catch {
    return null;
  }
}

export async function getGroupState(
  env: Env,
  groupId: string,
): Promise<GroupState | null> {
  const group = await getGroupRecord(env, groupId);
  if (!group) return null;

  const resourceRows = await applyEngineDeps.listResources(env, groupId);
  const serviceRows = await applyEngineDeps.listGroupManagedServices(env, groupId);
  const desiredState = loadDesiredState(group);

  const resources = Object.fromEntries(
    resourceRows.map((row) => [
      row.name,
      {
        name: row.name,
        type: row.config.type,
        resourceId: row.providerResourceId ?? row.config.providerResourceId ??
          "",
        binding: row.config.binding,
        status: "active",
        ...((row.providerResourceName ?? row.config.providerResourceName)
          ? {
            providerResourceName: row.providerResourceName ??
              row.config.providerResourceName,
          }
          : {}),
        ...(row.config.specFingerprint
          ? { specFingerprint: row.config.specFingerprint }
          : {}),
        updatedAt: row.updatedAt,
      },
    ]),
  );

  const workloads = Object.fromEntries(
    serviceRows
      .filter((record) =>
        record.config.componentKind && record.config.manifestName
      )
      .map((record) => [
        record.config.manifestName as string,
        {
          serviceId: record.row.id,
          name: record.config.manifestName as string,
          category: record.config.componentKind as
            | "worker"
            | "container"
            | "service",
          status: record.row.status,
          ...(record.row.hostname ? { hostname: record.row.hostname } : {}),
          ...(record.row.routeRef ? { routeRef: record.row.routeRef } : {}),
          ...(record.row.workloadKind
            ? { workloadKind: record.row.workloadKind }
            : {}),
          ...(record.config.specFingerprint
            ? { specFingerprint: record.config.specFingerprint }
            : {}),
          ...(record.config.deployedAt
            ? { deployedAt: record.config.deployedAt }
            : {}),
          ...(record.config.codeHash
            ? { codeHash: record.config.codeHash }
            : {}),
          ...(record.config.imageHash
            ? { imageHash: record.config.imageHash }
            : {}),
          ...(record.config.imageRef
            ? { imageRef: record.config.imageRef }
            : {}),
          ...(typeof record.config.port === "number"
            ? { port: record.config.port }
            : {}),
          ...(record.config.ipv4 ? { ipv4: record.config.ipv4 } : {}),
          ...(record.config.dispatchNamespace
            ? { dispatchNamespace: record.config.dispatchNamespace }
            : {}),
          ...(record.config.resolvedBaseUrl
            ? { resolvedBaseUrl: record.config.resolvedBaseUrl }
            : {}),
          updatedAt: record.row.updatedAt,
        },
      ]),
  );

  const routes = desiredState
    ? materializeRoutes(desiredState.routes, workloads, group.updatedAt)
    : {};

  if (
    Object.keys(resources).length === 0 &&
    Object.keys(workloads).length === 0 && Object.keys(routes).length === 0
  ) {
    return null;
  }

  return {
    groupId,
    groupName: group.name,
    provider: group.provider ?? "cloudflare",
    env: group.env ?? "default",
    version: group.appVersion,
    updatedAt: group.updatedAt,
    resources,
    workloads,
    routes,
  };
}

function parseApplyArtifact(input: unknown): ApplyArtifactInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const parsed = input as Record<string, unknown>;
  if (
    (parsed.kind === "worker_bundle" || parsed.kind === "worker-bundle") &&
    typeof parsed.bundleContent === "string"
  ) {
    return {
      kind: "worker_bundle",
      bundleContent: parsed.bundleContent,
      ...(typeof parsed.deployMessage === "string"
        ? { deployMessage: parsed.deployMessage }
        : {}),
    };
  }
  if (
    (parsed.kind === "container_image" ||
      parsed.kind === "container-image") &&
    typeof parsed.imageRef === "string" &&
    parsed.imageRef.trim().length > 0
  ) {
    return {
      kind: "container_image",
      imageRef: parsed.imageRef,
      ...(parsed.provider === "oci" || parsed.provider === "ecs" ||
          parsed.provider === "cloud-run" || parsed.provider === "k8s"
        ? { provider: parsed.provider }
        : {}),
      ...(typeof parsed.deployMessage === "string"
        ? { deployMessage: parsed.deployMessage }
        : {}),
    };
  }
  return null;
}

function resolveContainerImageArtifact(
  workloadName: string,
  _workloadCategory: "container" | "service",
  spec: AppContainer | AppService,
): ApplyContainerArtifact | null {
  const directImageArtifact =
    ("artifact" in spec ? spec.artifact : undefined) as
      | ImageDirectArtifact
      | undefined;
  if (directImageArtifact?.kind === "image") {
    return {
      kind: "container_image",
      imageRef: directImageArtifact.imageRef,
      ...(directImageArtifact.provider
        ? { provider: directImageArtifact.provider }
        : {}),
      deployMessage: `takos apply ${workloadName}`,
    };
  }

  if (
    "imageRef" in spec && typeof spec.imageRef === "string" &&
    spec.imageRef.trim().length > 0
  ) {
    return {
      kind: "container_image",
      imageRef: spec.imageRef,
      ...("provider" in spec &&
          (spec.provider === "oci" || spec.provider === "ecs" ||
            spec.provider === "cloud-run" || spec.provider === "k8s")
        ? { provider: spec.provider }
        : {}),
      deployMessage: `takos apply ${workloadName}`,
    };
  }

  return null;
}

function assertApplyImageArtifact(
  workloadName: string,
  workloadCategory: "container" | "service",
  artifact: ApplyArtifactInput | null,
): asserts artifact is ApplyContainerArtifact {
  if (
    artifact?.kind === "container_image" && artifact.imageRef.trim().length > 0
  ) {
    return;
  }
  throw new Error(
    `${
      workloadCategory === "container" ? "Container" : "Service"
    } "${workloadName}" requires imageRef or artifact.kind=image for online apply`,
  );
}

async function resolveArtifactFromDesiredManifest(
  env: Env,
  workload: GroupDesiredState["workloads"][string],
): Promise<ApplyArtifactInput | null> {
  const spec = workload.spec as AppWorker | AppContainer | AppService;
  if (workload.category === "worker") {
    const directArtifact = ("artifact" in spec ? spec.artifact : undefined) as
      | WorkerDirectArtifact
      | undefined;
    if (directArtifact?.kind === "bundle" && directArtifact.deploymentId) {
      const deployment = await applyEngineDeps.getDeploymentById(
        env.DB,
        directArtifact.deploymentId,
      );
      if (!deployment) {
        throw new Error(
          `Referenced deployment "${directArtifact.deploymentId}" for worker "${workload.name}" was not found`,
        );
      }
      return {
        kind: "worker_bundle",
        bundleContent: await applyEngineDeps.getBundleContent(env, deployment),
        deployMessage: `takos apply ${workload.name}`,
      };
    }
    return null;
  }

  return resolveContainerImageArtifact(
    workload.name,
    workload.category,
    spec as AppContainer | AppService,
  );
}

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
    return provider === "cloudflare" ? "workers-dispatch" : "runtime-host";
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
    };
  }

  const directImageArtifact = "artifact" in spec &&
      spec.artifact &&
      typeof spec.artifact === "object" &&
      "kind" in spec.artifact &&
      spec.artifact.kind === "image"
    ? spec.artifact
    : undefined;
  const imageRef = artifact?.kind === "container_image"
    ? artifact.imageRef
    : (directImageArtifact && typeof directImageArtifact.imageRef === "string"
      ? directImageArtifact.imageRef
      : ("imageRef" in spec && typeof spec.imageRef === "string"
        ? spec.imageRef
        : undefined));
  const port = "port" in spec && typeof spec.port === "number"
    ? spec.port
    : undefined;

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
  env: Env,
  groupId: string,
  desiredState: GroupDesiredState,
  spaceId: string,
): Promise<Array<{ name: string; error: string }>> {
  const observedState = await getGroupState(env, groupId);
  if (!observedState) return [];
  const resourceRows = await applyEngineDeps.listResources(env, groupId);
  return applyEngineDeps.syncGroupManagedDesiredState(env, {
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
  const directImageArtifact = "artifact" in spec &&
      spec.artifact &&
      typeof spec.artifact === "object" &&
      "kind" in spec.artifact &&
      spec.artifact.kind === "image"
    ? spec.artifact
    : undefined;
  const imageRef =
    directImageArtifact && typeof directImageArtifact.imageRef === "string"
      ? directImageArtifact.imageRef
      : ("imageRef" in spec && typeof spec.imageRef === "string"
        ? spec.imageRef
        : undefined);
  const port = "port" in spec && typeof spec.port === "number"
    ? spec.port
    : undefined;

  return applyEngineDeps.upsertGroupManagedService(env, {
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
  env: Env,
  input: {
    group: GroupRow;
    groupId: string;
    envName: string;
    name: string;
    category: ManagedServiceComponentKind;
    workload: GroupDesiredState["workloads"][string];
    managed: ManagedServiceRecord;
    artifact: ApplyArtifactInput | null;
  },
): Promise<void> {
  const deploymentService = new applyEngineDeps.DeploymentService(env);
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
  const directImageArtifact = "artifact" in spec &&
      spec.artifact &&
      typeof spec.artifact === "object" &&
      "kind" in spec.artifact &&
      spec.artifact.kind === "image"
    ? spec.artifact
    : undefined;
  const imageRef = input.artifact?.kind === "container_image"
    ? input.artifact.imageRef
    : (directImageArtifact && typeof directImageArtifact.imageRef === "string"
      ? directImageArtifact.imageRef
      : ("imageRef" in spec && typeof spec.imageRef === "string"
        ? spec.imageRef
        : undefined));
  const port = "port" in spec && typeof spec.port === "number"
    ? spec.port
    : undefined;

  await applyEngineDeps.upsertGroupManagedService(env, {
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

const CATEGORY_PRIORITY: Record<string, number> = {
  resource: 0,
  container: 1,
  worker: 2,
  service: 3,
  route: 4,
};

function topologicalSort(
  entries: DiffEntry[],
  desiredState: GroupDesiredState,
): DiffEntry[] {
  const dependsOnMap = new Map<string, string[]>();
  for (const [name, workload] of Object.entries(desiredState.workloads)) {
    if (workload.dependsOn.length > 0) {
      dependsOnMap.set(name, workload.dependsOn);
    }
  }

  const deletes = entries.filter((entry) => entry.action === "delete");
  const nonDeletes = entries.filter((entry) => entry.action !== "delete");
  const sortedNonDeletes = topoSortDFS(nonDeletes, dependsOnMap);
  const sortedDeletes = topoSortDFS(deletes, dependsOnMap).reverse();
  return [...sortedNonDeletes, ...sortedDeletes];
}

function topoSortDFS(
  entries: DiffEntry[],
  dependsOnMap: Map<string, string[]>,
): DiffEntry[] {
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  const visited = new Set<string>();
  const result: DiffEntry[] = [];

  const sorted = [...entries].sort(
    (a, b) =>
      (CATEGORY_PRIORITY[a.category] ?? 99) -
      (CATEGORY_PRIORITY[b.category] ?? 99),
  );

  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);

    const deps = dependsOnMap.get(name) ?? [];
    for (const dep of deps) {
      if (entryByName.has(dep)) {
        visit(dep);
      }
    }

    const entry = entryByName.get(name);
    if (entry) {
      result.push(entry);
    }
  }

  for (const entry of sorted) {
    visit(entry.name);
  }

  return result;
}

async function executeEntry(
  entry: DiffEntry,
  desiredState: GroupDesiredState,
  env: Env,
  groupId: string,
  group: GroupRow,
  opts: ApplyManifestOpts,
): Promise<void> {
  const envName = opts.envName ?? group.env ?? "default";
  const spaceId = group.spaceId;

  switch (entry.category) {
    case "resource": {
      const resource = desiredState.resources[entry.name];
      if (entry.action === "create") {
        if (!resource) {
          throw new Error(
            `Resource "${entry.name}" not found in desired state`,
          );
        }
        await applyEngineDeps.createResource(env, groupId, entry.name, {
          type: resource.type,
          binding: resource.binding,
          groupName: group.name,
          envName,
          spaceId,
          providerName: desiredState.provider,
          specFingerprint: resource.specFingerprint,
          spec: resource.spec,
        });
      }
      if (entry.action === "update") {
        if (!resource) {
          throw new Error(
            `Resource "${entry.name}" not found in desired state`,
          );
        }
        await applyEngineDeps.updateManagedResource(env, groupId, entry.name, {
          binding: resource.binding,
          specFingerprint: resource.specFingerprint,
          spec: resource.spec,
        });
      }
      if (entry.action === "delete") {
        await applyEngineDeps.deleteResource(env, groupId, entry.name);
      }
      break;
    }

    case "worker": {
      const workload = desiredState.workloads[entry.name];
      if (
        (entry.action === "create" || entry.action === "update") && workload
      ) {
        const managed = await upsertManagedWorkload(env, {
          groupId,
          spaceId,
          envName,
          name: entry.name,
          category: "worker",
          workload,
        });
        const syncFailures = await syncGroupDesiredStateForWorkloads(
          env,
          groupId,
          desiredState,
          spaceId,
        );
        const syncFailure = getSyncFailure(syncFailures, entry.name);
        if (syncFailure) {
          throw new Error(
            `Failed to sync desired state for "${entry.name}": ${syncFailure}`,
          );
        }
        const artifact = parseApplyArtifact(opts.artifacts?.[entry.name]) ??
          await resolveArtifactFromDesiredManifest(env, workload);
        if (!artifact || artifact.kind !== "worker_bundle") {
          throw new Error(
            `Worker "${entry.name}" requires a worker-bundle artifact during apply`,
          );
        }
        await deployManagedWorkload(env, {
          group,
          groupId,
          envName,
          name: entry.name,
          category: "worker",
          workload,
          managed,
          artifact,
        });
      }
      if (entry.action === "delete") {
        await applyEngineDeps.deleteWorker(env, groupId, entry.name);
      }
      break;
    }

    case "container": {
      const workload = desiredState.workloads[entry.name];
      if (
        (entry.action === "create" || entry.action === "update") && workload &&
        workload.category === "container"
      ) {
        const managed = await upsertManagedWorkload(env, {
          groupId,
          spaceId,
          envName,
          name: entry.name,
          category: "container",
          workload,
        });
        const syncFailures = await syncGroupDesiredStateForWorkloads(
          env,
          groupId,
          desiredState,
          spaceId,
        );
        const syncFailure = getSyncFailure(syncFailures, entry.name);
        if (syncFailure) {
          throw new Error(
            `Failed to sync desired state for "${entry.name}": ${syncFailure}`,
          );
        }
        const artifact = parseApplyArtifact(opts.artifacts?.[entry.name]) ??
          await resolveArtifactFromDesiredManifest(env, workload);
        assertApplyImageArtifact(entry.name, "container", artifact);
        await deployManagedWorkload(env, {
          group,
          groupId,
          envName,
          name: entry.name,
          category: "container",
          workload,
          managed,
          artifact,
        });
      }
      if (entry.action === "delete") {
        await applyEngineDeps.deleteContainer(env, groupId, entry.name);
      }
      break;
    }

    case "service": {
      const workload = desiredState.workloads[entry.name];
      if (
        (entry.action === "create" || entry.action === "update") && workload &&
        workload.category === "service"
      ) {
        const managed = await upsertManagedWorkload(env, {
          groupId,
          spaceId,
          envName,
          name: entry.name,
          category: "service",
          workload,
        });
        const syncFailures = await syncGroupDesiredStateForWorkloads(
          env,
          groupId,
          desiredState,
          spaceId,
        );
        const syncFailure = getSyncFailure(syncFailures, entry.name);
        if (syncFailure) {
          throw new Error(
            `Failed to sync desired state for "${entry.name}": ${syncFailure}`,
          );
        }
        const artifact = parseApplyArtifact(opts.artifacts?.[entry.name]) ??
          await resolveArtifactFromDesiredManifest(env, workload);
        assertApplyImageArtifact(entry.name, "service", artifact);
        await deployManagedWorkload(env, {
          group,
          groupId,
          envName,
          name: entry.name,
          category: "service",
          workload,
          managed,
          artifact,
        });
      }
      if (entry.action === "delete") {
        await applyEngineDeps.deleteService(env, groupId, entry.name);
      }
      break;
    }

    case "route":
      break;
  }
}

async function saveGroupSnapshots(
  env: Env,
  groupId: string,
  desiredState: GroupDesiredState,
  status: "ready" | "degraded",
): Promise<void> {
  const db = applyEngineDeps.getDb(env.DB);
  const now = new Date().toISOString();
  const current = await getGroupRecord(env, groupId);

  await db.update(groups)
    .set({
      appVersion: desiredState.version,
      provider: desiredState.provider,
      env: desiredState.env,
      desiredSpecJson: JSON.stringify(desiredState.manifest),
      providerStateJson: current?.providerStateJson ?? "{}",
      reconcileStatus: status,
      lastAppliedAt: now,
      updatedAt: now,
    })
    .where(eq(groups.id, groupId))
    .run();
}

export async function applyManifest(
  env: Env,
  groupId: string,
  manifest?: AppManifest,
  opts: ApplyManifestOpts = {},
): Promise<ApplyResult> {
  const group = await getGroupRecord(env, groupId);
  if (!group) {
    throw new Error(`Group "${groupId}" not found`);
  }

  const effectiveManifest = manifest ?? (group ? loadDesiredManifest(group) : null);
  if (!effectiveManifest) {
    throw new Error(`Group "${groupId}" does not have a desired manifest`);
  }

  const desiredState = compileGroupDesiredState(effectiveManifest, {
    groupName: opts.groupName ?? group.name,
    provider: group.provider ?? "cloudflare",
    envName: opts.envName ?? group.env ?? "default",
  });
  const currentState = await getGroupState(env, groupId);
  const diff = computeDiff(desiredState, currentState);
  const translationContext = { ociOrchestratorUrl: env.OCI_ORCHESTRATOR_URL };
  const translationReport = buildTranslationReport(
    desiredState,
    translationContext,
  );
  assertTranslationSupported(translationReport, translationContext);

  let entries = diff.entries;
  if (opts.target && opts.target.length > 0) {
    const targetSet = new Set(opts.target);
    entries = entries.filter((entry) => targetSet.has(entry.name));
  }

  const ordered = topologicalSort(entries, desiredState);

  const result: ApplyResult = {
    groupId,
    applied: [],
    skipped: [],
    diff,
    translationReport,
  };
  const routeEntries = ordered.filter((entry) =>
    entry.category === "route" && entry.action !== "unchanged"
  );

  for (const entry of ordered) {
    if (entry.action === "unchanged") {
      result.skipped.push(entry.name);
      continue;
    }
    if (entry.category === "route") {
      continue;
    }

    try {
      await executeEntry(entry, desiredState, env, groupId, group, opts);
      result.applied.push({
        name: entry.name,
        category: entry.category,
        action: entry.action,
        status: "success",
      });
    } catch (error) {
      result.applied.push({
        name: entry.name,
        category: entry.category,
        action: entry.action,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });

      if (opts.rollbackOnFailure) {
        break;
      }
    }
  }
  const refreshedState = await getGroupState(env, groupId);
  if (refreshedState) {
      const routingResult = await applyEngineDeps.reconcileGroupRouting(
      env,
      desiredState,
      currentState?.routes ?? {},
      refreshedState.workloads,
      new Date().toISOString(),
    );
    const failedRouteMap = new Map(
      routingResult.failedRoutes.map((entry) => [entry.name, entry.error]),
    );
    for (const entry of routeEntries) {
      const error = failedRouteMap.get(entry.name);
      result.applied.push({
        name: entry.name,
        category: entry.category,
        action: entry.action,
        status: error ? "failed" : "success",
        ...(error ? { error } : {}),
      });
    }
  }
  const hasFailures = result.applied.some((entry) => entry.status === "failed");
  await saveGroupSnapshots(
    env,
    groupId,
    desiredState,
    hasFailures ? "degraded" : "ready",
  );

  // Issue an app token when the manifest declares takos scopes
  const takosScopes = effectiveManifest.spec.takos?.scopes;
  if (takosScopes && takosScopes.length > 0) {
    try {
      result.appToken = await AppTokenService.issueToken(env, {
        groupId,
        spaceId: group.spaceId,
        appName: effectiveManifest.metadata.name,
        scopes: takosScopes,
      });
    } catch {
      // Token issuance failure is non-fatal — the deploy itself succeeded.
      // The caller can retry or issue tokens separately.
    }
  }

  return result;
}

export function buildSafeApplyResult(result: ApplyResult): SafeApplyResult {
  const { appToken, ...rest } = result;
  return {
    ...rest,
    ...(appToken
      ? {
        appToken: {
          issued: true,
          scopes: appToken.scopes,
          expiresIn: appToken.expiresIn,
        },
      }
      : {}),
  };
}

export async function planManifest(
  env: Env,
  groupId: string | null,
  manifest?: AppManifest,
  opts: {
    groupName?: string;
    providerName?: string;
    envName?: string;
  } = {},
): Promise<PlanResult> {
  const group = groupId ? await getGroupRecord(env, groupId) : null;
  if (groupId && !group) {
    throw new Error(`Group "${groupId}" not found`);
  }

  const effectiveManifest = manifest ?? (group ? loadDesiredManifest(group) : null);
  if (!effectiveManifest) {
    throw new Error(groupId
      ? `Group "${groupId}" does not have a desired manifest`
      : "manifest is required");
  }

  const desiredState = compileGroupDesiredState(effectiveManifest, {
    groupName: opts.groupName ?? group?.name ?? effectiveManifest.metadata.name,
    provider: opts.providerName ?? group?.provider ?? "cloudflare",
    envName: opts.envName ?? group?.env ?? "default",
  });
  const currentState = groupId ? await getGroupState(env, groupId) : null;
  const translationContext = { ociOrchestratorUrl: env.OCI_ORCHESTRATOR_URL };
  const translationReport = buildTranslationReport(
    desiredState,
    translationContext,
  );
  assertTranslationSupported(translationReport, translationContext);

  const takosScopes = effectiveManifest.spec.takos?.scopes;
  const appTokenPlan: AppTokenPlan | undefined =
    takosScopes && takosScopes.length > 0
      ? { willIssue: true, scopes: takosScopes }
      : undefined;

  return {
    diff: computeDiff(desiredState, currentState),
    translationReport,
    ...(appTokenPlan ? { appTokenPlan } : {}),
  };
}
