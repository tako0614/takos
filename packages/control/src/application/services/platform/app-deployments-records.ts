import { eq } from "drizzle-orm";
import { appDeployments, getDb, groups } from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import type { SafeApplyResult } from "../deployment/apply-engine.ts";
import type {
  AppDeploymentBuildSource,
  AppManifest,
} from "../source/app-manifest.ts";
import {
  createGroupByName,
  findGroupByName,
  type GroupProviderName,
  type GroupRow,
  updateGroupMetadata,
} from "../groups/records.ts";
import type {
  AppDeploymentRecord,
  AppDeploymentRow,
  AppDeploymentStatus,
  GitRefDeploymentSource,
  ResolvedGitTarget,
  StoredDeploymentSnapshot,
} from "./app-deployments-model.ts";
import {
  buildSourceFromRow,
  resolveRepositoryUrlForRow,
} from "./app-deployments-targets.ts";

type GroupStateLike = {
  workloads: Record<string, { hostname?: string | null }>;
  routes: Record<string, { url?: string | null }>;
} | null;

export function hasApplyFailures(result: SafeApplyResult): boolean {
  return result.applied.some((entry) => entry.status === "failed");
}

export function parseProviderName(
  raw: string | null | undefined,
): GroupProviderName | null {
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
  return manifest?.spec?.version ?? null;
}

export async function toAppDeploymentRecord(
  env: Env,
  row: AppDeploymentRow,
  groupName: string,
  groupExists: boolean,
): Promise<AppDeploymentRecord> {
  const hasSnapshot = Boolean(
    row.snapshotR2Key && row.snapshotSha256 && row.snapshotFormat,
  );
  const canBackfillSnapshot = Boolean(
    row.sourceRepositoryUrl || row.sourceResolvedRepoId || row.sourceRepoId ||
      (row.sourceOwner && row.sourceRepoName),
  );
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
        state: canBackfillSnapshot ? "backfill_required" : "unsupported",
        rollback_ready: false,
        format: row.snapshotFormat ?? null,
      },
    status: row.status as AppDeploymentStatus,
    manifest_version: parseManifestVersion(row.manifestJson),
    hostnames: parseHostnames(row.hostnamesJson),
    rollback_of_app_deployment_id: row.rollbackOfAppDeploymentId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function loadGroupNames(
  env: Env,
  rows: AppDeploymentRow[],
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

export async function createAppDeploymentRecord(
  env: Env,
  input: {
    deploymentId: string;
    group: GroupRow;
    target: ResolvedGitTarget;
    manifest: AppManifest;
    buildSources: AppDeploymentBuildSource[];
    hostnames: string[];
    applyResult: SafeApplyResult;
    createdByAccountId: string | null;
    snapshot: StoredDeploymentSnapshot;
    rollbackOfAppDeploymentId?: string | null;
  },
): Promise<AppDeploymentRecord> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
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
    status: hasApplyFailures(input.applyResult) ? "failed" : "applied",
    manifestJson: JSON.stringify(input.manifest),
    buildSourcesJson: JSON.stringify(input.buildSources),
    hostnamesJson: JSON.stringify(input.hostnames),
    snapshotR2Key: input.snapshot.r2Key,
    snapshotSha256: input.snapshot.sha256,
    snapshotSizeBytes: input.snapshot.sizeBytes,
    snapshotFormat: input.snapshot.format,
    resultJson: JSON.stringify(input.applyResult),
    rollbackOfAppDeploymentId: input.rollbackOfAppDeploymentId ?? null,
    createdAt: now,
    updatedAt: now,
  } satisfies typeof appDeployments.$inferInsert;
  await db.insert(appDeployments).values(row);
  return await toAppDeploymentRecord(
    env,
    row as AppDeploymentRow,
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
    providerName?: GroupProviderName | null;
    envName?: string | null;
  },
): Promise<GroupRow> {
  const existing = await findGroupByName(env, spaceId, groupName);
  if (!existing) {
    return await createGroupByName(env, {
      spaceId,
      groupName,
      provider: options.providerName ?? null,
      envName: options.envName ?? null,
      appVersion: manifest.spec.version ?? null,
      manifest,
    });
  }

  if (options.providerName !== undefined || options.envName !== undefined) {
    return await updateGroupMetadata(env, existing.id, {
      ...(options.providerName !== undefined
        ? { provider: options.providerName }
        : {}),
      ...(options.envName !== undefined ? { envName: options.envName } : {}),
    });
  }
  return existing;
}

export async function deriveSourceInputFromRow(
  env: Env,
  row: AppDeploymentRow,
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
