/**
 * Apply coordinator — Layer 2 dispatcher.
 *
 * Receives a DiffResult and AppManifest, then delegates each entry
 * to the appropriate Layer 1 entity operation (resource / worker /
 * container / service).  Handles overrides, topological ordering,
 * lifecycle hooks, and rollback-on-failure.
 *
 * The coordinator itself does NOT contain business logic for
 * provisioning or deploying; it only orchestrates calls to
 * `lib/entities/*`.
 */

import { createResource, deleteResource } from '../entities/resource.js';
import type { ResourceType } from '../entities/resource.js';
import { deployWorker, deleteWorker } from '../entities/worker.js';
import { deployContainer, deleteContainer } from '../entities/container.js';
import { deployService, deleteService } from '../entities/service.js';
import type { DiffResult, DiffEntry } from '../state/diff.js';
import type { AppManifest } from '../app-manifest.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ApplyOpts {
  group: string;
  env: string;
  accountId: string;
  apiToken: string;
  groupName?: string;
  namespace?: string;
  manifestDir?: string;
  baseDomain?: string;
  autoApprove?: boolean;
}

export interface ApplyEntryResult {
  name: string;
  category: string;
  action: string;
  status: 'success' | 'failed';
  error?: string;
}

export interface ApplyResult {
  applied: ApplyEntryResult[];
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function applyDiff(
  diff: DiffResult,
  manifest: AppManifest,
  opts: ApplyOpts,
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], skipped: [] };

  // 1. overrides (env-specific partial merge)
  const resolved = applyOverrides(manifest, opts.env);

  // 2. lifecycle.preApply
  const specAny = resolved.spec as Record<string, unknown>;
  const lifecycle = specAny.lifecycle as
    | { preApply?: LifecycleHook; postApply?: LifecycleHook }
    | undefined;

  if (lifecycle?.preApply) {
    await runLifecycleHook(lifecycle.preApply, opts);
  }

  // 3. topological sort (respects dependsOn + default category ordering)
  const ordered = topologicalSort(diff.entries, resolved);

  // 4. execute each entry sequentially
  const update = specAny.update as { rollbackOnFailure?: boolean } | undefined;

  for (const entry of ordered) {
    if (entry.action === 'unchanged') {
      result.skipped.push(entry.name);
      continue;
    }

    try {
      await executeEntry(entry, resolved, opts);
      result.applied.push({
        name: entry.name,
        category: entry.category,
        action: entry.action,
        status: 'success',
      });
    } catch (error) {
      result.applied.push({
        name: entry.name,
        category: entry.category,
        action: entry.action,
        status: 'failed',
        error: String(error),
      });

      if (update?.rollbackOnFailure) {
        // stop processing; caller may inspect partial results
        break;
      }
    }
  }

  // 5. template variable injection
  const envSpec = specAny.env as { inject?: Record<string, string> } | undefined;
  if (envSpec?.inject) {
    await resolveAndInjectTemplates(resolved, opts);
  }

  // 6. lifecycle.postApply
  if (lifecycle?.postApply) {
    await runLifecycleHook(lifecycle.postApply, opts);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Entry dispatcher — calls Layer 1 entities
// ---------------------------------------------------------------------------

async function executeEntry(
  entry: DiffEntry,
  manifest: AppManifest,
  opts: ApplyOpts,
): Promise<void> {
  const { name, category, action } = entry;
  const specAny = manifest.spec as Record<string, unknown>;

  switch (category) {
    case 'resource': {
      const resources = (specAny.resources ?? {}) as Record<string, { type: ResourceType }>;
      if (action === 'create') {
        await createResource(name, { type: resources[name]!.type, ...opts });
      }
      if (action === 'delete') {
        await deleteResource(name, opts);
      }
      break;
    }

    case 'worker': {
      if (action === 'create' || action === 'update') {
        await deployWorker(name, { ...opts });
      }
      if (action === 'delete') {
        await deleteWorker(name, opts);
      }
      break;
    }

    case 'container': {
      const containers = (specAny.containers ?? {}) as Record<
        string,
        { dockerfile: string; port?: number }
      >;
      if (action === 'create' || action === 'update') {
        const container = containers[name]!;
        await deployContainer(name, {
          dockerfile: container.dockerfile,
          port: container.port ?? 8080,
          ...opts,
        });
      }
      if (action === 'delete') {
        await deleteContainer(name, opts);
      }
      break;
    }

    case 'service': {
      const services = (specAny.services ?? {}) as Record<
        string,
        { dockerfile: string; port?: number }
      >;
      if (action === 'create' || action === 'update') {
        const service = services[name]!;
        await deployService(name, {
          dockerfile: service.dockerfile,
          port: service.port ?? 8080,
          ...opts,
        });
      }
      if (action === 'delete') {
        await deleteService(name, opts);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Overrides — env-specific deep merge (no lodash)
// ---------------------------------------------------------------------------

function applyOverrides(manifest: AppManifest, env: string): AppManifest {
  const specAny = manifest.spec as Record<string, unknown>;
  const overrides = specAny.overrides as Record<string, Record<string, unknown>> | undefined;

  if (!overrides?.[env]) return manifest;

  const envOverride = overrides[env];
  const mergedSpec = deepMerge(specAny, envOverride) as AppManifest['spec'];

  // Remove the overrides key from the resolved spec — it has been consumed.
  delete (mergedSpec as Record<string, unknown>).overrides;

  return { ...manifest, spec: mergedSpec };
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(patch)) {
    const baseVal = base[key];
    const patchVal = patch[key];

    if (
      isPlainObject(baseVal) &&
      isPlainObject(patchVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        patchVal as Record<string, unknown>,
      );
    } else {
      result[key] = patchVal;
    }
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Topological sort — DFS-based
// ---------------------------------------------------------------------------

/** Default priority by category (lower = earlier in create order). */
const CATEGORY_PRIORITY: Record<string, number> = {
  resource: 0,
  container: 1,
  worker: 2,
  service: 3,
  route: 4,
};

function topologicalSort(entries: DiffEntry[], manifest: AppManifest): DiffEntry[] {
  const specAny = manifest.spec as Record<string, unknown>;

  // Build an adjacency list from dependsOn declarations across all categories.
  const dependsOnMap = buildDependsOnMap(specAny);

  // Partition into deletes vs non-deletes; deletes are processed in reverse order.
  const deletes = entries.filter((e) => e.action === 'delete');
  const nonDeletes = entries.filter((e) => e.action !== 'delete');

  const sortedNonDeletes = topoSortDFS(nonDeletes, dependsOnMap);
  const sortedDeletes = topoSortDFS(deletes, dependsOnMap).reverse();

  return [...sortedNonDeletes, ...sortedDeletes];
}

/** Collect dependsOn edges from workers, containers, services definitions. */
function buildDependsOnMap(
  spec: Record<string, unknown>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const categories = ['workers', 'containers', 'services'] as const;

  for (const cat of categories) {
    const defs = (spec[cat] ?? {}) as Record<string, Record<string, unknown>>;
    for (const [name, def] of Object.entries(defs)) {
      const deps = def.dependsOn;
      if (Array.isArray(deps)) {
        map.set(name, deps as string[]);
      }
    }
  }

  return map;
}

/** DFS topological sort.  Falls back to category priority for unrelated nodes. */
function topoSortDFS(
  entries: DiffEntry[],
  dependsOnMap: Map<string, string[]>,
): DiffEntry[] {
  const entryByName = new Map(entries.map((e) => [e.name, e]));
  const visited = new Set<string>();
  const result: DiffEntry[] = [];

  // Sort by category priority first so that unrelated nodes come out in
  // a predictable order (resource -> container -> worker -> service).
  const sorted = [...entries].sort(
    (a, b) => (CATEGORY_PRIORITY[a.category] ?? 99) - (CATEGORY_PRIORITY[b.category] ?? 99),
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

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

type LifecycleHook = string | string[];

async function runLifecycleHook(
  _hook: LifecycleHook,
  _opts: ApplyOpts,
): Promise<void> {
  throw new Error(
    'runLifecycleHook is not yet implemented. Lifecycle hooks (preApply / postApply) cannot be executed.',
  );
}

// ---------------------------------------------------------------------------
// Template injection
// ---------------------------------------------------------------------------

async function resolveAndInjectTemplates(
  _manifest: AppManifest,
  _opts: ApplyOpts,
): Promise<void> {
  throw new Error(
    'resolveAndInjectTemplates is not yet implemented. Template variable injection (e.g. {{ baseDomain }}) is not available.',
  );
}
