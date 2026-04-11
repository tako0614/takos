import { eq } from "drizzle-orm";
import { getDb } from "../../../infra/db/client.ts";
import { groups } from "../../../infra/db/schema-groups.ts";
import type { AppCompute, AppManifest } from "../source/app-manifest-types.ts";
import type { Env } from "../../../shared/types/env.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/logger.ts";

type WorkloadCategory = "worker" | "container" | "service";

type GroupRow = {
  id: string;
  name: string;
  appVersion: string | null;
  desiredSpecJson: string | null;
};

function categoryToKind(category: WorkloadCategory): AppCompute["kind"] {
  switch (category) {
    case "worker":
      return "worker";
    case "service":
      return "service";
    case "container":
      return "attached-container";
  }
}

function createEmptyManifest(group: GroupRow): AppManifest {
  return {
    name: group.name,
    ...(group.appVersion ? { version: group.appVersion } : {}),
    compute: {},
    routes: [],
    publish: [],
    env: {},
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

async function saveManifest(
  env: Env,
  groupId: string,
  manifest: AppManifest,
): Promise<void> {
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
 * (`compute`, `publish`, etc.).
 */
async function mutateGroupManifest(
  env: Env,
  groupId: string,
  mutator: (manifest: AppManifest) => void,
): Promise<AppManifest> {
  const group = await loadGroup(env, groupId);
  const parsed = safeJsonParseOrDefault<AppManifest | null>(
    group.desiredSpecJson,
    null,
  );
  const manifest = parsed ?? createEmptyManifest(group);
  // Backfill required fields in case the persisted blob was created before
  // the flat-schema cutover.
  manifest.compute ??= {};
  manifest.routes ??= [];
  manifest.publish ??= [];
  manifest.env ??= {};
  mutator(manifest);
  await saveManifest(env, groupId, manifest);
  return manifest;
}

// ---------------------------------------------------------------------------
// Resource projections
// ---------------------------------------------------------------------------

// Resource CRUD remains available as a platform API, but it no longer mutates
// the app manifest. Publication/consume is now the only deploy substrate.

export async function upsertGroupDesiredResource(
  env: Env,
  input: {
    groupId: string;
    name: string;
    resource: unknown;
  },
): Promise<AppManifest> {
  void input.name;
  void input.resource;
  return mutateGroupManifest(env, input.groupId, () => {});
}

export async function removeGroupDesiredResource(
  env: Env,
  input: {
    groupId: string;
    name: string;
  },
): Promise<AppManifest> {
  void input.name;
  return mutateGroupManifest(env, input.groupId, () => {});
}

export async function renameGroupDesiredResource(
  env: Env,
  input: {
    groupId: string;
    fromName: string;
    toName: string;
  },
): Promise<AppManifest> {
  void input.fromName;
  void input.toName;
  return mutateGroupManifest(env, input.groupId, () => {});
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
