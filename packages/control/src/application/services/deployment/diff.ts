/**
 * Diff computation for the control plane apply engine.
 *
 * Mirrors the logic from `apps/cli/src/lib/state/diff.ts` but operates
 * on the CP-side AppManifest type and derives current state from the
 * groups / group_entities tables rather than a local state file.
 */

import type { AppManifest } from './group-deploy-manifest.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DiffAction = 'create' | 'update' | 'delete' | 'unchanged';

export type EntityCategory = 'resource' | 'worker' | 'container' | 'service' | 'route';

export interface DiffEntry {
  name: string;
  category: EntityCategory;
  action: DiffAction;
  type?: string; // resource type, 'worker', 'container', 'service', 'route'
  reason?: string; // 'new', 'code changed', 'removed from manifest', etc.
}

export interface DiffResult {
  entries: DiffEntry[];
  hasChanges: boolean;
  summary: { create: number; update: number; delete: number; unchanged: number };
}

// ---------------------------------------------------------------------------
// GroupState — reconstructed from DB rows (groups + group_entities)
// ---------------------------------------------------------------------------

export interface ResourceStateRecord {
  type: string;
  id: string;
  binding: string;
  createdAt: string;
}

export interface WorkerStateRecord {
  scriptName: string;
  deployedAt: string;
  codeHash: string;
}

export interface ContainerStateRecord {
  deployedAt: string;
  imageHash: string;
}

export interface ServiceStateRecord {
  deployedAt: string;
  imageHash: string;
}

export interface RouteStateRecord {
  target: string;
  path?: string;
  domain?: string;
  url?: string;
}

/**
 * Equivalent of cli TakosState but constructed from DB rows.
 * `getGroupState()` in apply-engine.ts builds this from
 * groups + group_entities tables.
 */
export interface GroupState {
  groupId: string;
  groupName: string;
  provider: string;
  env: string;
  updatedAt: string;
  resources: Record<string, ResourceStateRecord>;
  workers: Record<string, WorkerStateRecord>;
  containers: Record<string, ContainerStateRecord>;
  services: Record<string, ServiceStateRecord>;
  routes: Record<string, RouteStateRecord>;
}

// ---------------------------------------------------------------------------
// Extended spec — handles containers/services/routes that may exist on
// the manifest spec but are not part of the base AppManifest type.
// ---------------------------------------------------------------------------

interface ExtendedSpec {
  containers?: Record<string, unknown>;
  services?: Record<string, unknown>;
  routes?: Record<string, { target: string }> | Array<{ name?: string; target: string }>;
}

/**
 * Normalise routes to a Record<string, { target: string }>.
 * The CP manifest uses AppRoute[] (array form) while the old CLI
 * diff used Record form. This helper bridges both.
 */
function normaliseRoutes(
  raw: ExtendedSpec['routes'] | undefined,
): Record<string, { target: string }> {
  if (!raw) return {};

  // Array form (canonical AppManifest)
  if (Array.isArray(raw)) {
    const out: Record<string, { target: string }> = {};
    for (const r of raw) {
      const key = r.name ?? r.target;
      out[key] = { target: r.target };
    }
    return out;
  }

  // Record form (legacy / CLI)
  return raw as Record<string, { target: string }>;
}

// ---------------------------------------------------------------------------
// computeDiff
// ---------------------------------------------------------------------------

/**
 * Compute the diff between a desired AppManifest and the current GroupState.
 *
 * Diff logic:
 * - Resource: missing -> create, type changed -> error, else unchanged
 * - Worker:   missing -> create, else unchanged (codeHash compare deferred to post-build)
 * - Container/Service: missing -> create, else unchanged
 * - Route:    missing -> create, target changed -> update, else unchanged
 * - Entities present in current but absent from manifest -> delete
 * - First deploy (current === null) -> everything is create
 */
