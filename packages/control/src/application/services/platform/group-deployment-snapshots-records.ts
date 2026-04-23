import { eq } from "drizzle-orm";
import {
  getDb,
  groupDeploymentSnapshots,
  groups,
} from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import type { SafeApplyResult } from "../deployment/apply-engine.ts";
import type {
  AppManifest,
  GroupDeploymentSnapshotBuildSource,
} from "../source/app-manifest.ts";
import {
  createGroupByName,
  findGroupByName,
  type GroupBackendName,
  type GroupRow,
  updateGroupMetadata,
} from "../groups/records.ts";
import type {
  GitRefDeploymentSource,
  GroupDeploymentSnapshotRecord,
  GroupDeploymentSnapshotRow,
  GroupDeploymentSnapshotStatus,
  ResolvedGitTarget,
  StoredDeploymentSnapshot,
} from "./group-deployment-snapshots-model.ts";
import {
  buildSourceFromRow,
  resolveRepositoryUrlForRow,
} from "./group-deployment-snapshot-targets.ts";

type GroupStateLike = {
  workloads: Record<string, { hostname?: string | null }>;
  routes: Record<string, { url?: string | null }>;
} | null;

export function hasApplyFailures(result: SafeApplyResult): boolean {
  return result.applied.some((entry) => entry.status === "failed");
}

export function parseBackendName(
  raw: string | null | undefined,
): GroupBackendName | null {
  if (!raw) return null;
  if (
    raw === "cloudflare" || raw === "local" || raw === "aws" ||
    raw === "gcp" || raw === "k8s"
  ) {
    return raw;
  }
  return null;
}

export function collectGroupHostnames(state: GroupStateLike): string[] {
  const hostnames = new Set<string>();
  if (!state) return [];

  for (const workload of Object.values(state.workloads)) {
    if (workload.hostname) {
      hostnames.add(workload.hostname.toLowerCase());
    }
  }
  for (const route of Object.values(state.routes)) {
    if (!route.url) continue;
    try {
      hostnames.add(new URL(route.url).hostname.toLowerCase());
    } catch {
      // Ignore malformed URLs in state snapshots.
    }
  }
  return Array.from(hostnames).sort();
}

function parseHostnames(hostnamesJson: string | null): string[] {
  const value = safeJsonParseOrDefault<unknown>(hostnamesJson, []);
  return Array.isArray(value)
    ? value.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0
    )
    : [];
}

function parseManifestVersion(manifestJson: string): string | null {
  const manifest = safeJsonParseOrDefault<AppManifest | null>(
    manifestJson,
    null,
  );
  return manifest?.version ?? null;
}

export async function toGroupDeploymentSnapshotRecord(
  env: Env,
  row: GroupDeploymentSnapshotRow,
  groupName: string,
  groupExists: boolean,
): Promise<GroupDeploymentSnapshotRecord> {
  const hasSnapshot = Boolean(
    row.snapshotR2Key && row.snapshotSha256 && row.snapshotFormat,
  );
  const canRedeployFromSource = Boolean(
    row.sourceRepositoryUrl || row.sourceResolvedRepoId || row.sourceRepoId ||
      (row.sourceOwner && row.sourceRepoName),
  );
  const snapshotState = canRedeployFromSource ? "source_cached" : "unsupported";
  return {
    id: row.id,
    group: {
      id: row.groupId,
      name: groupName,
    },
    source: await buildSourceFromRow(env, row),
    snapshot: hasSnapshot
      ? {
        state: "available",
        rollback_ready: groupExists,
        format: row.snapshotFormat ?? null,
      }
      : {
        state: snapshotState,
        rollback_ready: canRedeployFromSource && groupExists,
        format: row.snapshotFormat ?? null,
      },
    status: row.status as GroupDeploymentSnapshotStatus,
    manifest_version: parseManifestVersion(row.manifestJson),
    hostnames: parseHostnames(row.hostnamesJson),
    rollback_of_group_deployment_snapshot_id:
      row.rollbackOfGroupDeploymentSnapshotId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function loadGroupNames(
  env: Env,
  rows: GroupDeploymentSnapshotRow[],
): Promise<Map<string, { name: string; exists: boolean }>> {
  const db = getDb(env.DB);
  const uniqueIds = Array.from(new Set(rows.map((row) => row.groupId)));
  const map = new Map<string, { name: string; exists: boolean }>();
  for (const groupId of uniqueIds) {
    const group = await db.select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.id, groupId))
      .get();
    if (group) {
      map.set(group.id, { name: group.name, exists: true });
    }
  }
  return map;
}

