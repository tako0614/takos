/**
 * Canonical group reconciler for the control plane.
 *
 * `.takos/app.yml` is compiled into `GroupDesiredState`, diffed against
 * canonical resources/services state, then reconciled through provider ops.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { groups } from '../../../infra/db/schema-groups.ts';
import type { AppManifest } from '../source/app-manifest-types.ts';
import {
  compileGroupDesiredState,
  materializeRoute,
  materializeRoutes,
  type GroupDesiredState,
  type ObservedGroupState,
} from './group-state.ts';
import {
  computeDiff,
  type DiffEntry,
  type DiffResult,
  type GroupState,
} from './diff.ts';
import {
  createResource,
  deleteResource,
  listResources,
  updateManagedResource,
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
import { listGroupManagedServices } from '../entities/group-managed-services.ts';
import { safeJsonParseOrDefault } from '../../../shared/utils/logger.ts';
import type { Env } from '../../../shared/types/env.ts';

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
  target?: string[];
  autoApprove?: boolean;
  groupName?: string;
  envName?: string;
  dispatchNamespace?: string;
  rollbackOnFailure?: boolean;
}

type GroupRow = {
  id: string;
  spaceId: string;
  name: string;
  provider: string | null;
  env: string | null;
  appVersion: string | null;
  manifestJson: string | null;
  desiredSpecJson: string | null;
  observedStateJson: string | null;
  providerStateJson: string | null;
  reconcileStatus: string;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

async function getGroupRecord(env: Env, groupId: string): Promise<GroupRow | null> {
  const db = getDb(env.DB);
  return db.select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .get() as Promise<GroupRow | null>;
}

function loadObservedRoutes(group: GroupRow): Record<string, ObservedGroupState['routes'][string]> {
  const parsed = safeJsonParseOrDefault<Partial<ObservedGroupState>>(group.observedStateJson, {});
  return parsed.routes ?? {};
}

export async function getGroupState(
  env: Env,
  groupId: string,
): Promise<GroupState | null> {
  const group = await getGroupRecord(env, groupId);
  if (!group) return null;

  const resourceRows = await listResources(env, groupId);
  const serviceRows = await listGroupManagedServices(env, groupId);
  const routes = loadObservedRoutes(group);

  const resources = Object.fromEntries(
    resourceRows.map((row) => [
      row.name,
      {
        name: row.name,
        type: row.config.type,
        resourceId: row.config.cfResourceId,
        binding: row.config.binding,
        status: 'active',
        ...(row.config.cfName ? { cfName: row.config.cfName } : {}),
        ...(row.config.specFingerprint ? { specFingerprint: row.config.specFingerprint } : {}),
        updatedAt: row.updatedAt,
      },
    ]),
  );

  const workloads = Object.fromEntries(
    serviceRows
      .filter((record) => record.config.componentKind && record.config.manifestName)
      .map((record) => [
        record.config.manifestName as string,
        {
          serviceId: record.row.id,
          name: record.config.manifestName as string,
          category: record.config.componentKind as 'worker' | 'container' | 'service',
          status: record.row.status,
          ...(record.row.hostname ? { hostname: record.row.hostname } : {}),
          ...(record.row.routeRef ? { routeRef: record.row.routeRef } : {}),
          ...(record.row.workloadKind ? { workloadKind: record.row.workloadKind } : {}),
          ...(record.config.specFingerprint ? { specFingerprint: record.config.specFingerprint } : {}),
          ...(record.config.deployedAt ? { deployedAt: record.config.deployedAt } : {}),
          ...(record.config.codeHash ? { codeHash: record.config.codeHash } : {}),
          ...(record.config.imageHash ? { imageHash: record.config.imageHash } : {}),
          ...(record.config.imageRef ? { imageRef: record.config.imageRef } : {}),
          ...(typeof record.config.port === 'number' ? { port: record.config.port } : {}),
          ...(record.config.ipv4 ? { ipv4: record.config.ipv4 } : {}),
          ...(record.config.dispatchNamespace ? { dispatchNamespace: record.config.dispatchNamespace } : {}),
          ...(record.config.resolvedBaseUrl ? { resolvedBaseUrl: record.config.resolvedBaseUrl } : {}),
          updatedAt: record.row.updatedAt,
        },
      ]),
  );

  if (Object.keys(resources).length === 0 && Object.keys(workloads).length === 0 && Object.keys(routes).length === 0) {
    return null;
  }

  return {
    groupId,
    groupName: group.name,
    provider: group.provider ?? 'cloudflare',
    env: group.env ?? 'default',
    version: group.appVersion,
    updatedAt: group.updatedAt,
    resources,
    workloads,
    routes,
  };
}

const CATEGORY_PRIORITY: Record<string, number> = {
  resource: 0,
  container: 1,
  worker: 2,
  service: 3,
  route: 4,
};

function topologicalSort(entries: DiffEntry[], desiredState: GroupDesiredState): DiffEntry[] {
  const dependsOnMap = new Map<string, string[]>();
  for (const [name, workload] of Object.entries(desiredState.workloads)) {
    if (workload.dependsOn.length > 0) {
      dependsOnMap.set(name, workload.dependsOn);
    }
  }

  const deletes = entries.filter((entry) => entry.action === 'delete');
  const nonDeletes = entries.filter((entry) => entry.action !== 'delete');
  const sortedNonDeletes = topoSortDFS(nonDeletes, dependsOnMap);
  const sortedDeletes = topoSortDFS(deletes, dependsOnMap).reverse();
  return [...sortedNonDeletes, ...sortedDeletes];
}

function topoSortDFS(entries: DiffEntry[], dependsOnMap: Map<string, string[]>): DiffEntry[] {
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
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

async function executeEntry(
  entry: DiffEntry,
  desiredState: GroupDesiredState,
  env: Env,
  groupId: string,
  group: GroupRow,
  opts: ApplyManifestOpts,
): Promise<void> {
  const groupName = opts.groupName ?? group.name;
  const envName = opts.envName ?? group.env ?? 'default';
  const spaceId = group.spaceId;

  switch (entry.category) {
    case 'resource': {
      const resource = desiredState.resources[entry.name];
      if (entry.action === 'create') {
        if (!resource) throw new Error(`Resource "${entry.name}" not found in desired state`);
        await createResource(env, groupId, entry.name, {
          type: resource.type,
          binding: resource.binding,
          groupName,
          envName,
          spaceId,
          specFingerprint: resource.specFingerprint,
        });
      }
      if (entry.action === 'update') {
        if (!resource) throw new Error(`Resource "${entry.name}" not found in desired state`);
        await updateManagedResource(env, groupId, entry.name, {
          binding: resource.binding,
          specFingerprint: resource.specFingerprint,
        });
      }
      if (entry.action === 'delete') {
        await deleteResource(env, groupId, entry.name);
      }
      break;
    }

    case 'worker': {
      const workload = desiredState.workloads[entry.name];
      if ((entry.action === 'create' || entry.action === 'update') && workload) {
        await deployWorker(env, groupId, entry.name, {
          spaceId,
          groupName,
          envName,
          dispatchNamespace: opts.dispatchNamespace,
          specFingerprint: workload.specFingerprint,
          desiredSpec: workload.spec as Record<string, unknown>,
          routeNames: workload.routeNames,
          dependsOn: workload.dependsOn,
        });
      }
      if (entry.action === 'delete') {
        await deleteWorker(env, groupId, entry.name);
      }
      break;
    }

    case 'container': {
      const workload = desiredState.workloads[entry.name];
      if ((entry.action === 'create' || entry.action === 'update') && workload && workload.category === 'container') {
        const spec = workload.spec as { imageRef?: string; port?: number };
        await deployContainer(env, groupId, entry.name, {
          spaceId,
          envName,
          imageRef: spec.imageRef,
          port: spec.port ?? 8080,
          specFingerprint: workload.specFingerprint,
          desiredSpec: workload.spec as Record<string, unknown>,
          routeNames: workload.routeNames,
          dependsOn: workload.dependsOn,
        });
      }
      if (entry.action === 'delete') {
        await deleteContainer(env, groupId, entry.name);
      }
      break;
    }

    case 'service': {
      const workload = desiredState.workloads[entry.name];
      if ((entry.action === 'create' || entry.action === 'update') && workload && workload.category === 'service') {
        const spec = workload.spec as { imageRef?: string; port?: number };
        await deployService(env, groupId, entry.name, {
          spaceId,
          envName,
          imageRef: spec.imageRef,
          port: spec.port ?? 8080,
          specFingerprint: workload.specFingerprint,
          desiredSpec: workload.spec as Record<string, unknown>,
          routeNames: workload.routeNames,
          dependsOn: workload.dependsOn,
        });
      }
      if (entry.action === 'delete') {
        await deleteService(env, groupId, entry.name);
      }
      break;
    }

    case 'route':
      break;
  }
}

function buildFinalRoutes(
  desiredState: GroupDesiredState,
  currentRoutes: Record<string, ObservedGroupState['routes'][string]>,
  workloads: Record<string, ObservedGroupState['workloads'][string]>,
  targetNames?: string[],
  updatedAt?: string,
): Record<string, ObservedGroupState['routes'][string]> {
  if (!targetNames || targetNames.length === 0) {
    return materializeRoutes(desiredState.routes, workloads, updatedAt);
  }

  const nextRoutes = { ...currentRoutes };
  const targetSet = new Set(targetNames);

  for (const name of targetSet) {
    const route = desiredState.routes[name];
    if (route) {
      nextRoutes[name] = materializeRoute(route, workloads, updatedAt);
    } else {
      delete nextRoutes[name];
    }
  }

  return nextRoutes;
}

async function saveGroupSnapshots(
  env: Env,
  groupId: string,
  desiredState: GroupDesiredState,
  observedState: ObservedGroupState,
  status: 'ready' | 'degraded',
): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const current = await getGroupRecord(env, groupId);

  await db.update(groups)
    .set({
      appVersion: desiredState.version,
      provider: desiredState.provider,
      env: desiredState.env,
      manifestJson: JSON.stringify(desiredState.manifest),
      desiredSpecJson: JSON.stringify(desiredState),
      observedStateJson: JSON.stringify(observedState),
      providerStateJson: current?.providerStateJson ?? '{}',
      reconcileStatus: status,
      lastAppliedAt: now,
      updatedAt: now,
    })
    .where(eq(groups.id, groupId))
    .run();
}

export async function applyManifest(
  env: Env,
  groupId: string,
  manifest: AppManifest,
  opts: ApplyManifestOpts = {},
): Promise<ApplyResult> {
  const group = await getGroupRecord(env, groupId);
  if (!group) {
    throw new Error(`Group "${groupId}" not found`);
  }

  const desiredState = compileGroupDesiredState(manifest, {
    groupName: opts.groupName ?? group.name,
    provider: group.provider ?? 'cloudflare',
    envName: opts.envName ?? group.env ?? 'default',
  });
  const currentState = await getGroupState(env, groupId);
  const diff = computeDiff(desiredState, currentState);

  let entries = diff.entries;
  if (opts.target && opts.target.length > 0) {
    const targetSet = new Set(opts.target);
    entries = entries.filter((entry) => targetSet.has(entry.name));
  }

  const ordered = topologicalSort(entries, desiredState);

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
      await executeEntry(entry, desiredState, env, groupId, group, opts);
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

  const refreshedState = await getGroupState(env, groupId);
  const now = new Date().toISOString();
  const workloads = refreshedState?.workloads ?? {};
  const currentRoutes = currentState?.routes ?? {};
  const finalRoutes = buildFinalRoutes(
    desiredState,
    currentRoutes,
    workloads,
    opts.target,
    now,
  );
  const observedState: ObservedGroupState = {
    groupId,
    groupName: desiredState.groupName,
    provider: desiredState.provider,
    env: desiredState.env,
    version: desiredState.version,
    updatedAt: now,
    resources: refreshedState?.resources ?? {},
    workloads,
    routes: finalRoutes,
  };

  const hasFailures = result.applied.some((entry) => entry.status === 'failed');
  await saveGroupSnapshots(env, groupId, desiredState, observedState, hasFailures ? 'degraded' : 'ready');

  return result;
}

export async function planManifest(
  env: Env,
  groupId: string,
  manifest: AppManifest,
  opts: { envName?: string } = {},
): Promise<DiffResult> {
  const group = await getGroupRecord(env, groupId);
  if (!group) {
    throw new Error(`Group "${groupId}" not found`);
  }

  const desiredState = compileGroupDesiredState(manifest, {
    groupName: group.name,
    provider: group.provider ?? 'cloudflare',
    envName: opts.envName ?? group.env ?? 'default',
  });
  const currentState = await getGroupState(env, groupId);
  return computeDiff(desiredState, currentState);
}