export function computeDiff(
  desired: AppManifest,
  current: GroupState | null,
): DiffResult {
  const entries: DiffEntry[] = [];

  const spec = desired.spec as typeof desired.spec & ExtendedSpec;

  // -- Resources --
  const desiredResources = spec.resources ?? {};
  const currentResources = current?.resources ?? {};

  for (const [name, resource] of Object.entries(desiredResources)) {
    const existing = currentResources[name];
    if (!existing) {
      entries.push({ name, category: 'resource', action: 'create', type: resource.type, reason: 'new' });
    } else {
      if (existing.type !== resource.type) {
        throw new Error(
          `Resource "${name}" type changed from "${existing.type}" to "${resource.type}". ` +
          `Type changes are not supported -- delete and recreate the resource.`,
        );
      }
      entries.push({ name, category: 'resource', action: 'unchanged', type: resource.type });
    }
  }

  for (const name of Object.keys(currentResources)) {
    if (!desiredResources[name]) {
      entries.push({
        name,
        category: 'resource',
        action: 'delete',
        type: currentResources[name].type,
        reason: 'removed from manifest',
      });
    }
  }

  // -- Workers --
  const desiredWorkers = spec.workers ?? {};
  const currentWorkers = current?.workers ?? {};

  for (const name of Object.keys(desiredWorkers)) {
    const existing = currentWorkers[name];
    if (!existing) {
      entries.push({ name, category: 'worker', action: 'create', type: 'worker', reason: 'new' });
    } else {
      // codeHash comparison deferred to post-build phase; treat as unchanged here.
      entries.push({ name, category: 'worker', action: 'unchanged', type: 'worker' });
    }
  }

  for (const name of Object.keys(currentWorkers)) {
    if (!desiredWorkers[name]) {
      entries.push({
        name,
        category: 'worker',
        action: 'delete',
        type: 'worker',
        reason: 'removed from manifest',
      });
    }
  }

  // -- Containers --
  const desiredContainers = (spec.containers ?? {}) as Record<string, unknown>;
  const currentContainers = current?.containers ?? {};

  for (const name of Object.keys(desiredContainers)) {
    const existing = currentContainers[name];
    if (!existing) {
      entries.push({ name, category: 'container', action: 'create', type: 'container', reason: 'new' });
    } else {
      entries.push({ name, category: 'container', action: 'unchanged', type: 'container' });
    }
  }

  for (const name of Object.keys(currentContainers)) {
    if (!desiredContainers[name]) {
      entries.push({
        name,
        category: 'container',
        action: 'delete',
        type: 'container',
        reason: 'removed from manifest',
      });
    }
  }

  // -- Services --
  const desiredServices = (spec.services ?? {}) as Record<string, unknown>;
  const currentServices = current?.services ?? {};

  for (const name of Object.keys(desiredServices)) {
    const existing = currentServices[name];
    if (!existing) {
      entries.push({ name, category: 'service', action: 'create', type: 'service', reason: 'new' });
    } else {
      entries.push({ name, category: 'service', action: 'unchanged', type: 'service' });
    }
  }

  for (const name of Object.keys(currentServices)) {
    if (!desiredServices[name]) {
      entries.push({
        name,
        category: 'service',
        action: 'delete',
        type: 'service',
        reason: 'removed from manifest',
      });
    }
  }

  // -- Routes --
  const desiredRoutes = normaliseRoutes(spec.routes);
  const currentRoutes = current?.routes ?? {};

  for (const name of Object.keys(desiredRoutes)) {
    const existing = currentRoutes[name];
    if (!existing) {
      entries.push({ name, category: 'route', action: 'create', type: 'route', reason: 'new' });
    } else if (existing.target !== desiredRoutes[name].target) {
      entries.push({ name, category: 'route', action: 'update', type: 'route', reason: 'target changed' });
    } else {
      entries.push({ name, category: 'route', action: 'unchanged', type: 'route' });
    }
  }

  for (const name of Object.keys(currentRoutes)) {
    if (!desiredRoutes[name]) {
      entries.push({
        name,
        category: 'route',
        action: 'delete',
        type: 'route',
        reason: 'removed from manifest',
      });
    }
  }

  // -- Summary --
  const summary = { create: 0, update: 0, delete: 0, unchanged: 0 };
  for (const entry of entries) {
    summary[entry.action]++;
  }

  return {
    entries,
    hasChanges: summary.create > 0 || summary.update > 0 || summary.delete > 0,
    summary,
  };
}

// ---------------------------------------------------------------------------
// computeWorkerDiff — post-build codeHash comparison
// ---------------------------------------------------------------------------

/**
 * Re-compute a single worker's diff entry with the actual codeHash.
 * Called after the build step produces a hash so we know whether code changed.
 */
export function computeWorkerDiff(
  workerName: string,
  newCodeHash: string,
  current: GroupState | null,
): DiffEntry {
  const existing = current?.workers?.[workerName];
  if (!existing) {
    return { name: workerName, category: 'worker', action: 'create', type: 'worker', reason: 'new' };
  }
  if (existing.codeHash !== newCodeHash) {
    return { name: workerName, category: 'worker', action: 'update', type: 'worker', reason: 'code changed' };
  }
  return { name: workerName, category: 'worker', action: 'unchanged', type: 'worker' };
}
