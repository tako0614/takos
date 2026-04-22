import type {
  AppCompute,
  AppManifest,
  AppManifestOverride,
  AppPublication,
  AppResource,
} from "../source/app-manifest-types.ts";
import { parseCompute } from "../source/app-manifest-parser/parse-compute.ts";
import { parseResources } from "../source/app-manifest-parser/parse-resources.ts";
import { validateRouteTargets } from "../source/app-manifest-parser/parse-routes.ts";

export type GroupWorkloadCategory = "worker" | "container" | "service";

export interface DesiredWorkloadState {
  name: string;
  category: GroupWorkloadCategory;
  spec: AppCompute;
  specFingerprint: string;
  dependsOn: string[];
  routeNames: string[];
}

export interface DesiredRouteState {
  name: string;
  target: string;
  path?: string;
  methods?: string[];
  ingress?: string;
  timeoutMs?: number;
}

export interface DesiredResourceState {
  name: string;
  spec: AppResource;
  specFingerprint: string;
}

export interface GroupDesiredState {
  groupName: string;
  version: string;
  backend: string;
  env: string;
  manifest: AppManifest;
  resources: Record<string, DesiredResourceState>;
  workloads: Record<string, DesiredWorkloadState>;
  routes: Record<string, DesiredRouteState>;
}

export interface ObservedResourceState {
  name: string;
  type: string;
  resourceId: string;
  binding: string;
  status: string;
  backingResourceName?: string;
  specFingerprint?: string;
  updatedAt: string;
}

export interface ObservedWorkloadState {
  serviceId: string;
  name: string;
  category: GroupWorkloadCategory;
  status: string;
  hostname?: string;
  routeRef?: string;
  activeDeploymentId?: string;
  activeArtifactRef?: string;
  workloadKind?: string;
  specFingerprint?: string;
  deployedAt?: string;
  codeHash?: string;
  imageHash?: string;
  imageRef?: string;
  port?: number;
  ipv4?: string;
  dispatchNamespace?: string;
  resolvedBaseUrl?: string;
  updatedAt: string;
}

export interface ObservedRouteState {
  name: string;
  target: string;
  path?: string;
  methods?: string[];
  ingress?: string;
  timeoutMs?: number;
  url?: string;
  updatedAt?: string;
}

export interface ObservedGroupState {
  groupId: string;
  groupName: string;
  backend: string;
  env: string;
  version?: string | null;
  updatedAt: string;
  resources: Record<string, ObservedResourceState>;
  workloads: Record<string, ObservedWorkloadState>;
  routes: Record<string, ObservedRouteState>;
}

type JsonObject = Record<string, unknown>;

export function stableFingerprint(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as JsonObject)
        .sort()
        .map((key) => [key, sortValue((value as JsonObject)[key])]),
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(patch)) {
    const baseVal = base[key];
    const patchVal = patch[key];

    if (isPlainObject(baseVal) && isPlainObject(patchVal)) {
      result[key] = deepMerge(baseVal, patchVal);
    } else {
      result[key] = patchVal;
    }
  }

  return result;
}

function toPlainRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

function mergePublishOverrides(
  base: AppPublication[],
  patch: AppManifestOverride["publish"],
): AppPublication[] {
  if (!patch) return base;
  const result = [...base];

  patch.forEach((entry, index) => {
    const patchRecord = toPlainRecord(entry);
    if (typeof patchRecord.name !== "string" || !patchRecord.name.trim()) {
      throw new Error(`overrides.publish[${index}].name is required`);
    }
    const baseIndex = result.findIndex((publication) =>
      publication.name === patchRecord.name
    );
    if (baseIndex < 0 || baseIndex >= result.length) {
      result.push(entry);
      return;
    }
    const baseEntry = result[baseIndex];
    result[baseIndex] = baseEntry
      ? deepMerge(
        toPlainRecord(baseEntry),
        patchRecord,
      ) as AppPublication
      : entry;
  });

  return result;
}

