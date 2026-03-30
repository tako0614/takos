import type { Env } from '../../../shared/types/env.ts';
import { deleteHostnameRouting, upsertHostnameRouting } from '../routing/service.ts';
import type { StoredHttpEndpoint } from '../routing/routing-models.ts';
import { materializeRoute, resolveRouteOwner } from './group-state.ts';
import type { GroupDesiredState, ObservedGroupState, ObservedWorkloadState } from './group-state.ts';

type RouteResolution = {
  hostname: string;
  endpoint: StoredHttpEndpoint;
};

export type GroupRouteReconcileResult = {
  routes: Record<string, ObservedGroupState['routes'][string]>;
  failedRoutes: Array<{ name: string; error: string }>;
};

function parseRouteHostname(route: ObservedGroupState['routes'][string] | undefined): string | undefined {
  if (!route) return undefined;
  if (!route.url) return undefined;
  try {
    return new URL(route.url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function routesForHostname(
  routes: Record<string, ObservedGroupState['routes'][string]>,
  hostname: string,
): string[] {
  return Object.entries(routes)
    .filter(([, route]) => parseRouteHostname(route) === hostname)
    .map(([name]) => name);
}

function resolveRouteEndpoint(
  route: GroupDesiredState['routes'][string],
  workloads: Record<string, ObservedWorkloadState>,
): RouteResolution {
  const owner = workloads[resolveRouteOwner(route)];
  if (!owner?.hostname) {
    throw new Error(`owner workload "${resolveRouteOwner(route)}" does not have a hostname`);
  }

  const target = workloads[route.target];
  if (!target) {
    throw new Error(`target workload "${route.target}" is not deployed`);
  }

  if (target.category === 'worker') {
    if (!target.routeRef) {
      throw new Error(`worker "${route.target}" is missing a routeRef`);
    }
    return {
      hostname: owner.hostname,
      endpoint: {
        name: route.name,
        routes: [
          {
            ...(route.path ? { pathPrefix: route.path } : {}),
            ...(route.methods ? { methods: route.methods } : {}),
          },
        ],
        target: {
          kind: 'service-ref',
          ref: target.routeRef,
        },
        ...(route.timeoutMs ? { timeoutMs: route.timeoutMs } : {}),
      },
    };
  }

  if (!target.resolvedBaseUrl) {
    throw new Error(`workload "${route.target}" is missing a resolved base URL`);
  }

  return {
    hostname: owner.hostname,
    endpoint: {
      name: route.name,
      routes: [
        {
          ...(route.path ? { pathPrefix: route.path } : {}),
          ...(route.methods ? { methods: route.methods } : {}),
        },
      ],
      target: {
        kind: 'http-url',
        baseUrl: target.resolvedBaseUrl,
      },
      ...(route.timeoutMs ? { timeoutMs: route.timeoutMs } : {}),
    },
  };
}

export async function reconcileGroupRouting(
  env: Env,
  desiredState: GroupDesiredState,
  currentRoutes: Record<string, ObservedGroupState['routes'][string]>,
  workloads: Record<string, ObservedGroupState['workloads'][string]>,
  updatedAt: string,
): Promise<GroupRouteReconcileResult> {
  const routeAssignments = new Map<string, Array<{ name: string; route: GroupDesiredState['routes'][string] }>>();
  const failedRoutes: Array<{ name: string; error: string }> = [];

  for (const [name, route] of Object.entries(desiredState.routes)) {
    const owner = workloads[resolveRouteOwner(route)];
    const fallbackHostname = parseRouteHostname(currentRoutes[name]);
    const hostname = owner?.hostname ?? fallbackHostname;
    if (!hostname) {
      failedRoutes.push({
        name,
        error: `owner workload "${resolveRouteOwner(route)}" does not have a hostname`,
      });
      continue;
    }
    const existing = routeAssignments.get(hostname) ?? [];
    existing.push({ name, route });
    routeAssignments.set(hostname, existing);
  }

  const nextRoutes = { ...currentRoutes };
  const failedHostnames = new Set<string>();

  for (const [hostname, routeGroup] of routeAssignments.entries()) {
    const endpoints: StoredHttpEndpoint[] = [];
    let hasFailure = false;

    for (const { name, route } of routeGroup) {
      try {
        const resolved = resolveRouteEndpoint(route, workloads);
        endpoints.push(resolved.endpoint);
      } catch (error) {
        hasFailure = true;
        failedRoutes.push({
          name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (hasFailure) {
      failedHostnames.add(hostname);
      continue;
    }

    await upsertHostnameRouting({
      env,
      hostname,
      target: {
        type: 'http-endpoint-set',
        endpoints,
      },
    });

    for (const routeName of routesForHostname(nextRoutes, hostname)) {
      delete nextRoutes[routeName];
    }
    for (const { name, route } of routeGroup) {
      nextRoutes[name] = materializeRoute(route, workloads, updatedAt);
    }
  }

  const previousHostnames = new Set(
    Object.values(currentRoutes)
      .map((route) => parseRouteHostname(route))
      .filter((hostname): hostname is string => Boolean(hostname)),
  );
  const desiredHostnames = new Set(routeAssignments.keys());

  for (const hostname of previousHostnames) {
    if (desiredHostnames.has(hostname) || failedHostnames.has(hostname)) continue;
    await deleteHostnameRouting({ env, hostname });
    for (const routeName of routesForHostname(nextRoutes, hostname)) {
      delete nextRoutes[routeName];
    }
  }

  for (const [name, route] of Object.entries(currentRoutes)) {
    const hostname = parseRouteHostname(route);
    if (!hostname || !failedHostnames.has(hostname)) continue;
    nextRoutes[name] = route;
  }

  return { routes: nextRoutes, failedRoutes };
}
