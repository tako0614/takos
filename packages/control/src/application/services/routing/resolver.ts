/**
 * Routing Resolver
 *
 * Pure functions for parsing routing values, selecting deployment targets,
 * and matching HTTP endpoints. No I/O or caching — only data transformation.
 */

import type {
  ParsedRoutingValue,
  RoutingTarget,
  StoredHttpEndpoint,
  WeightedDeploymentTarget,
} from './routing-models.ts';

function isRoutingTarget(value: unknown): value is RoutingTarget {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.type === 'deployments' && Array.isArray(v.deployments) && v.deployments.length > 0) {
    for (const entry of v.deployments) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.routeRef === 'string' && e.routeRef) {
        return true;
      }
    }
  }
  if (v.type === 'http-endpoint-set' && Array.isArray(v.endpoints) && v.endpoints.length > 0) return true;
  return false;
}

export function toSingleDeploymentTarget(routeRef: string): RoutingTarget {
  return {
    type: 'deployments',
    deployments: [{ routeRef, weight: 100, status: 'active' }],
  };
}

export function parseEpochMillis(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
    const asDate = Date.parse(raw);
    if (Number.isFinite(asDate) && asDate > 0) return asDate;
  }
  return undefined;
}

export function coercePositiveInt(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.floor(raw);
    return n > 0 ? n : null;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    const n = Math.floor(parsed);
    return n > 0 ? n : null;
  }
  return null;
}

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

/**
 * Select a concrete worker name from a routing target.
 *
 * - `deployments`: weighted random selection (weight-based)
 */
export function selectRouteRefFromRoutingTarget(
  target: RoutingTarget,
  options?: { random?: () => number }
): string | null {
  return selectDeploymentTargetFromRoutingTarget(target, options)?.routeRef ?? null;
}

export function selectDeploymentTargetFromRoutingTarget(
  target: RoutingTarget,
  options?: { random?: () => number }
): WeightedDeploymentTarget | null {
  if (target.type !== 'deployments') return null;

  const rng = options?.random ?? Math.random;
  const candidates: Array<WeightedDeploymentTarget & { weight: number }> = [];

  for (const entry of target.deployments) {
    const routeRef = typeof entry?.routeRef === 'string' && entry.routeRef.length > 0
      ? entry.routeRef
      : '';
    if (!routeRef) continue;
    const weight = coercePositiveInt(entry.weight) ?? 0;
    if (weight <= 0) continue;
    candidates.push({
      routeRef,
      weight,
      ...(entry.deploymentId ? { deploymentId: entry.deploymentId } : {}),
      ...(entry.status ? { status: entry.status } : {}),
    });
  }

  if (candidates.length === 0) {
    // Fall back to the first valid route ref even if weight is missing/invalid.
    for (const entry of target.deployments) {
      const routeRef = typeof entry?.routeRef === 'string' && entry.routeRef.length > 0
        ? entry.routeRef
        : '';
      if (routeRef) {
        return {
          routeRef,
          weight: coercePositiveInt(entry.weight) ?? 100,
          ...(entry.deploymentId ? { deploymentId: entry.deploymentId } : {}),
          ...(entry.status ? { status: entry.status } : {}),
        };
      }
    }
    return null;
  }

  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return candidates[0] ?? null;

  let r = rng() * total;
  for (const c of candidates) {
    r -= c.weight;
    if (r < 0) return c;
  }
  return candidates[candidates.length - 1] ?? null;
}

/**
 * Select a worker name from an http-endpoint-set routing target.
 * Uses longest pathPrefix match among cloudflare.worker endpoints.
 */
export function selectHttpEndpointFromHttpEndpointSet(
  endpoints: StoredHttpEndpoint[],
  path: string,
  method: string
): StoredHttpEndpoint | null {
  let best: StoredHttpEndpoint | null = null;
  let bestPrefixLen = -1;

  for (const ep of endpoints) {
    const routes = ep.routes;
    if (routes.length === 0) {
      // match-all endpoint
      if (bestPrefixLen < 0) {
        best = ep;
        bestPrefixLen = 0;
      }
      continue;
    }

    for (const route of routes) {
      const prefix = route.pathPrefix ?? '';
      if (prefix && !path.startsWith(prefix)) continue;
      if (route.methods && route.methods.length > 0) {
        if (!route.methods.includes(method.toUpperCase())) continue;
      }
      const prefixLen = prefix.length;
      if (prefixLen > bestPrefixLen) {
        best = ep;
        bestPrefixLen = prefixLen;
      }
    }
  }

  return best;
}

export function selectRouteRefFromHttpEndpointSet(
  endpoints: StoredHttpEndpoint[],
  path: string,
  method: string
): string | null {
  const endpoint = selectHttpEndpointFromHttpEndpointSet(endpoints, path, method);
  if (!endpoint) {
    return null;
  }
  return endpoint.target.kind === 'service-ref' ? endpoint.target.ref : null;
}

export function parseRoutingValue(raw: string | null | undefined): ParsedRoutingValue {
  if (!raw) {
    return { target: null, rawFormat: 'empty' };
  }

  // JSON envelope (new)
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'string' && parsed) {
      return { target: toSingleDeploymentTarget(parsed), rawFormat: 'json' };
    }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;

      const tombstoneUntil = parseEpochMillis(obj.tombstoneUntil);
      const updatedAt = parseEpochMillis(obj.updatedAt);
      const version = typeof obj.version === 'number' && Number.isFinite(obj.version) ? obj.version : undefined;

      if (obj.tombstone === true || (typeof tombstoneUntil === 'number' && tombstoneUntil > 0)) {
        return {
          target: null,
          tombstoneUntil,
          updatedAt,
          version,
          rawFormat: 'json',
        };
      }

      if (isRoutingTarget(obj)) {
        return { target: obj, tombstoneUntil, updatedAt, version, rawFormat: 'json' };
      }

      // Parsed JSON but unknown/unsupported shape: fail-close.
      return { target: null, rawFormat: 'unknown' };
    }

    // Parsed JSON primitive but not supported.
    return { target: null, rawFormat: 'unknown' };
  } catch {
    // fallthrough
  }

  return { target: null, rawFormat: 'unknown' };
}
