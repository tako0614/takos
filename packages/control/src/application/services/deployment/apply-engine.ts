/**
 * Apply engine for the control plane.
 *
 * Receives an AppManifest and a group ID, computes the diff against
 * current DB state, and executes entity operations to reconcile.
 *
 * This is the CP equivalent of the CLI's coordinator.ts + diff.ts
 * combined into a single orchestration module.
 *
 * Runs inside Cloudflare Workers -- no subprocess / wrangler CLI available.
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { groups, groupEntities } from '../../../infra/db/schema-groups.ts';
import type { AppManifest, AppResource } from './group-deploy-manifest.ts';
import {
  computeDiff,
  type DiffResult,
  type DiffEntry,
  type GroupState,
  type ResourceStateRecord,
  type WorkerStateRecord,
  type ContainerStateRecord,
  type ServiceStateRecord,
  type RouteStateRecord,
} from './diff.ts';
import {
  createResource,
  deleteResource,
} from '../entities/resource-ops.ts';
import {
  deployWorker,
  deleteWorker,
} from '../entities/worker-ops.ts';
import {
  deployContainer,
  deleteContainer,
} from '../entities/container-ops.ts';
import {
  deployService,
  deleteService,
} from '../entities/service-ops.ts';
import type { Env } from '../../../shared/types/env.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ApplyEntryResult {
  name: string;
  category: string;
  action: string;
  status: 'success' | 'failed';
  error?: string;
}

export interface ApplyResult {
  groupId: string;
  applied: ApplyEntryResult[];
  skipped: string[];
  diff: DiffResult;
}

export interface ApplyManifestOpts {
  /** Filter to specific entity names. If omitted, apply all. */
  target?: string[];
  /** Skip confirmation prompt (relevant for CLI callers; always true in CP). */
  autoApprove?: boolean;
  /** Group name override (defaults to manifest.metadata.name). */
  groupName?: string;
  /** Environment name (staging, production, etc.). */
  envName?: string;
  /** Dispatch namespace for workers. */
  dispatchNamespace?: string;
  /** If true, stop processing on first failure. */
  rollbackOnFailure?: boolean;
}

// ---------------------------------------------------------------------------
// getGroupState — reconstruct GroupState from DB
// ---------------------------------------------------------------------------

/**
 * Build a GroupState object from the groups + group_entities tables.
 * Returns null if the group has no entities yet (first deploy).
 */
export async function getGroupState(
  env: Env,
  groupId: string,
): Promise<GroupState | null> {
  const db = getDb(env.DB);

  // Fetch group metadata
  const groupRows = await db
    .select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  if (groupRows.length === 0) {
    return null;
  }

  const group = groupRows[0];

  // Fetch all entities for this group
  const entityRows = await db
    .select()
    .from(groupEntities)
    .where(eq(groupEntities.groupId, groupId));

  if (entityRows.length === 0) {
    return null;
  }

  const resources: Record<string, ResourceStateRecord> = {};
  const workers: Record<string, WorkerStateRecord> = {};
  const containers: Record<string, ContainerStateRecord> = {};
  const services: Record<string, ServiceStateRecord> = {};
  const routes: Record<string, RouteStateRecord> = {};

  for (const row of entityRows) {
    const config = JSON.parse(row.config) as Record<string, unknown>;

    switch (row.category) {
      case 'resource':
        resources[row.name] = {
          type: (config.type as string) ?? '',
          id: (config.cfResourceId as string) ?? '',
          binding: (config.binding as string) ?? '',
          createdAt: row.createdAt,
        };
        break;

      case 'worker':
        workers[row.name] = {
          scriptName: (config.scriptName as string) ?? '',
          deployedAt: (config.deployedAt as string) ?? row.updatedAt,
          codeHash: (config.codeHash as string) ?? '',
        };
        break;

      case 'container':
        containers[row.name] = {
          deployedAt: (config.deployedAt as string) ?? row.updatedAt,
          imageHash: (config.imageHash as string) ?? '',
        };
        break;

      case 'service':
        services[row.name] = {
          deployedAt: (config.deployedAt as string) ?? row.updatedAt,
          imageHash: (config.imageHash as string) ?? '',
        };
        break;

      case 'route':
        routes[row.name] = {
          target: (config.target as string) ?? '',
          path: config.path as string | undefined,
          domain: config.domain as string | undefined,
          url: config.url as string | undefined,
        };
        break;
    }
  }

  return {
    groupId,
    groupName: group.name,
    provider: group.provider ?? 'cloudflare',
    env: group.env ?? 'default',
    updatedAt: group.updatedAt,
    resources,
    workers,
    containers,
    services,
    routes,
  };
}