function validateComputeDependencies(
  compute: Record<string, AppCompute>,
): void {
  const computeNames = new Set(Object.keys(compute));
  for (const [name, entry] of Object.entries(compute)) {
    if (!entry.depends) continue;
    for (const dep of entry.depends) {
      if (!computeNames.has(dep)) {
        throw new Error(
          `compute.${name}.depends references unknown compute: ${dep}`,
        );
      }
    }
  }
}

/**
 * Apply env-specific overrides from `manifest.overrides[envName]` to the
 * flat manifest shape. Only the whitelisted fields (compute /
 * routes / publish / env) are merged — everything else on
 * the override record is ignored.
 */
export function applyManifestOverrides(
  manifest: AppManifest,
  envName: string,
): AppManifest {
  const overrides = manifest.overrides?.[envName];
  if (!overrides) return { ...manifest, overrides: undefined };

  const merged: AppManifest = { ...manifest };
  if (overrides.compute) {
    const mergedCompute = deepMerge(
      manifest.compute as Record<string, unknown>,
      overrides.compute as Record<string, unknown>,
    );
    merged.compute = parseCompute({ compute: mergedCompute }, {
      allowInternalKind: true,
    });
  }
  if (overrides.routes) {
    merged.routes = overrides.routes;
  }
  if (overrides.resources) {
    const mergedResources = deepMerge(
      (manifest.resources ?? {}) as Record<string, unknown>,
      overrides.resources as Record<string, unknown>,
    );
    merged.resources = parseResources(
      { resources: mergedResources },
      merged.compute,
    );
  }
  if (overrides.publish) {
    merged.publish = mergePublishOverrides(
      manifest.publish ?? [],
      overrides.publish,
    );
  }
  if (overrides.env) {
    merged.env = { ...manifest.env, ...overrides.env };
  }
  validateComputeDependencies(merged.compute);
  validateResourceTargets(merged.resources, merged.compute);
  validateRouteTargets(merged.routes, merged.compute);
  merged.overrides = undefined;
  return merged;
}

function workloadCategoryFromKind(
  kind: AppCompute["kind"],
): GroupWorkloadCategory {
  switch (kind) {
    case "worker":
      return "worker";
    case "service":
      return "service";
    case "attached-container":
      return "container";
  }
}

export function attachedWorkloadName(
  parentName: string,
  childName: string,
): string {
  return `${parentName}-${childName}`;
}

export function compileGroupDesiredState(
  manifest: AppManifest,
  opts: {
    groupName?: string;
    backend?: string;
    envName?: string;
  } = {},
): GroupDesiredState {
  const envName = opts.envName ?? "default";
  const resolvedManifest = applyManifestOverrides(manifest, envName);
  const compute = resolvedManifest.compute ?? {};
  const resourcesSpec = resolvedManifest.resources ?? {};
  const routeList = resolvedManifest.routes ?? [];

  // In the flat schema all top-level compute entries are unique by name.
  // Attached containers are nested under `worker.containers.<name>` and
  // are surfaced as `${parent}-${child}` to match bundle workload documents and
  // avoid collisions when multiple workers use the same child container name.
  const routes = Object.fromEntries(
    routeList.map((route, index) => {
      const routeName = route.id ??
        (route.target
          ? `${route.target}:${route.path ?? index}`
          : `route-${index}`);
      return [
        routeName,
        {
          name: routeName,
          target: route.target,
          ...(route.path ? { path: route.path } : {}),
          ...(route.methods ? { methods: route.methods } : {}),
          ...(route.timeoutMs ? { timeoutMs: route.timeoutMs } : {}),
        } satisfies DesiredRouteState,
      ];
    }),
  );

  const routeNamesByTarget = new Map<string, string[]>();
  for (const [routeName, route] of Object.entries(routes)) {
    const current = routeNamesByTarget.get(route.target) ?? [];
    current.push(routeName);
    routeNamesByTarget.set(route.target, current);
  }

  const desiredWorkloads: Record<string, DesiredWorkloadState> = {};
  const desiredResources: Record<string, DesiredResourceState> = {};

  for (const [name, spec] of Object.entries(resourcesSpec)) {
    desiredResources[name] = {
      name,
      spec,
      specFingerprint: stableFingerprint({ spec }),
    };
  }

  for (const [name, entry] of Object.entries(compute)) {
    desiredWorkloads[name] = {
      name,
      category: workloadCategoryFromKind(entry.kind),
      spec: entry,
      specFingerprint: stableFingerprint({
        spec: entry,
        manifestEnv: resolvedManifest.env ?? {},
      }),
      dependsOn: entry.depends ?? [],
      routeNames: routeNamesByTarget.get(name) ?? [],
    };

    // Surface attached containers as their own workload entries so the
    // deploy pipeline can treat them as independent reconciliation units.
    if (entry.kind === "worker" && entry.containers) {
      for (const [childName, childEntry] of Object.entries(entry.containers)) {
        if (childEntry.cloudflare?.container) {
          continue;
        }
        const workloadName = attachedWorkloadName(name, childName);
        desiredWorkloads[workloadName] = {
          name: workloadName,
          category: workloadCategoryFromKind(childEntry.kind),
          spec: childEntry,
          specFingerprint: stableFingerprint({
            spec: childEntry,
            manifestEnv: resolvedManifest.env ?? {},
          }),
          dependsOn: childEntry.depends ?? [],
          routeNames: routeNamesByTarget.get(workloadName) ?? [],
        };
      }
    }
  }

  return {
    groupName: opts.groupName ?? manifest.name,
    version: resolvedManifest.version ?? "0.0.0",
    backend: opts.backend ?? "cloudflare",
    env: envName,
    manifest: resolvedManifest,
    resources: desiredResources,
    workloads: desiredWorkloads,
    routes,
  };
}

