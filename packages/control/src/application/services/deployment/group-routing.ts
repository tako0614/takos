import type { Env } from "../../../shared/types/env.ts";
import { listGroupRoutingHostnames } from "../routing/group-hostnames.ts";
import {
  deleteHostnameRouting,
  upsertHostnameRouting,
} from "../routing/service.ts";
import { runRoutingMutationWithRollback, snapshotRouting } from "./routing.ts";
import type { StoredHttpEndpoint } from "../routing/routing-models.ts";
import { materializeRoute, resolveRouteOwner } from "./group-state.ts";
import type {
  GroupDesiredState,
  ObservedGroupState,
  ObservedWorkloadState,
} from "./group-state.ts";

type RouteResolution = {
  hostname: string;
  endpoint: StoredHttpEndpoint;
};

type GroupRoutingOptions = {
  groupId?: string;
  spaceId?: string;
  groupHostnames?: string[];
};

export type GroupRouteReconcileResult = {
  routes: Record<string, ObservedGroupState["routes"][string]>;
  failedRoutes: Array<{ name: string; error: string }>;
};

function parseRouteHostname(
  route: ObservedGroupState["routes"][string] | undefined,
): string | undefined {
  if (!route) return undefined;
  if (!route.url) return undefined;
  try {
    return new URL(route.url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function routesForHostname(
  routes: Record<string, ObservedGroupState["routes"][string]>,
  hostname: string,
): string[] {
  return Object.entries(routes)
    .filter(([, route]) => parseRouteHostname(route) === hostname)
    .map(([name]) => name);
}

function resolveRouteEndpoint(
  route: GroupDesiredState["routes"][string],
  workloads: Record<string, ObservedWorkloadState>,
): RouteResolution {
  const owner = workloads[resolveRouteOwner(route)];
  if (!owner?.hostname) {
    throw new Error(
      `owner workload "${resolveRouteOwner(route)}" does not have a hostname`,
    );
  }

  const target = workloads[route.target];
  const endpoint = resolveRouteTargetEndpoint(route, target);
  return {
    hostname: owner.hostname,
    endpoint,
  };
}

function resolveRouteTargetEndpoint(
  route: GroupDesiredState["routes"][string],
  target: ObservedWorkloadState | undefined,
): StoredHttpEndpoint {
  if (!target) {
    throw new Error(`target workload "${route.target}" is not deployed`);
  }

  if (target.category === "worker") {
    const dispatchRef = target.activeArtifactRef?.trim() ||
      target.routeRef?.trim() ||
      "";
    if (!dispatchRef) {
      throw new Error(`worker "${route.target}" is missing a dispatch ref`);
    }
    return {
      name: route.name,
      routes: [
        {
          ...(route.path ? { pathPrefix: route.path } : {}),
          ...(route.methods ? { methods: route.methods } : {}),
        },
      ],
      target: {
        kind: "service-ref",
        ref: dispatchRef,
      },
      ...(route.timeoutMs ? { timeoutMs: route.timeoutMs } : {}),
    };
  }

  if (!target.resolvedBaseUrl) {
    throw new Error(
      `workload "${route.target}" is missing a resolved base URL`,
    );
  }

  return {
    name: route.name,
    routes: [
      {
        ...(route.path ? { pathPrefix: route.path } : {}),
        ...(route.methods ? { methods: route.methods } : {}),
      },
    ],
    target: {
      kind: "http-url",
      baseUrl: target.resolvedBaseUrl,
    },
    ...(route.timeoutMs ? { timeoutMs: route.timeoutMs } : {}),
  };
}

function normalizeHostname(hostname: string): string | null {
  const normalized = hostname.trim().toLowerCase();
  return normalized || null;
}

async function resolveGroupHostnames(
  env: Env,
  options: GroupRoutingOptions | undefined,
): Promise<string[]> {
  const explicit = options?.groupHostnames
    ?.map(normalizeHostname)
    .filter((hostname): hostname is string => Boolean(hostname));
  if (explicit) return Array.from(new Set(explicit));
  if (!options?.groupId) return [];
  const hostnames = await listGroupRoutingHostnames(env, {
    groupId: options.groupId,
    spaceId: options.spaceId,
  });
  return hostnames.hostnames;
}

async function reconcileGroupHostnameRouting(
  env: Env,
  desiredState: GroupDesiredState,
  currentRoutes: Record<string, ObservedGroupState["routes"][string]>,
  workloads: Record<string, ObservedGroupState["workloads"][string]>,
  updatedAt: string,
  groupHostnames: string[],
): Promise<GroupRouteReconcileResult> {
  const canonicalHostname = groupHostnames[0];
  const previousHostnames = new Set(
    Object.values(currentRoutes)
      .map((route) => parseRouteHostname(route))
      .filter((hostname): hostname is string => Boolean(hostname)),
  );
  const desiredHostnames = new Set(groupHostnames);

  const nextRoutes = { ...currentRoutes };
  const failedRoutes: Array<{ name: string; error: string }> = [];
  const endpoints: StoredHttpEndpoint[] = [];

  for (const [name, route] of Object.entries(desiredState.routes)) {
    try {
      endpoints.push(
        resolveRouteTargetEndpoint(route, workloads[route.target]),
      );
    } catch (error) {
      failedRoutes.push({
        name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failedRoutes.length > 0) {
    return { routes: nextRoutes, failedRoutes };
  }

  const rollbackHostnames = Array.from(
    new Set([...previousHostnames, ...desiredHostnames]),
  );
  const routingRollbackSnapshot = rollbackHostnames.length > 0
    ? await snapshotRouting(env, rollbackHostnames)
    : [];
  const allHostnames = new Set([...previousHostnames, ...desiredHostnames]);
  if (endpoints.length === 0) {
    await runRoutingMutationWithRollback(
      env,
      routingRollbackSnapshot,
      async () => {
        for (const hostname of allHostnames) {
          await deleteHostnameRouting({ env, hostname });
        }
      },
      {
        module: "group-routing",
        message:
          "Failed to restore routing snapshot during group route reconciliation (non-critical)",
      },
    );
    return { routes: {}, failedRoutes: [] };
  }

  await runRoutingMutationWithRollback(
    env,
    routingRollbackSnapshot,
    async () => {
      for (const hostname of groupHostnames) {
        await upsertHostnameRouting({
          env,
          hostname,
          target: {
            type: "http-endpoint-set",
            endpoints,
          },
        });
      }

      for (const hostname of previousHostnames) {
        if (desiredHostnames.has(hostname)) continue;
        await deleteHostnameRouting({ env, hostname });
      }
    },
    {
      module: "group-routing",
      message:
        "Failed to restore routing snapshot during group route reconciliation (non-critical)",
    },
  );

  for (const routeName of Object.keys(nextRoutes)) {
    if (!desiredState.routes[routeName]) {
      delete nextRoutes[routeName];
    }
  }
  for (const [name, route] of Object.entries(desiredState.routes)) {
    nextRoutes[name] = materializeRoute(route, workloads, updatedAt, {
      groupHostname: canonicalHostname,
    });
  }

  return { routes: nextRoutes, failedRoutes };
}

export async function reconcileGroupRouting(
  env: Env,
  desiredState: GroupDesiredState,
  currentRoutes: Record<string, ObservedGroupState["routes"][string]>,
  workloads: Record<string, ObservedGroupState["workloads"][string]>,
  updatedAt: string,
  options: GroupRoutingOptions = {},
): Promise<GroupRouteReconcileResult> {
  const groupHostnames = await resolveGroupHostnames(env, options);
  if (groupHostnames.length > 0) {
    return reconcileGroupHostnameRouting(
      env,
      desiredState,
      currentRoutes,
      workloads,
      updatedAt,
      groupHostnames,
    );
  }

  const routeAssignments = new Map<
    string,
    Array<{ name: string; route: GroupDesiredState["routes"][string] }>
  >();
  const failedRoutes: Array<{ name: string; error: string }> = [];

  for (const [name, route] of Object.entries(desiredState.routes)) {
    const owner = workloads[resolveRouteOwner(route)];
    const fallbackHostname = parseRouteHostname(currentRoutes[name]);
    const hostname = owner?.hostname ?? fallbackHostname;
    if (!hostname) {
      failedRoutes.push({
        name,
        error: `owner workload "${
          resolveRouteOwner(route)
        }" does not have a hostname`,
      });
      continue;
    }
    const existing = routeAssignments.get(hostname) ?? [];
    existing.push({ name, route });
    routeAssignments.set(hostname, existing);
  }

  const previousHostnames = new Set(
    Object.values(currentRoutes)
      .map((route) => parseRouteHostname(route))
      .filter((hostname): hostname is string => Boolean(hostname)),
  );
  const desiredHostnames = new Set(routeAssignments.keys());
  const rollbackHostnames = Array.from(
    new Set([...previousHostnames, ...desiredHostnames]),
  );
  const routingRollbackSnapshot = rollbackHostnames.length > 0
    ? await snapshotRouting(env, rollbackHostnames)
    : [];
  const nextRoutes = { ...currentRoutes };
  const failedHostnames = new Set<string>();

  await runRoutingMutationWithRollback(
    env,
    routingRollbackSnapshot,
    async () => {
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
            type: "http-endpoint-set",
            endpoints,
          },
        });
      }

      for (const hostname of previousHostnames) {
        if (desiredHostnames.has(hostname) || failedHostnames.has(hostname)) {
          continue;
        }
        await deleteHostnameRouting({ env, hostname });
      }
    },
    {
      module: "group-routing",
      message:
        "Failed to restore routing snapshot during group route reconciliation (non-critical)",
    },
  );

  for (const [hostname, routeGroup] of routeAssignments.entries()) {
    if (failedHostnames.has(hostname)) continue;
    for (const routeName of routesForHostname(nextRoutes, hostname)) {
      delete nextRoutes[routeName];
    }
    for (const { name, route } of routeGroup) {
      nextRoutes[name] = materializeRoute(route, workloads, updatedAt);
    }
  }

  for (const hostname of previousHostnames) {
    if (desiredHostnames.has(hostname) || failedHostnames.has(hostname)) {
      continue;
    }
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
