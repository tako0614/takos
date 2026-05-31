// ============================================================
// parse-routes.ts
// ============================================================
//
// Flat-schema route parser.
//
// Walks the top-level `routes[]` array and builds `AppRoute[]`.
//
// Route shape:
//   - target  (required) — compute name
//   - path    (required) — must start with '/'
//   - methods (optional) — HTTP methods to match
//   - timeoutMs (optional)
// ============================================================

import type { AppCompute, AppRoute } from "../app-manifest-types.ts";
import {
  asOptionalInteger,
  asRecord,
  asRequiredString,
  asString,
  asStringArray,
} from "../app-manifest-utils.ts";

const VALID_HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

const ROUTE_FIELDS = new Set([
  "id",
  "target",
  "path",
  "methods",
  "timeoutMs",
]);

const ALL_HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

function assertAllowedFields(
  record: Record<string, unknown>,
  prefix: string,
): void {
  for (const key of Object.keys(record)) {
    if (!ROUTE_FIELDS.has(key)) {
      throw new Error(
        `${prefix}.${key} is not supported by the app manifest contract`,
      );
    }
  }
}

function collectAttachedContainers(
  compute: Record<string, AppCompute>,
): Record<string, { parentWorker: string; childName: string }> {
  const attached: Record<string, { parentWorker: string; childName: string }> =
    {};
  for (const [parentWorker, entry] of Object.entries(compute)) {
    if (entry.kind !== "worker") continue;
    for (const childName of Object.keys(entry.containers ?? {})) {
      attached[childName] = { parentWorker, childName };
      attached[`${parentWorker}-${childName}`] = { parentWorker, childName };
    }
  }
  return attached;
}

export function validateRouteTargets(
  routes: AppRoute[],
  compute: Record<string, AppCompute>,
): void {
  const attached = collectAttachedContainers(compute);
  for (const [index, route] of routes.entries()) {
    const target = route.target;
    if (compute[target]) {
      const topLevel = compute[target];
      if (topLevel.kind === "worker" || topLevel.kind === "service") {
        continue;
      }
    }

    const attachedTarget = attached[target];
    if (attachedTarget) {
      throw new Error(
        `routes[${index}].target references attached container compute: ${target} (use compute.${attachedTarget.parentWorker} instead)`,
      );
    }

    throw new Error(
      `routes[${index}].target references unknown compute: ${target}`,
    );
  }
}

function expandRouteMethods(route: AppRoute): Set<string> {
  return route.methods ? new Set(route.methods) : new Set(ALL_HTTP_METHODS);
}

function firstMethodOverlap(
  left: Set<string>,
  right: Set<string>,
): string | null {
  for (const method of left) {
    if (right.has(method)) return method;
  }
  return null;
}

export function validateRouteUniqueness(routes: AppRoute[]): void {
  const byId = new Map<string, number>();
  const byTargetPath = new Map<
    string,
    { index: number; target: string; path: string }
  >();
  const byPath = new Map<
    string,
    { index: number; methods: Set<string> }[]
  >();

  for (let index = 0; index < routes.length; index++) {
    const route = routes[index];
    if (route.id) {
      const previousId = byId.get(route.id);
      if (previousId != null) {
        throw new Error(
          `route id '${route.id}' duplicates routes[${previousId}]`,
        );
      }
      byId.set(route.id, index);
    }
    const key = `${route.target}\0${route.path}`;
    const previous = byTargetPath.get(key);
    if (previous) {
      throw new Error(
        `route target/path '${route.target} ${route.path}' duplicates routes[${previous.index}]. A manifest must declare at most one route for the same target + path; list multiple methods on that route instead.`,
      );
    }
    byTargetPath.set(key, {
      index,
      target: route.target,
      path: route.path,
    });

    const methods = expandRouteMethods(route);
    const pathBucket = byPath.get(route.path) ?? [];
    for (const previousRoute of pathBucket) {
      const overlap = firstMethodOverlap(methods, previousRoute.methods);
      if (!overlap) continue;
      throw new Error(
        `route path '${route.path}' overlaps routes[${previousRoute.index}] for method ${overlap}. Omit methods only when the route owns every method for the path, or split by non-overlapping methods.`,
      );
    }
    pathBucket.push({ index, methods });
    byPath.set(route.path, pathBucket);
  }
}

export type ParseRoutesOptions = {
  validateTargets?: boolean;
};

export function parseRoutes(
  topLevel: Record<string, unknown>,
  compute: Record<string, AppCompute>,
  options: ParseRoutesOptions = {},
): AppRoute[] {
  if (topLevel.routes == null) return [];
  if (!Array.isArray(topLevel.routes)) {
    throw new Error("routes must be an array");
  }

  const routes = topLevel.routes.map((entry, index) => {
    const route = asRecord(entry);
    const prefix = `routes[${index}]`;
    assertAllowedFields(route, prefix);

    const id = asString(route.id, `${prefix}.id`);
    const target = asRequiredString(route.target, `${prefix}.target`);

    const path = asRequiredString(route.path, `${prefix}.path`);
    if (!path.startsWith("/")) {
      throw new Error(`${prefix}.path must start with '/' (got: ${path})`);
    }

    const methods = asStringArray(route.methods, `${prefix}.methods`);
    if (methods) {
      for (const method of methods) {
        if (!VALID_HTTP_METHODS.includes(method.toUpperCase())) {
          throw new Error(
            `${prefix}.methods contains invalid method: ${method}`,
          );
        }
      }
    }

    return {
      ...(id ? { id } : {}),
      target,
      path,
      ...(methods
        ? { methods: methods.map((method) => method.toUpperCase()) }
        : {}),
      ...(route.timeoutMs != null
        ? {
          timeoutMs: asOptionalInteger(route.timeoutMs, `${prefix}.timeoutMs`, {
            min: 1,
          }),
        }
        : {}),
    };
  });

  if (options.validateTargets !== false) {
    validateRouteTargets(routes, compute);
  }

  validateRouteUniqueness(routes);

  return routes;
}