function validateResourceTargets(
  resources: Record<string, AppResource> | undefined,
  compute: Record<string, AppCompute>,
): void {
  for (const [resourceName, resource] of Object.entries(resources ?? {})) {
    for (const binding of resource.bindings ?? []) {
      if (!compute[binding.target]) {
        throw new Error(
          `resources.${resourceName}.bindings references unknown compute: ${binding.target}`,
        );
      }
    }
  }
}

export function resolveRouteOwner(route: DesiredRouteState): string {
  return route.ingress ?? route.target;
}

export function resolveWorkloadBaseUrl(
  workload: ObservedWorkloadState | undefined,
): string | undefined {
  if (!workload) return undefined;
  if (workload.resolvedBaseUrl) return workload.resolvedBaseUrl;
  if (workload.hostname) return `https://${workload.hostname}`;
  if (workload.ipv4 && workload.port) {
    return `http://${workload.ipv4}:${workload.port}`;
  }
  return undefined;
}

export function materializeRoute(
  route: DesiredRouteState,
  workloads: Record<string, ObservedWorkloadState>,
  updatedAt?: string,
  options: { groupHostname?: string | null } = {},
): ObservedRouteState {
  const groupHostname = options.groupHostname?.trim();
  const baseUrl = groupHostname
    ? `https://${groupHostname}`
    : resolveWorkloadBaseUrl(workloads[route.target]);
  let url: string | undefined;

  if (baseUrl) {
    try {
      url = route.path
        ? new URL(route.path, `${baseUrl.replace(/\/+$/, "")}/`).toString()
        : baseUrl;
    } catch {
      url = baseUrl;
    }
  }

  return {
    name: route.name,
    target: route.target,
    ...(route.path ? { path: route.path } : {}),
    ...(route.methods ? { methods: route.methods } : {}),
    ...(route.ingress ? { ingress: route.ingress } : {}),
    ...(route.timeoutMs ? { timeoutMs: route.timeoutMs } : {}),
    ...(url ? { url } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function materializeRoutes(
  desiredRoutes: Record<string, DesiredRouteState>,
  workloads: Record<string, ObservedWorkloadState>,
  updatedAt?: string,
  options: { groupHostname?: string | null } = {},
): Record<string, ObservedRouteState> {
  return Object.fromEntries(
    Object.entries(desiredRoutes).map((
      [name, route],
    ) => [name, materializeRoute(route, workloads, updatedAt, options)]),
  );
}

// Silence unused-type warning: `AppManifestOverride` re-exported for callers
// that still need the override shape.
export type { AppManifestOverride };