function groupDeploymentSnapshotStatusForApplyResult(
  applyResult: SafeApplyResult,
): GroupDeploymentSnapshotStatus {
  return hasApplyFailures(applyResult) ? "failed" : "applied";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function finalizeGroupDeploymentSnapshotRecord(
  env: Env,
  input: {
    deploymentId: string;
    group: GroupRow;
    hostnames: string[];
    applyResult: SafeApplyResult;
  },
): Promise<GroupDeploymentSnapshotRecord> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  await db.update(groupDeploymentSnapshots).set({
    status: groupDeploymentSnapshotStatusForApplyResult(input.applyResult),
    hostnamesJson: JSON.stringify(input.hostnames),
    resultJson: JSON.stringify(input.applyResult),
    updatedAt: now,
  }).where(eq(groupDeploymentSnapshots.id, input.deploymentId)).run();

  const row = await db.select().from(groupDeploymentSnapshots)
    .where(eq(groupDeploymentSnapshots.id, input.deploymentId))
    .get();
  if (!row) {
    throw new Error(
      `Group deployment snapshot ${input.deploymentId} disappeared`,
    );
  }
  return await toGroupDeploymentSnapshotRecord(
    env,
    row,
    input.group.name,
    true,
  );
}

export async function markGroupDeploymentSnapshotRecordFailed(
  env: Env,
  input: {
    deploymentId: string;
    error: unknown;
  },
): Promise<void> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  await db.update(groupDeploymentSnapshots).set({
    status: "failed",
    resultJson: JSON.stringify({ error: errorMessage(input.error) }),
    updatedAt: now,
  }).where(eq(groupDeploymentSnapshots.id, input.deploymentId)).run();
}

export async function createGroupDeploymentSnapshotRecord(
  env: Env,
  input: {
    deploymentId: string;
    group: GroupRow;
    target: ResolvedGitTarget;
    manifest: AppManifest;
    buildSources: GroupDeploymentSnapshotBuildSource[];
    hostnames: string[];
    applyResult: SafeApplyResult;
    createdByAccountId: string | null;
    snapshot: StoredDeploymentSnapshot;
    rollbackOfGroupDeploymentSnapshotId?: string | null;
    status?: GroupDeploymentSnapshotStatus;
  },
): Promise<GroupDeploymentSnapshotRecord> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const isInProgress = input.status === "in_progress";
  const row = {
    id: input.deploymentId,
    spaceId: input.group.spaceId,
    groupId: input.group.id,
    groupNameSnapshot: input.group.name,
    createdByAccountId: input.createdByAccountId,
    sourceKind: "git_ref",
    sourceRepositoryUrl: input.target.repositoryUrl,
    sourceResolvedRepoId: input.target.resolvedRepoId,
    sourceRepoId: input.target.resolvedRepoId,
    sourceOwner: null,
    sourceRepoName: null,
    sourceVersion: null,
    sourceRef: input.target.ref,
    sourceRefType: input.target.refType,
    sourceCommitSha: input.target.commitSha,
    sourceReleaseId: null,
    sourceTag: null,
    status: input.status ?? groupDeploymentSnapshotStatusForApplyResult(
      input.applyResult,
    ),
    manifestJson: JSON.stringify(input.manifest),
    buildSourcesJson: JSON.stringify(input.buildSources),
    hostnamesJson: JSON.stringify(isInProgress ? [] : input.hostnames),
    snapshotR2Key: input.snapshot.r2Key || null,
    snapshotSha256: input.snapshot.sha256 || null,
    snapshotSizeBytes: input.snapshot.sizeBytes || null,
    snapshotFormat: input.snapshot.format,
    resultJson: isInProgress ? null : JSON.stringify(input.applyResult),
    rollbackOfGroupDeploymentSnapshotId:
      input.rollbackOfGroupDeploymentSnapshotId ?? null,
    createdAt: now,
    updatedAt: now,
  } satisfies typeof groupDeploymentSnapshots.$inferInsert;
  await db.insert(groupDeploymentSnapshots).values(row).run();
  return await toGroupDeploymentSnapshotRecord(
    env,
    row as GroupDeploymentSnapshotRow,
    input.group.name,
    true,
  );
}

