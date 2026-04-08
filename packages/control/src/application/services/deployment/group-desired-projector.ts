import { eq } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { groups } from '../../../infra/db/schema-groups.ts';
import type {
  AppCompute,
  AppManifest,
  AppStorage,
} from '../source/app-manifest-types.ts';
import type { Env } from '../../../shared/types/env.ts';
import { safeJsonParseOrDefault } from '../../../shared/utils/logger.ts';

type WorkloadCategory = 'worker' | 'container' | 'service';

type GroupRow = {
  id: string;
  name: string;
  appVersion: string | null;
  desiredSpecJson: string | null;
};

function categoryToKind(category: WorkloadCategory): AppCompute['kind'] {
  switch (category) {
    case 'worker':
      return 'worker';
    case 'service':
      return 'service';
    case 'container':
      return 'attached-container';
  }
}

function createEmptyManifest(group: GroupRow): AppManifest {
  return {
    name: group.name,
    ...(group.appVersion ? { version: group.appVersion } : {}),
    compute: {},
    storage: {},
    routes: [],
    publish: [],
    env: {},
    scopes: [],
  };
}

async function loadGroup(env: Env, groupId: string): Promise<GroupRow> {
  const db = getDb(env.DB);
  const group = await db.select({
    id: groups.id,
    name: groups.name,
    appVersion: groups.appVersion,
    desiredSpecJson: groups.desiredSpecJson,
  }).from(groups)
    .where(eq(groups.id, groupId))
    .get() as GroupRow | undefined;
  if (!group) {
    throw new Error(`Group "${groupId}" not found`);
  }
  return group;
}

async function saveManifest(env: Env, groupId: string, manifest: AppManifest): Promise<void> {
  const db = getDb(env.DB);
  await db.update(groups)
    .set({
      appVersion: manifest.version ?? null,
      desiredSpecJson: JSON.stringify(manifest),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(groups.id, groupId))
    .run();
}

/**
 * Load the desired manifest for a group, apply a mutator callback that
 * mutates it in place, and persist the result.
 *
 * The mutator is responsible for adjusting the flat manifest fields
 * (`compute`, `storage`, `publish`, etc.).
 */
async function mutateGroupManifest(
  env: Env,
  groupId: string,
  mutator: (manifest: AppManifest) => void,
): Promise<AppManifest> {
  const group = await loadGroup(env, groupId);
  const parsed = safeJsonParseOrDefault<AppManifest | null>(group.desiredSpecJson, null);
  const manifest = parsed ?? createEmptyManifest(group);
  // Backfill required fields in case the persisted blob was created before
  // the flat-schema cutover.
  manifest.compute ??= {};
  manifest.storage ??= {};
  manifest.routes ??= [];
  manifest.publish ??= [];
  manifest.env ??= {};
  manifest.scopes ??= [];
  mutator(manifest);
  await saveManifest(env, groupId, manifest);
  return manifest;
}

// ---------------------------------------------------------------------------
// Storage (resource) projections
// ---------------------------------------------------------------------------

export async function upsertGroupDesiredResource(
  env: Env,
  input: {
    groupId: string;
    name: string;
    resource: AppStorage;
  },
): Promise<AppManifest> {
  return mutateGroupManifest(env, input.groupId, (manifest) => {
    manifest.storage = {
      ...manifest.storage,
      [input.name]: {
        ...(manifest.storage[input.name] ?? {}),
        ...input.resource,
      },
    };
  });
}

export async function removeGroupDesiredResource(
  env: Env,
  input: {
    groupId: string;
    name: string;
  },
): Promise<AppManifest> {
  return mutateGroupManifest(env, input.groupId, (manifest) => {
    if (!manifest.storage[input.name]) return;
    delete manifest.storage[input.name];
  });
}

export async function renameGroupDesiredResource(
  env: Env,
  input: {
    groupId: string;
    fromName: string;
    toName: string;
  },
): Promise<AppManifest> {
  return mutateGroupManifest(env, input.groupId, (manifest) => {
    if (!manifest.storage[input.fromName] || input.fromName === input.toName) return;
    manifest.storage = {
      ...manifest.storage,
      [input.toName]: manifest.storage[input.fromName],
    };
    delete manifest.storage[input.fromName];
  });
}

// ---------------------------------------------------------------------------
// Workload (compute) projections
// ---------------------------------------------------------------------------

function upsertWorkloadRecord(
  manifest: AppManifest,
  category: WorkloadCategory,
  name: string,
  workload: AppCompute,
): void {
  const kind = categoryToKind(category);
  const existing = manifest.compute[name];
  manifest.compute = {
    ...manifest.compute,
    [name]: {
      ...(existing ?? {}),
      ...workload,
      kind,
    },
  };
}

function removeWorkloadRecord(
  manifest: AppManifest,
  _category: WorkloadCategory,
  name: string,
): void {
  if (!manifest.compute[name]) return;
  delete manifest.compute[name];
}

export async function upsertGroupDesiredWorkload(
  env: Env,
  input: {
    groupId: string;
    category: WorkloadCategory;
    name: string;
    workload: AppCompute;
  },
): Promise<AppManifest> {
  return mutateGroupManifest(env, input.groupId, (manifest) => {
    upsertWorkloadRecord(manifest, input.category, input.name, input.workload);
  });
}

export async function removeGroupDesiredWorkload(
  env: Env,
  input: {
    groupId: string;
    category: WorkloadCategory;
    name: string;
  },
): Promise<AppManifest> {
  return mutateGroupManifest(env, input.groupId, (manifest) => {
    removeWorkloadRecord(manifest, input.category, input.name);
  });
}

export async function renameGroupDesiredWorkload(
  env: Env,
  input: {
    groupId: string;
    category: WorkloadCategory;
    fromName: string;
    toName: string;
  },
): Promise<AppManifest> {
  return mutateGroupManifest(env, input.groupId, (manifest) => {
    if (input.fromName === input.toName) return;
    if (!manifest.compute[input.fromName]) return;
    manifest.compute = {
      ...manifest.compute,
      [input.toName]: manifest.compute[input.fromName],
    };
    delete manifest.compute[input.fromName];
  });
}
