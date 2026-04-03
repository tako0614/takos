import { and, eq } from "drizzle-orm";
import { NotFoundError } from "takos-common/errors";

import { type Database, getDb, groups } from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { AppManifest } from "../source/app-manifest-types.ts";
import type { RepoRefType } from "../platform/app-deployment-source.ts";

export type GroupRow = typeof groups.$inferSelect;
export type GroupProviderName = "cloudflare" | "local" | "aws" | "gcp" | "k8s";
export type GroupSourceProjectionInput =
  | {
    kind: "git_ref";
    repositoryUrl: string;
    ref: string | null;
    refType: RepoRefType | null;
    commitSha: string | null;
    currentAppDeploymentId?: string | null;
  }
  | {
    kind: "local_upload";
    currentAppDeploymentId?: string | null;
  };

type GroupRecordDeps = {
  getDb?: typeof getDb;
};

function resolveDb(env: Env, deps?: GroupRecordDeps): Database {
  return (deps?.getDb ?? getDb)(env.DB);
}

export async function findGroupByName(
  env: Env,
  spaceId: string,
  groupName: string,
  deps?: GroupRecordDeps,
): Promise<GroupRow | null> {
  const db = resolveDb(env, deps);
  return db.select()
    .from(groups)
    .where(and(eq(groups.spaceId, spaceId), eq(groups.name, groupName)))
    .get() as Promise<GroupRow | null>;
}

export async function findGroupById(
  env: Env,
  groupId: string,
  deps?: GroupRecordDeps,
): Promise<GroupRow | null> {
  const db = resolveDb(env, deps);
  return db.select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .get() as Promise<GroupRow | null>;
}

export async function createGroupByName(
  env: Env,
  input: {
    spaceId: string;
    groupName: string;
    provider?: GroupProviderName | null;
    envName?: string | null;
    appVersion?: string | null;
    manifest?: AppManifest | unknown;
  },
  deps?: GroupRecordDeps,
): Promise<GroupRow> {
  const db = resolveDb(env, deps);
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    spaceId: input.spaceId,
    name: input.groupName,
    appVersion: input.appVersion ?? null,
    provider: input.provider ?? null,
    env: input.envName ?? null,
    sourceKind: null,
    sourceRepositoryUrl: null,
    sourceRef: null,
    sourceRefType: null,
    sourceCommitSha: null,
    currentAppDeploymentId: null,
    desiredSpecJson: input.manifest ? JSON.stringify(input.manifest) : null,
    providerStateJson: "{}",
    reconcileStatus: "idle",
    lastAppliedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(groups).values(row);
  return row;
}

export async function updateGroupMetadata(
  env: Env,
  groupId: string,
  updates: {
    provider?: GroupProviderName | null;
    envName?: string | null;
  },
  deps?: GroupRecordDeps,
): Promise<GroupRow> {
  const db = resolveDb(env, deps);
  const row: {
    updatedAt: string;
    provider?: string | null;
    env?: string | null;
  } = {
    updatedAt: new Date().toISOString(),
  };

  if (Object.prototype.hasOwnProperty.call(updates, "provider")) {
    row.provider = updates.provider ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "envName")) {
    row.env = updates.envName ?? null;
  }

  await db.update(groups).set(row).where(eq(groups.id, groupId)).run();
  const updated = await findGroupById(env, groupId, deps);
  if (!updated) {
    throw new NotFoundError("Group");
  }
  return updated;
}

export async function updateGroupSourceProjection(
  env: Env,
  groupId: string,
  source: GroupSourceProjectionInput,
  deps?: GroupRecordDeps,
): Promise<void> {
  const db = resolveDb(env, deps);
  await db.update(groups).set({
    sourceKind: source.kind,
    sourceRepositoryUrl: source.kind === "git_ref"
      ? source.repositoryUrl
      : null,
    sourceRef: source.kind === "git_ref" ? source.ref : null,
    sourceRefType: source.kind === "git_ref" ? source.refType : null,
    sourceCommitSha: source.kind === "git_ref" ? source.commitSha : null,
    currentAppDeploymentId: source.currentAppDeploymentId ?? null,
    updatedAt: new Date().toISOString(),
  }).where(eq(groups.id, groupId)).run();
}
