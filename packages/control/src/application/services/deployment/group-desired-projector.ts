import { eq } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { groups } from '../../../infra/db/schema-groups.ts';
import type {
  AppContainer,
  AppManifest,
  AppResource,
  AppService,
  AppWorker,
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

function createEmptyManifest(group: GroupRow): AppManifest {
  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'App',
    metadata: {
      name: group.name,
    },
    spec: {
      version: group.appVersion ?? '0.0.0',
    },
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
      appVersion: manifest.spec.version ?? null,
      desiredSpecJson: JSON.stringify(manifest),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(groups.id, groupId))
    .run();
}

async function mutateGroupManifest(
  env: Env,
  groupId: string,
  mutator: (manifest: AppManifest) => void,
): Promise<AppManifest> {
  const group = await loadGroup(env, groupId);
  const manifest = safeJsonParseOrDefault<AppManifest | null>(group.desiredSpecJson, null) ?? createEmptyManifest(group);
  mutator(manifest);
  await saveManifest(env, groupId, manifest);
  return manifest;
}

export async function upsertGroupDesiredResource(
  env: Env,
  input: {
    groupId: string;
    name: string;
    resource: AppResource;
  },
): Promise<AppManifest> {
  return mutateGroupManifest(env, input.groupId, (manifest) => {
    manifest.spec.resources = {
      ...(manifest.spec.resources ?? {}),
      [input.name]: {
        ...(manifest.spec.resources?.[input.name] ?? {}),
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
    if (!manifest.spec.resources?.[input.name]) return;
    delete manifest.spec.resources[input.name];
    if (Object.keys(manifest.spec.resources).length === 0) {
      delete manifest.spec.resources;
    }
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
    if (!manifest.spec.resources?.[input.fromName] || input.fromName === input.toName) return;
    manifest.spec.resources = {
      ...manifest.spec.resources,
      [input.toName]: manifest.spec.resources[input.fromName],
    };
    delete manifest.spec.resources[input.fromName];
  });
}

function upsertWorkloadRecord(
  manifest: AppManifest,
  category: WorkloadCategory,
  name: string,
  workload: AppWorker | AppContainer | AppService,
): void {
  if (category === 'worker') {
    manifest.spec.workers = {
      ...(manifest.spec.workers ?? {}),
      [name]: {
        ...(manifest.spec.workers?.[name] ?? {}),
        ...(workload as AppWorker),
      },
    };
    return;
  }
  if (category === 'container') {
    manifest.spec.containers = {
      ...(manifest.spec.containers ?? {}),
      [name]: {
        ...(manifest.spec.containers?.[name] ?? {}),
        ...(workload as AppContainer),
      },
    };
    return;
  }
  manifest.spec.services = {
    ...(manifest.spec.services ?? {}),
    [name]: {
      ...(manifest.spec.services?.[name] ?? {}),
      ...(workload as AppService),
    },
  };
}

function removeWorkloadRecord(
  manifest: AppManifest,
  category: WorkloadCategory,
  name: string,
): void {
  if (category === 'worker') {
    if (!manifest.spec.workers?.[name]) return;
    delete manifest.spec.workers[name];
    if (Object.keys(manifest.spec.workers).length === 0) delete manifest.spec.workers;
    return;
  }
  if (category === 'container') {
    if (!manifest.spec.containers?.[name]) return;
    delete manifest.spec.containers[name];
    if (Object.keys(manifest.spec.containers).length === 0) delete manifest.spec.containers;
    return;
  }
  if (!manifest.spec.services?.[name]) return;
  delete manifest.spec.services[name];
  if (Object.keys(manifest.spec.services).length === 0) delete manifest.spec.services;
}

export async function upsertGroupDesiredWorkload(
  env: Env,
  input: {
    groupId: string;
    category: WorkloadCategory;
    name: string;
    workload: AppWorker | AppContainer | AppService;
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

    if (input.category === 'worker') {
      if (!manifest.spec.workers?.[input.fromName]) return;
      manifest.spec.workers = {
        ...manifest.spec.workers,
        [input.toName]: manifest.spec.workers[input.fromName],
      };
      delete manifest.spec.workers[input.fromName];
      return;
    }

    if (input.category === 'container') {
      if (!manifest.spec.containers?.[input.fromName]) return;
      manifest.spec.containers = {
        ...manifest.spec.containers,
        [input.toName]: manifest.spec.containers[input.fromName],
      };
      delete manifest.spec.containers[input.fromName];
      return;
    }

    if (!manifest.spec.services?.[input.fromName]) return;
    manifest.spec.services = {
      ...manifest.spec.services,
      [input.toName]: manifest.spec.services[input.fromName],
    };
    delete manifest.spec.services[input.fromName];
  });
}
