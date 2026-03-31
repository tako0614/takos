import type {
  AppContainer,
  AppManifest,
  AppResource,
  AppRoute,
  AppService,
  AppWorker,
} from '../source/app-manifest-types.ts';

export type GroupWorkloadCategory = 'worker' | 'container' | 'service';

export interface DesiredResourceState {
  name: string;
  type: AppResource['type'];
  binding?: string;
  spec: AppResource;
  specFingerprint: string;
}

export interface DesiredWorkloadState {
  name: string;
  category: GroupWorkloadCategory;
  spec: AppWorker | AppContainer | AppService;
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

export function applyManifestOverrides(manifest: AppManifest, envName: string): AppManifest {
  const specAny = manifest.spec as Record<string, unknown>;
  const overrides = specAny.overrides as Record<string, Record<string, unknown>> | undefined;

  if (!overrides?.[envName]) return manifest;

  const mergedSpec = deepMerge(specAny, overrides[envName]) as AppManifest['spec'];
  delete (mergedSpec as Record<string, unknown>).overrides;
  return { ...manifest, spec: mergedSpec };
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
  const resources = resolvedManifest.spec.resources ?? {};
  const workers = resolvedManifest.spec.workers ?? {};
  const containers = resolvedManifest.spec.containers ?? {};
  const services = resolvedManifest.spec.services ?? {};
  const routeList = resolvedManifest.spec.routes ?? [];

  const workloadNames = [
    ...Object.keys(workers),
    ...Object.keys(containers),
    ...Object.keys(services),
  ];
  const duplicates = workloadNames.filter((name, index) => workloadNames.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Component names must be unique across workers/containers/services: ${Array.from(new Set(duplicates)).join(', ')}`);
  }

  const routes = Object.fromEntries(
    routeList.map((route) => [
      route.name,
      {
        name: route.name,
        target: route.target,
        ...(route.path ? { path: route.path } : {}),
        ...(route.methods ? { methods: route.methods } : {}),
        ...(route.ingress ? { ingress: route.ingress } : {}),
        ...(route.timeoutMs ? { timeoutMs: route.timeoutMs } : {}),
      } satisfies DesiredRouteState,
    ]),
  );

  const routeNamesByTarget = new Map<string, string[]>();
  for (const route of routeList) {
    const current = routeNamesByTarget.get(route.target) ?? [];
    current.push(route.name);
    routeNamesByTarget.set(route.target, current);
  }

  const desiredResources = Object.fromEntries(
    Object.entries(resources).map(([name, resource]) => [
      name,
      {
        name,
        type: resource.type,
        ...(resource.binding ? { binding: resource.binding } : {}),
        spec: resource,
        specFingerprint: stableFingerprint(resource),
      } satisfies DesiredResourceState,
    ]),
  );

  const desiredWorkloads: Record<string, DesiredWorkloadState> = {};

  for (const [name, worker] of Object.entries(workers)) {
    desiredWorkloads[name] = {
      name,
      category: 'worker',
      spec: worker,
      specFingerprint: stableFingerprint(worker),
      dependsOn: worker.dependsOn ?? [],
      routeNames: routeNamesByTarget.get(name) ?? [],
    };
  }

  for (const [name, container] of Object.entries(containers)) {
    desiredWorkloads[name] = {
      name,
      category: 'container',
      spec: container,
      specFingerprint: stableFingerprint(container),
      dependsOn: container.dependsOn ?? [],
      routeNames: routeNamesByTarget.get(name) ?? [],
    };
  }

  for (const [name, service] of Object.entries(services)) {
    desiredWorkloads[name] = {
      name,
      category: 'service',
      spec: service,
      specFingerprint: stableFingerprint(service),
      dependsOn: service.dependsOn ?? [],
      routeNames: routeNamesByTarget.get(name) ?? [],
    };
  }

  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'GroupDesiredState',
    groupName: opts.groupName ?? manifest.metadata.name,
    version: resolvedManifest.spec.version,
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