export async function createGroupDeploymentSnapshotRecordForManifest(
  env: Env,
  input: {
    deploymentId: string;
    group: GroupRow;
    manifest: AppManifest;
    artifacts: Array<Record<string, unknown>>;
    hostnames: string[];
    applyResult: SafeApplyResult;
    createdByAccountId: string | null;
    snapshot?: StoredDeploymentSnapshot | null;
    rollbackOfGroupDeploymentSnapshotId?: string | null;
    status?: GroupDeploymentSnapshotStatus;
  },
): Promise<GroupDeploymentSnapshotRecord> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const snapshot = input.snapshot ?? null;
  const isInProgress = input.status === "in_progress";
  const row = {
    id: input.deploymentId,
    spaceId: input.group.spaceId,
    groupId: input.group.id,
    groupNameSnapshot: input.group.name,
    createdByAccountId: input.createdByAccountId,
    sourceKind: "manifest",
    sourceRepositoryUrl: null,
    sourceResolvedRepoId: null,
    sourceRepoId: null,
    sourceOwner: null,
    sourceRepoName: null,
    sourceVersion: null,
    sourceRef: null,
    sourceRefType: null,
    sourceCommitSha: null,
    sourceReleaseId: null,
    sourceTag: null,
    status: input.status ?? groupDeploymentSnapshotStatusForApplyResult(
      input.applyResult,
    ),
    manifestJson: JSON.stringify(input.manifest),
    // Persist any caller-supplied build provenance under the existing
    // build_sources_json column so the rollback / audit pipeline can read it.
    buildSourcesJson: JSON.stringify(input.artifacts),
    hostnamesJson: JSON.stringify(isInProgress ? [] : input.hostnames),
    snapshotR2Key: snapshot?.r2Key ?? null,
    snapshotSha256: snapshot?.sha256 ?? null,
    snapshotSizeBytes: snapshot?.sizeBytes ?? null,
    snapshotFormat: snapshot?.format ?? null,
    resultJson: isInProgress ? null : JSON.stringify(input.applyResult),
    rollbackOfGroupDeploymentSnapshotId:
      input.rollbackOfGroupDeploymentSnapshotId ?? null,
    createdAt: now,
    updatedAt: now,
  } satisfies typeof groupDeploymentSnapshots.$inferInsert;
  await db.insert(groupDeploymentSnapshots).values(row).run();
  return await toGroupDeploymentSnapshotRecord(
    env,
    row as GroupDeploymentSnapshotRow,
    input.group.name,
    true,
  );
}

export async function ensureTargetGroup(
  env: Env,
  spaceId: string,
  groupName: string,
  manifest: AppManifest,
  options: {
    backendName?: GroupBackendName | null;
    envName?: string | null;
  },
): Promise<GroupRow> {
  const existing = await findGroupByName(env, spaceId, groupName);
  if (!existing) {
    return await createGroupByName(env, {
      spaceId,
      groupName,
      backendName: options.backendName ?? null,
      envName: options.envName ?? null,
      appVersion: manifest.version ?? null,
      manifest,
    });
  }

  if (options.backendName !== undefined || options.envName !== undefined) {
    return await updateGroupMetadata(env, existing.id, {
      ...(options.backendName !== undefined
        ? { backendName: options.backendName }
        : {}),
      ...(options.envName !== undefined ? { envName: options.envName } : {}),
    });
  }
  return existing;
}

export async function deriveSourceInputFromRow(
  env: Env,
  row: GroupDeploymentSnapshotRow,
): Promise<GitRefDeploymentSource | null> {
  const repositoryUrl = await resolveRepositoryUrlForRow(env, row);
  if (!repositoryUrl) return null;
  const refType = row.sourceCommitSha
    ? "commit"
    : row.sourceRefType === "branch" || row.sourceRefType === "tag" ||
        row.sourceRefType === "commit"
    ? row.sourceRefType
    : "branch";
  const ref = row.sourceCommitSha ?? row.sourceRef ?? null;
  if (!ref) return null;
  return {
    kind: "git_ref",
    repositoryUrl,
    ref,
    refType,
  };
}
