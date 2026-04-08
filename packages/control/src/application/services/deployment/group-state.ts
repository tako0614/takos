import type {
  AppCompute,
  AppManifest,
  AppManifestOverride,
  AppStorage,
} from '../source/app-manifest-types.ts';

export type GroupWorkloadCategory = 'worker' | 'container' | 'service';

export interface DesiredResourceState {
  name: string;
  type: AppStorage['type'];
  binding?: string;
  spec: AppStorage;
  specFingerprint: string;
}

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

export interface GroupDesiredState {
  apiVersion: 'takos.dev/v1alpha1';
  kind: 'GroupDesiredState';
  groupName: string;
  version: string;
  provider: string;
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
  providerResourceName?: string;
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
  provider: string;
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
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as JsonObject)
        .sort()
        .map((key) => [key, sortValue((value as JsonObject)[key])]),
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

/**
 * Apply env-specific overrides from `manifest.overrides[envName]` to the
 * flat manifest shape. Only the whitelisted fields (compute / storage /
 * routes / publish / env / scopes / oauth) are merged — everything else on
 * the override record is ignored.
 */
export function applyManifestOverrides(manifest: AppManifest, envName: string): AppManifest {
  const overrides = manifest.overrides?.[envName];
  if (!overrides) return { ...manifest, overrides: undefined };

  const merged: AppManifest = { ...manifest };
  if (overrides.compute) {
    merged.compute = deepMerge(
      manifest.compute as Record<string, unknown>,
      overrides.compute as Record<string, unknown>,
    ) as Record<string, AppCompute>;
  }
  if (overrides.storage) {
    merged.storage = deepMerge(
      manifest.storage as Record<string, unknown>,
      overrides.storage as Record<string, unknown>,
    ) as Record<string, AppStorage>;
  }
  if (overrides.routes) {
    merged.routes = overrides.routes;
  }
  if (overrides.publish) {
    merged.publish = overrides.publish;
  }
  if (overrides.env) {
    merged.env = { ...manifest.env, ...overrides.env };
  }
  if (overrides.scopes) {
    merged.scopes = overrides.scopes;
  }
  if (overrides.oauth) {
    merged.oauth = overrides.oauth;
  }
  merged.overrides = undefined;
  return merged;
}

function workloadCategoryFromKind(kind: AppCompute['kind']): GroupWorkloadCategory {
  switch (kind) {
    case 'worker':
      return 'worker';
    case 'service':
      return 'service';
    case 'attached-container':
      return 'container';
  }
}

export function compileGroupDesiredState(
  manifest: AppManifest,
  opts: {
    groupName?: string;
    provider?: string;
    envName?: string;
  } = {},
): GroupDesiredState {
  const envName = opts.envName ?? 'default';
  const resolvedManifest = applyManifestOverrides(manifest, envName);
  const storage = resolvedManifest.storage ?? {};
  const compute = resolvedManifest.compute ?? {};
  const routeList = resolvedManifest.routes ?? [];

  // In the flat schema all top-level compute entries are unique by name.
  // Attached containers are nested under `worker.containers.<name>` and
  // share a flat namespace with the parent — kernel validation is in
  // parse-compute.ts; we just surface them here under the same desired
  // workloads map for scheduling purposes.
  const routes = Object.fromEntries(
    routeList.map((route, index) => [
      route.target ? `${route.target}:${route.path ?? index}` : `route-${index}`,
      {
        name: route.target ? `${route.target}:${route.path ?? index}` : `route-${index}`,
        target: route.target,
        ...(route.path ? { path: route.path } : {}),
        ...(route.methods ? { methods: route.methods } : {}),
        ...(route.timeoutMs ? { timeoutMs: route.timeoutMs } : {}),
      } satisfies DesiredRouteState,
    ]),
  );

  const routeNamesByTarget = new Map<string, string[]>();
  for (const [routeName, route] of Object.entries(routes)) {
    const current = routeNamesByTarget.get(route.target) ?? [];
    current.push(routeName);
    routeNamesByTarget.set(route.target, current);
  }

  const desiredResources = Object.fromEntries(
    Object.entries(storage).map(([name, resource]) => [
      name,
      {
        name,
        type: resource.type,
        ...(resource.bind ? { binding: resource.bind } : {}),
        spec: resource,
        specFingerprint: stableFingerprint(resource),
      } satisfies DesiredResourceState,
    ]),
  );

  const desiredWorkloads: Record<string, DesiredWorkloadState> = {};

  for (const [name, entry] of Object.entries(compute)) {
    desiredWorkloads[name] = {
      name,
      category: workloadCategoryFromKind(entry.kind),
      spec: entry,
      specFingerprint: stableFingerprint(entry),
      dependsOn: entry.depends ?? [],
      routeNames: routeNamesByTarget.get(name) ?? [],
    };

    // Surface attached containers as their own workload entries so the
    // deploy pipeline can treat them as independent reconciliation units.
    if (entry.kind === 'worker' && entry.containers) {
      for (const [childName, childEntry] of Object.entries(entry.containers)) {
        desiredWorkloads[childName] = {
          name: childName,
          category: workloadCategoryFromKind(childEntry.kind),
          spec: childEntry,
          specFingerprint: stableFingerprint(childEntry),
          dependsOn: childEntry.depends ?? [],
          routeNames: routeNamesByTarget.get(childName) ?? [],
        };
      }
    }
  }

  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'GroupDesiredState',
    groupName: opts.groupName ?? manifest.name,
    version: resolvedManifest.version ?? '0.0.0',
    provider: opts.provider ?? 'cloudflare',
    env: envName,
    manifest: resolvedManifest,
    resources: desiredResources,
    workloads: desiredWorkloads,
    routes,
  };
}

export function resolveRouteOwner(route: DesiredRouteState): string {
  return route.ingress ?? route.target;
}

export function resolveWorkloadBaseUrl(workload: ObservedWorkloadState | undefined): string | undefined {
  if (!workload) return undefined;
  if (workload.resolvedBaseUrl) return workload.resolvedBaseUrl;
  if (workload.hostname) return `https://${workload.hostname}`;
  if (workload.ipv4 && workload.port) return `http://${workload.ipv4}:${workload.port}`;
  return undefined;
}

export function materializeRoute(
  route: DesiredRouteState,
  workloads: Record<string, ObservedWorkloadState>,
  updatedAt?: string,
): ObservedRouteState {
  const baseUrl = resolveWorkloadBaseUrl(workloads[route.target]);
  let url: string | undefined;

  if (baseUrl) {
    try {
      url = route.path
        ? new URL(route.path, `${baseUrl.replace(/\/+$/, '')}/`).toString()
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
): Record<string, ObservedRouteState> {
  return Object.fromEntries(
    Object.entries(desiredRoutes).map(([name, route]) => [name, materializeRoute(route, workloads, updatedAt)]),
  );
}

// Silence unused-type warning: `AppManifestOverride` re-exported for callers
// that still need the override shape.
export type { AppManifestOverride };