// ---------------------------------------------------------------------------
// Overrides — env-specific deep merge
// ---------------------------------------------------------------------------

function applyOverrides(manifest: AppManifest, envName: string): AppManifest {
  const specAny = manifest.spec as Record<string, unknown>;
  const overrides = specAny.overrides as Record<string, Record<string, unknown>> | undefined;

  if (!overrides?.[envName]) return manifest;

  const envOverride = overrides[envName];
  const mergedSpec = deepMerge(specAny, envOverride) as AppManifest['spec'];

  // Remove consumed overrides key
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

    if (isPlainObject(baseVal) && isPlainObject(patchVal)) {
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
// Topological sort — DFS-based (mirrors CLI coordinator)
// ---------------------------------------------------------------------------

const CATEGORY_PRIORITY: Record<string, number> = {
  resource: 0,
  container: 1,
  worker: 2,
  service: 3,
  route: 4,
};

function topologicalSort(entries: DiffEntry[], manifest: AppManifest): DiffEntry[] {
  const specAny = manifest.spec as Record<string, unknown>;
  const dependsOnMap = buildDependsOnMap(specAny);

  const deletes = entries.filter((e) => e.action === 'delete');
  const nonDeletes = entries.filter((e) => e.action !== 'delete');

  const sortedNonDeletes = topoSortDFS(nonDeletes, dependsOnMap);
  const sortedDeletes = topoSortDFS(deletes, dependsOnMap).reverse();

  return [...sortedNonDeletes, ...sortedDeletes];
}

function buildDependsOnMap(spec: Record<string, unknown>): Map<string, string[]> {
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

function topoSortDFS(entries: DiffEntry[], dependsOnMap: Map<string, string[]>): DiffEntry[] {
  const entryByName = new Map(entries.map((e) => [e.name, e]));
  const visited = new Set<string>();
  const result: DiffEntry[] = [];

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
// Entry dispatcher — calls entity operations
// ---------------------------------------------------------------------------

async function executeEntry(
  entry: DiffEntry,
  manifest: AppManifest,
  env: Env,
  groupId: string,
  opts: ApplyManifestOpts,
): Promise<void> {
  const { name, category, action } = entry;
  const specAny = manifest.spec as Record<string, unknown>;

  switch (category) {
    case 'resource': {
      const resources = (specAny.resources ?? {}) as Record<string, AppResource>;
      if (action === 'create') {
        const resource = resources[name];
        if (!resource) throw new Error(`Resource "${name}" not found in manifest`);
        await createResource(env, groupId, name, {
          type: resource.type,
          binding: resource.binding,
          groupName: opts.groupName,
          envName: opts.envName,
        });
      }
      if (action === 'delete') {
        await deleteResource(env, groupId, name);
      }
      break;
    }

    case 'worker': {
      if (action === 'create' || action === 'update') {
        await deployWorker(env, groupId, name, {
          groupName: opts.groupName,
          envName: opts.envName,
          dispatchNamespace: opts.dispatchNamespace,
        });
      }
      if (action === 'delete') {
        await deleteWorker(env, groupId, name);
      }
      break;
    }

    case 'container': {
      const containers = (specAny.containers ?? {}) as Record<
        string,
        { imageRef?: string; port?: number }
      >;
      if (action === 'create' || action === 'update') {
        const container = containers[name];
        await deployContainer(env, groupId, name, {
          imageRef: container?.imageRef,
          port: container?.port ?? 8080,
        });
      }
      if (action === 'delete') {
        await deleteContainer(env, groupId, name);
      }
      break;
    }

    case 'service': {
      const services = (specAny.services ?? {}) as Record<
        string,
        { imageRef?: string; port?: number }
      >;
      if (action === 'create' || action === 'update') {
        const service = services[name];
        await deployService(env, groupId, name, {
          imageRef: service?.imageRef,
          port: service?.port ?? 8080,
        });
      }
      if (action === 'delete') {
        await deleteService(env, groupId, name);
      }
      break;
    }

    case 'route': {
      // Route operations are handled as part of the routing module
      // (deployment/routing.ts). For now, route diff entries are
      // logged but actual route configuration is deferred to the
      // routing layer which manages CF custom domains and hostname routing.
      // TODO: Wire route create/update/delete to routing.ts
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// saveManifestToGroup — persist manifest JSON on the group row
// ---------------------------------------------------------------------------

async function saveManifestToGroup(
  env: Env,
  groupId: string,
  manifest: AppManifest,
): Promise<void> {
  const db = getDb(env.DB);

  await db
    .update(groups)
    .set({
      manifestJson: JSON.stringify(manifest),
      appVersion: manifest.spec.version,
    })
    .where(eq(groups.id, groupId));
}

// ---------------------------------------------------------------------------
// applyManifest — main entry point
// ---------------------------------------------------------------------------

/**
 * Apply an AppManifest to a group.
 *
 * Steps:
 * 1. Load current state from DB
 * 2. Compute diff
 * 3. Apply overrides for the target environment
 * 4. Topological sort (dependsOn + default category ordering)
 * 5. Execute each entry via entity operations
 * 6. Save manifest to group row
 * 7. Return results
 */
export async function applyManifest(
  env: Env,
  groupId: string,
  manifest: AppManifest,
  opts: ApplyManifestOpts = {},
): Promise<ApplyResult> {
  // 1. Load current state
  const state = await getGroupState(env, groupId);

  // 2. Apply env overrides
  const resolved = applyOverrides(manifest, opts.envName ?? 'default');

  // 3. Compute diff
  const diff = computeDiff(resolved, state);

  // 4. Filter by target if specified
  let entries = diff.entries;
  if (opts.target && opts.target.length > 0) {
    const targetSet = new Set(opts.target);
    entries = entries.filter((e) => targetSet.has(e.name));
  }

  // 5. Topological sort
  const ordered = topologicalSort(entries, resolved);

  // 6. Execute
  const result: ApplyResult = {
    groupId,
    applied: [],
    skipped: [],
    diff,
  };

  for (const entry of ordered) {
    if (entry.action === 'unchanged') {
      result.skipped.push(entry.name);
      continue;
    }

    try {
      await executeEntry(entry, resolved, env, groupId, opts);
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
        error: error instanceof Error ? error.message : String(error),
      });

      if (opts.rollbackOnFailure) {
        break;
      }
    }
  }

  // 7. Save manifest to group
  try {
    await saveManifestToGroup(env, groupId, resolved);
  } catch (error) {
    console.warn('Failed to save manifest to group:', error);
  }

  return result;
}

// ---------------------------------------------------------------------------
// planManifest — dry-run: compute diff without executing
// ---------------------------------------------------------------------------

/**
 * Compute the diff for a manifest against the current group state
 * without executing any operations. Useful for "plan" / dry-run.
 */
export async function planManifest(
  env: Env,
  groupId: string,
  manifest: AppManifest,
  opts: { envName?: string } = {},
): Promise<DiffResult> {
  const state = await getGroupState(env, groupId);
  const resolved = applyOverrides(manifest, opts.envName ?? 'default');
  return computeDiff(resolved, state);
}
