import { and, desc, eq, lt, ne } from "drizzle-orm";
import {
  accounts,
  appDeployments,
  getDb,
  groups,
  repoReleases,
  repositories,
  workflowJobs,
  workflowRuns,
} from "../../../infra/db/index.ts";
import {
  BadRequestError,
  ConflictError,
  GoneError,
  NotFoundError,
} from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import { generateId, safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import { checkRepoAccess } from "../source/repos.ts";
import * as gitStore from "../git-smart/index.ts";
import { resolveWorkflowArtifactFileForJob } from "./workflow-artifacts.ts";
import {
  applyManifest,
  buildSafeApplyResult,
  getGroupState,
  type SafeApplyResult,
} from "../deployment/apply-engine.ts";
import {
  type AppDeploymentBuildSource,
  type AppManifest,
  parseAndValidateWorkflowYaml,
  parseAppManifestYaml,
  selectAppManifestPathFromRepo,
  validateDeployProducerJob,
} from "../source/app-manifest.ts";

type RepoRefType = "branch" | "tag" | "commit";
type GroupProviderName = "cloudflare" | "local" | "aws" | "gcp" | "k8s";
type AppDeploymentStatus = "applied" | "failed" | "deleted";

export type RepoRefDeploymentSource = {
  kind: "repo_ref";
  repoId: string;
  ref?: string;
  refType?: RepoRefType;
};

export type PackageReleaseDeploymentSource = {
  kind: "package_release";
  owner: string;
  repoName: string;
  version?: string;
};

export type AppDeploymentSourceInput =
  | RepoRefDeploymentSource
  | PackageReleaseDeploymentSource;

type CreateAppDeploymentInput = {
  groupName?: string;
  providerName?: GroupProviderName;
  envName?: string;
  source: AppDeploymentSourceInput;
  approveOauthAutoEnv?: boolean;
  approveSourceChange?: boolean;
};

type ResolvedRepoTarget = {
  repoId: string;
  ref: string;
  refType: RepoRefType;
  commitSha: string;
  treeSha: string;
};

type ResolvedBuildArtifacts = {
  buildSources: AppDeploymentBuildSource[];
  packageFiles: Map<string, ArrayBuffer | Uint8Array>;
};

type AppDeploymentRow = typeof appDeployments.$inferSelect;
type GroupRow = typeof groups.$inferSelect;

type AppDeploymentSource =
  | {
    kind: "repo_ref";
    repo_id: string;
    ref: string | null;
    ref_type: RepoRefType | null;
    commit_sha: string | null;
  }
  | {
    kind: "package_release";
    owner: string;
    repo_name: string;
    version: string | null;
    repo_id: string | null;
    release_id: string | null;
    release_tag: string | null;
    commit_sha: string | null;
  };

export type AppDeploymentRecord = {
  id: string;
  group: { id: string; name: string };
  source: AppDeploymentSource;
  status: AppDeploymentStatus;
  manifest_version: string | null;
  hostnames: string[];
  rollback_of_app_deployment_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AppDeploymentMutationResult = {
  appDeployment: AppDeploymentRecord;
  applyResult: SafeApplyResult;
};

export const APP_DEPLOYMENTS_REMOVED_MESSAGE =
  "Rollout control is not available in app-deployments v1. Use deploy status and rollback.";

function throwRemovedRollout(): never {
  throw new GoneError(APP_DEPLOYMENTS_REMOVED_MESSAGE);
}

export function encodeSourceRef(
  refType: RepoRefType | undefined,
  ref: string | undefined,
  commitSha?: string,
): string | undefined {
  const normalizedRef = String(ref || "").trim();
  if (!normalizedRef) return undefined;
  const base = `${refType || "branch"}:${normalizedRef}`;
  return commitSha ? `${base}@${commitSha}` : base;
}

export function decodeSourceRef(encoded: string | null | undefined): {
  ref: string | null;
  ref_type: RepoRefType | null;
  commit_sha: string | null;
} {
  const raw = String(encoded || "").trim();
  if (!raw) return { ref: null, ref_type: null, commit_sha: null };
  const separator = raw.indexOf(":");
  if (separator <= 0) return { ref: raw, ref_type: null, commit_sha: null };
  const rawType = raw.slice(0, separator).trim();
  const rest = raw.slice(separator + 1).trim();
  const atIndex = rest.indexOf("@");
  const ref = atIndex > 0 ? rest.slice(0, atIndex) : rest;
  const commitSha = atIndex > 0 ? rest.slice(atIndex + 1) : null;
  return {
    ref: ref || null,
    ref_type: rawType === "branch" || rawType === "tag" || rawType === "commit"
      ? rawType
      : null,
    commit_sha: commitSha || null,
  };
}

function normalizeRepoPath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .trim();
}

function getGitBucket(env: Env) {
  return env.GIT_OBJECTS || null;
}

function buildWorkflowRunRef(refType: RepoRefType, ref: string): string | null {
  if (refType === "branch") return `refs/heads/${ref}`;
  if (refType === "tag") return `refs/tags/${ref}`;
  return null;
}

function normalizeRepoRef(refType: RepoRefType, ref: string): string {
  const normalized = String(ref || "").trim();
  if (!normalized) {
    throw new BadRequestError("ref is required");
  }
  if (refType === "branch") {
    return normalized.replace(/^refs\/heads\//, "");
  }
  if (refType === "tag") {
    return normalized.replace(/^refs\/tags\//, "");
  }
  return normalized;
}

function isDirectoryMode(mode: string | undefined): boolean {
  return mode === "040000" || mode === "40000";
}

function looksLikeInlineSql(value: string): boolean {
  const sql = value.trim();
  if (!sql) return false;
  if (/\n/.test(sql) && /;/.test(sql)) return true;
  return /^(--|\/\*|\s*(create|alter|drop|insert|update|delete|pragma|begin|commit|with)\b)/i.test(
    sql,
  );
}

async function readRepoTextFileAtCommit(
  env: Env,
  treeSha: string,
  filePath: string,
): Promise<string | null> {
  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");
  const blob = await gitStore.getBlobAtPath(
    bucket,
    treeSha,
    normalizeRepoPath(filePath),
  );
  if (!blob) return null;
  return new TextDecoder().decode(blob);
}

function toArrayBuffer(
  value: ArrayBuffer | SharedArrayBuffer | ArrayBufferView,
): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (value instanceof SharedArrayBuffer) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value));
    return copy.buffer;
  }
  const copy = new Uint8Array(value.byteLength);
  copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return copy.buffer;
}

async function addRepoSqlPathToPackage(
  env: Env,
  treeSha: string,
  configuredPath: string,
  packageFiles: Map<string, ArrayBuffer | Uint8Array>,
): Promise<void> {
  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");

  const normalizedPath = normalizeRepoPath(configuredPath);
  if (!normalizedPath) {
    throw new BadRequestError("Migration path is empty");
  }

  const entry = await gitStore.getEntryAtPath(bucket, treeSha, normalizedPath);
  if (!entry) {
    throw new NotFoundError(`Migration path not found in repo: ${normalizedPath}`);
  }

  if (isDirectoryMode(entry.mode)) {
    const files = await gitStore.flattenTree(bucket, entry.sha, normalizedPath, {
      skipSymlinks: true,
    });
    const sqlFiles = files.filter((file) => file.path.toLowerCase().endsWith(".sql"));
    if (sqlFiles.length === 0) {
      throw new BadRequestError(
        `Migration directory contains no .sql files: ${normalizedPath}`,
      );
    }
    for (const file of sqlFiles) {
      const blob = await gitStore.getBlob(bucket, file.sha);
      if (!blob) {
        throw new NotFoundError(
          `Migration file not found in git object storage: ${file.path}`,
        );
      }
      packageFiles.set(file.path, toArrayBuffer(blob));
    }
    return;
  }

  if (!normalizedPath.toLowerCase().endsWith(".sql")) {
    throw new BadRequestError(`Migration file must end with .sql: ${normalizedPath}`);
  }
  const blob = await gitStore.getBlob(bucket, entry.sha);
  if (!blob) {
    throw new NotFoundError(
      `Migration file not found in git object storage: ${normalizedPath}`,
    );
  }
  packageFiles.set(normalizedPath, toArrayBuffer(blob));
}

function parseProviderName(raw: string | null | undefined): GroupProviderName | null {
  if (!raw) return null;
  if (
    raw === "cloudflare" || raw === "local" || raw === "aws" ||
    raw === "gcp" || raw === "k8s"
  ) {
    return raw;
  }
  return null;
}

function parseHostnames(hostnamesJson: string | null): string[] {
  const value = safeJsonParseOrDefault<unknown>(hostnamesJson, []);
  return Array.isArray(value)
    ? value.filter((item): item is string =>
      typeof item === "string" && item.trim().length > 0
    )
    : [];
}

function collectGroupHostnames(
  state: Awaited<ReturnType<typeof getGroupState>>,
): string[] {
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
      // Ignore malformed snapshot URLs.
    }
  }
  return Array.from(hostnames).sort();
}

function parseManifestVersion(manifestJson: string): string | null {
  const manifest = safeJsonParseOrDefault<AppManifest | null>(manifestJson, null);
  return manifest?.spec?.version ?? null;
}

function buildSourceFromRow(row: AppDeploymentRow): AppDeploymentSource {
  if (row.sourceKind === "package_release") {
    return {
      kind: "package_release",
      owner: row.sourceOwner ?? "",
      repo_name: row.sourceRepoName ?? "",
      version: row.sourceVersion ?? null,
      repo_id: row.sourceRepoId ?? null,
      release_id: row.sourceReleaseId ?? null,
      release_tag: row.sourceTag ?? null,
      commit_sha: row.sourceCommitSha ?? null,
    };
  }

  return {
    kind: "repo_ref",
    repo_id: row.sourceRepoId ?? "",
    ref: row.sourceRef ?? null,
    ref_type: row.sourceRefType === "branch" || row.sourceRefType === "tag" ||
        row.sourceRefType === "commit"
      ? row.sourceRefType
      : null,
    commit_sha: row.sourceCommitSha ?? null,
  };
}

function toAppDeploymentRecord(
  row: AppDeploymentRow,
  groupName: string,
): AppDeploymentRecord {
  return {
    id: row.id,
    group: {
      id: row.groupId,
      name: groupName,
    },
    source: buildSourceFromRow(row),
    status: row.status as AppDeploymentStatus,
    manifest_version: parseManifestVersion(row.manifestJson),
    hostnames: parseHostnames(row.hostnamesJson),
    rollback_of_app_deployment_id: row.rollbackOfAppDeploymentId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function findGroupByName(
  env: Env,
  spaceId: string,
  groupName: string,
): Promise<GroupRow | null> {
  const db = getDb(env.DB);
  return db.select()
    .from(groups)
    .where(and(eq(groups.spaceId, spaceId), eq(groups.name, groupName)))
    .get() as Promise<GroupRow | null>;
}

async function findGroupById(env: Env, groupId: string): Promise<GroupRow | null> {
  const db = getDb(env.DB);
  return db.select().from(groups).where(eq(groups.id, groupId)).get() as Promise<GroupRow | null>;
}

async function createGroupByName(
  env: Env,
  input: {
    spaceId: string;
    groupName: string;
    provider?: GroupProviderName | null;
    envName?: string | null;
    appVersion?: string | null;
    manifest?: AppManifest;
  },
): Promise<GroupRow> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    spaceId: input.spaceId,
    name: input.groupName,
    appVersion: input.appVersion ?? null,
    provider: input.provider ?? null,
    env: input.envName ?? null,
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

async function updateGroupMetadata(
  env: Env,
  groupId: string,
  updates: {
    provider?: GroupProviderName | null;
    envName?: string | null;
  },
): Promise<GroupRow> {
  const db = getDb(env.DB);
  const row: {
    updatedAt: string;
    provider?: string | null;
    env?: string | null;
  } = { updatedAt: new Date().toISOString() };

  if (Object.prototype.hasOwnProperty.call(updates, "provider")) {
    row.provider = updates.provider ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(updates, "envName")) {
    row.env = updates.envName ?? null;
  }

  await db.update(groups).set(row).where(eq(groups.id, groupId)).run();
  const updated = await findGroupById(env, groupId);
  if (!updated) throw new NotFoundError("Group");
  return updated;
}

async function resolveRepoTargetById(
  env: Env,
  input: {
    spaceId: string;
    userId: string;
    repoId: string;
    ref?: string;
    refType?: RepoRefType;
    allowPublicRead?: boolean;
  },
): Promise<ResolvedRepoTarget> {
  const repoId = String(input.repoId || "").trim();
  if (!repoId) throw new BadRequestError("repo_id is required");

  const repoAccess = await checkRepoAccess(
    env,
    repoId,
    input.userId,
    input.allowPublicRead ? undefined : ["owner", "admin", "editor"],
    { allowPublicRead: input.allowPublicRead === true },
  );
  if (!repoAccess) {
    throw new NotFoundError("Repository");
  }
  if (!input.allowPublicRead && repoAccess.spaceId !== input.spaceId) {
    throw new BadRequestError("Repository must belong to this workspace");
  }

  const refType = input.refType || "branch";
  const ref = normalizeRepoRef(
    refType,
    String(input.ref || "").trim() ||
      (refType === "branch" ? repoAccess.repo.default_branch || "main" : ""),
  );

  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");

  const commitSha = refType === "commit"
    ? ref
    : await gitStore.resolveRef(env.DB, repoId, ref);
  if (!commitSha) {
    throw new NotFoundError(`Ref not found: ${ref}`);
  }
  const commit = await gitStore.getCommitData(bucket, commitSha);
  if (!commit) {
    throw new NotFoundError(`Commit not found: ${commitSha}`);
  }

  return {
    repoId,
    ref,
    refType,
    commitSha,
    treeSha: commit.tree,
  };
}

async function resolvePackageRelease(
  env: Env,
  input: {
    spaceId: string;
    userId: string;
    owner: string;
    repoName: string;
    version?: string;
  },
): Promise<{
  target: ResolvedRepoTarget;
  releaseId: string | null;
  releaseTag: string | null;
  owner: string;
  repoName: string;
  version: string | null;
}> {
  const db = getDb(env.DB);
  const owner = String(input.owner || "").trim();
  const repoName = String(input.repoName || "").trim();
  if (!owner || !repoName) {
    throw new BadRequestError("owner and repo_name are required");
  }

  const repoRow = await db.select({
    repoId: repositories.id,
  }).from(repositories)
    .innerJoin(accounts, eq(repositories.accountId, accounts.id))
    .where(and(
      eq(accounts.slug, owner),
      eq(repositories.name, repoName),
    ))
    .get();
  if (!repoRow) {
    throw new NotFoundError("Package repository");
  }

  const release = await db.select().from(repoReleases).where(
    and(
      eq(repoReleases.repoId, repoRow.repoId),
      eq(repoReleases.isDraft, false),
      eq(repoReleases.isPrerelease, false),
      ...(input.version ? [eq(repoReleases.tag, input.version.trim())] : []),
    ),
  ).orderBy(desc(repoReleases.publishedAt), desc(repoReleases.createdAt)).get();
  if (!release) {
    throw new NotFoundError("Package release");
  }

  const target = await resolveRepoTargetById(env, {
    spaceId: input.spaceId,
    userId: input.userId,
    repoId: repoRow.repoId,
    ref: release.commitSha || release.tag,
    refType: release.commitSha ? "commit" : "tag",
    allowPublicRead: true,
  });

  return {
    target,
    releaseId: release.id,
    releaseTag: release.tag,
    owner,
    repoName,
    version: input.version?.trim() || release.tag || null,
  };
}

async function readManifestFromRepoTarget(
  env: Env,
  target: ResolvedRepoTarget,
): Promise<AppManifest> {
  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");

  const entries = await gitStore.flattenTree(bucket, target.treeSha, "", {
    skipSymlinks: true,
  });
  const manifestPath = selectAppManifestPathFromRepo(
    entries.map((entry) => entry.path),
  );
  if (!manifestPath) {
    throw new NotFoundError("App manifest (.takos/app.yml)");
  }

  const rawManifest = await readRepoTextFileAtCommit(env, target.treeSha, manifestPath);
  if (!rawManifest) {
    throw new NotFoundError(`App manifest not found at ${manifestPath}`);
  }

  try {
    return parseAppManifestYaml(rawManifest);
  } catch (error) {
    throw new BadRequestError(
      error instanceof Error ? error.message : "Invalid app manifest",
    );
  }
}

function collectArtifactsForApply(
  env: Env,
  target: ResolvedRepoTarget,
  manifest: AppManifest,
  buildSources: AppDeploymentBuildSource[],
): Promise<Record<string, unknown>> {
  const buildSourceMap = new Map(
    buildSources.map((entry) => [entry.service_name, entry]),
  );
  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");

  return Object.entries(manifest.spec.workers ?? {}).reduce(
    async (promise, [workerName, worker]) => {
      const artifacts = await promise;
      if (!worker.build?.fromWorkflow) return artifacts;

      const buildSource = buildSourceMap.get(workerName);
      if (!buildSource) {
        throw new NotFoundError(`Build source missing for worker "${workerName}"`);
      }

      const artifactFile = await resolveWorkflowArtifactFileForJob(env, {
        repoId: target.repoId,
        runId: buildSource.workflow_run_id ?? "",
        jobId: buildSource.workflow_job_id ?? "",
        artifactName: buildSource.workflow_artifact,
        artifactPath: buildSource.artifact_path,
      });
      const artifactObject = await bucket.get(artifactFile.r2Key)
        || await env.TENANT_SOURCE?.get(artifactFile.r2Key)
        || null;
      if (!artifactObject) {
        throw new NotFoundError(
          `Workflow artifact file disappeared during app deploy: ${artifactFile.r2Key}`,
        );
      }

      artifacts[workerName] = {
        kind: "worker_bundle",
        bundleContent: new TextDecoder().decode(await artifactObject.arrayBuffer()),
        deployMessage: `takos deploy ${workerName}`,
      };
      return artifacts;
    },
    Promise.resolve({} as Record<string, unknown>),
  );
}

function resolveDefaultGroupName(
  source: AppDeploymentSourceInput,
  manifest: AppManifest,
): string {
  if (source.kind === "package_release") {
    return manifest.metadata.appId || manifest.metadata.name;
  }
  return manifest.metadata.name;
}

async function loadGroupNames(
  env: Env,
  rows: AppDeploymentRow[],
): Promise<Map<string, string>> {
  const db = getDb(env.DB);
  const uniqueIds = Array.from(new Set(rows.map((row) => row.groupId)));
  const map = new Map<string, string>();
  for (const groupId of uniqueIds) {
    const group = await db.select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.id, groupId))
      .get();
    if (group) {
      map.set(group.id, group.name);
    }
  }
  return map;
}

export class AppDeploymentService {
  constructor(private env: Env) {}

  private async resolveBuildArtifacts(
    target: ResolvedRepoTarget,
    manifest: AppManifest,
  ): Promise<ResolvedBuildArtifacts> {
    const bucket = getGitBucket(this.env);
    if (!bucket) throw new BadRequestError("Git storage is not configured");
    const db = getDb(this.env.DB);
    const workflowCache = new Map<string, ReturnType<typeof parseAndValidateWorkflowYaml>>();
    const packageFiles = new Map<string, ArrayBuffer | Uint8Array>();
    const buildSources: AppDeploymentBuildSource[] = [];

    for (const [workerName, worker] of Object.entries(manifest.spec.workers || {})) {
      if (!worker.build?.fromWorkflow) {
        continue;
      }
      const build = worker.build.fromWorkflow;
      const workflowContent = await readRepoTextFileAtCommit(
        this.env,
        target.treeSha,
        build.path,
      );
      if (!workflowContent) {
        throw new NotFoundError(`Workflow file not found at repo ref: ${build.path}`);
      }

      let workflow = workflowCache.get(build.path);
      if (!workflow) {
        workflow = parseAndValidateWorkflowYaml(workflowContent, build.path);
        workflowCache.set(build.path, workflow);
      }
      validateDeployProducerJob(workflow, build.path, build.job);

      const workflowRunRef = buildWorkflowRunRef(target.refType, target.ref);
      const baseConditions = and(
        eq(workflowRuns.repoId, target.repoId),
        eq(workflowRuns.workflowPath, build.path),
        eq(workflowRuns.status, "completed"),
        eq(workflowRuns.conclusion, "success"),
        ...(workflowRunRef
          ? [eq(workflowRuns.ref, workflowRunRef)]
          : [eq(workflowRuns.sha, target.commitSha)]),
      );

      const matchingRuns = await db.select({
        id: workflowRuns.id,
        sha: workflowRuns.sha,
        completedAt: workflowRuns.completedAt,
        createdAt: workflowRuns.createdAt,
      }).from(workflowRuns).where(baseConditions).orderBy(
        desc(workflowRuns.completedAt),
        desc(workflowRuns.createdAt),
      ).all();

      let foundRun: { id: string; sha: string | null; jobId: string } | null = null;
      for (const run of matchingRuns) {
        const matchingJob = await db.select({ id: workflowJobs.id })
          .from(workflowJobs)
          .where(and(
            eq(workflowJobs.runId, run.id),
            eq(workflowJobs.jobKey, build.job),
            eq(workflowJobs.status, "completed"),
            eq(workflowJobs.conclusion, "success"),
          ))
          .orderBy(desc(workflowJobs.completedAt), desc(workflowJobs.createdAt))
          .get();
        if (matchingJob) {
          foundRun = { id: run.id, sha: run.sha, jobId: matchingJob.id };
          break;
        }
      }

      if (!foundRun) {
        throw new NotFoundError(
          `Latest successful workflow run not found for ${build.path}#${build.job} on ${target.refType}:${target.ref}`,
        );
      }

      buildSources.push({
        service_name: workerName,
        workflow_path: build.path,
        workflow_job: build.job,
        workflow_artifact: build.artifact,
        artifact_path: normalizeRepoPath(build.artifactPath),
        workflow_run_id: foundRun.id,
        workflow_job_id: foundRun.jobId,
        ...(foundRun.sha ? { source_sha: foundRun.sha } : {}),
      });
    }

    for (const resource of Object.values(manifest.spec.resources || {})) {
      if (resource.type !== "d1" || !resource.migrations) continue;
      if (typeof resource.migrations === "string") {
        if (!looksLikeInlineSql(resource.migrations)) {
          await addRepoSqlPathToPackage(
            this.env,
            target.treeSha,
            resource.migrations,
            packageFiles,
          );
        }
        continue;
      }

      await addRepoSqlPathToPackage(
        this.env,
        target.treeSha,
        resource.migrations.up,
        packageFiles,
      );
      await addRepoSqlPathToPackage(
        this.env,
        target.treeSha,
        resource.migrations.down,
        packageFiles,
      );
    }

    return { buildSources, packageFiles };
  }

  private async createRecord(
    input: {
      group: GroupRow;
      source: AppDeploymentSourceInput;
      target: ResolvedRepoTarget;
      manifest: AppManifest;
      buildSources: AppDeploymentBuildSource[];
      hostnames: string[];
      applyResult: SafeApplyResult;
      createdByAccountId: string | null;
      releaseId?: string | null;
      releaseTag?: string | null;
      rollbackOfAppDeploymentId?: string | null;
    },
  ): Promise<AppDeploymentRecord> {
    const db = getDb(this.env.DB);
    const row = {
      id: generateId(),
      spaceId: input.group.spaceId,
      groupId: input.group.id,
      createdByAccountId: input.createdByAccountId,
      sourceKind: input.source.kind,
      sourceRepoId: input.target.repoId,
      sourceOwner: input.source.kind === "package_release" ? input.source.owner : null,
      sourceRepoName: input.source.kind === "package_release" ? input.source.repoName : null,
      sourceVersion: input.source.kind === "package_release"
        ? input.source.version ?? null
        : null,
      sourceRef: input.target.ref,
      sourceRefType: input.target.refType,
      sourceCommitSha: input.target.commitSha,
      sourceReleaseId: input.releaseId ?? null,
      sourceTag: input.releaseTag ?? null,
      status: input.applyResult.applied.some((entry) => entry.status === "failed")
        ? "failed"
        : "applied",
      manifestJson: JSON.stringify(input.manifest),
      buildSourcesJson: JSON.stringify(input.buildSources),
      hostnamesJson: JSON.stringify(input.hostnames),
      resultJson: JSON.stringify(input.applyResult),
      rollbackOfAppDeploymentId: input.rollbackOfAppDeploymentId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies typeof appDeployments.$inferInsert;
    await db.insert(appDeployments).values(row);
    return toAppDeploymentRecord(row as AppDeploymentRow, input.group.name);
  }

  private async ensureTargetGroup(
    spaceId: string,
    groupName: string,
    manifest: AppManifest,
    options: {
      providerName?: GroupProviderName;
      envName?: string;
    },
  ): Promise<GroupRow> {
    const existing = await findGroupByName(this.env, spaceId, groupName);
    if (!existing) {
      return createGroupByName(this.env, {
        spaceId,
        groupName,
        provider: options.providerName ?? null,
        envName: options.envName ?? null,
        appVersion: manifest.spec.version ?? null,
        manifest,
      });
    }

    if (options.providerName !== undefined || options.envName !== undefined) {
      return updateGroupMetadata(this.env, existing.id, {
        ...(options.providerName !== undefined
          ? { provider: options.providerName }
          : {}),
        ...(options.envName !== undefined ? { envName: options.envName } : {}),
      });
    }
    return existing;
  }

  private async deployResolved(
    spaceId: string,
    userId: string,
    input: {
      source: AppDeploymentSourceInput;
      target: ResolvedRepoTarget;
      manifest: AppManifest;
      buildSources: AppDeploymentBuildSource[];
      artifacts: Record<string, unknown>;
      groupName?: string;
      providerName?: GroupProviderName;
      envName?: string;
      releaseId?: string | null;
      releaseTag?: string | null;
      rollbackOfAppDeploymentId?: string | null;
    },
  ): Promise<AppDeploymentMutationResult> {
    const groupName = input.groupName || resolveDefaultGroupName(
      input.source,
      input.manifest,
    );
    const group = await this.ensureTargetGroup(spaceId, groupName, input.manifest, {
      providerName: input.providerName,
      envName: input.envName,
    });
    const applyResult = buildSafeApplyResult(await applyManifest(
      this.env,
      group.id,
      input.manifest,
      {
        groupName: group.name,
        envName: input.envName ?? group.env ?? undefined,
        artifacts: input.artifacts,
      },
    ));
    const state = await getGroupState(this.env, group.id);
    const hostnames = collectGroupHostnames(state);
    const appDeployment = await this.createRecord({
      group,
      source: input.source,
      target: input.target,
      manifest: input.manifest,
      buildSources: input.buildSources,
      hostnames,
      applyResult,
      createdByAccountId: userId,
      releaseId: input.releaseId,
      releaseTag: input.releaseTag,
      rollbackOfAppDeploymentId: input.rollbackOfAppDeploymentId,
    });

    return {
      appDeployment,
      applyResult,
    };
  }

  async deploy(
    spaceId: string,
    userId: string,
    input: CreateAppDeploymentInput,
  ): Promise<AppDeploymentMutationResult> {
    if (input.source.kind === "repo_ref") {
      const target = await resolveRepoTargetById(this.env, {
        spaceId,
        userId,
        repoId: input.source.repoId,
        ref: input.source.ref,
        refType: input.source.refType,
      });
      const manifest = await readManifestFromRepoTarget(this.env, target);
      const { buildSources } = await this.resolveBuildArtifacts(target, manifest);
      const artifacts = await collectArtifactsForApply(
        this.env,
        target,
        manifest,
        buildSources,
      );
      return this.deployResolved(spaceId, userId, {
        source: input.source,
        target,
        manifest,
        buildSources,
        artifacts,
        groupName: input.groupName,
        providerName: input.providerName,
        envName: input.envName,
      });
    }

    const resolved = await resolvePackageRelease(this.env, {
      spaceId,
      userId,
      owner: input.source.owner,
      repoName: input.source.repoName,
      version: input.source.version,
    });
    const manifest = await readManifestFromRepoTarget(this.env, resolved.target);
    const { buildSources } = await this.resolveBuildArtifacts(resolved.target, manifest);
    const artifacts = await collectArtifactsForApply(
      this.env,
      resolved.target,
      manifest,
      buildSources,
    );

    return this.deployResolved(spaceId, userId, {
      source: input.source,
      target: resolved.target,
      manifest,
      buildSources,
      artifacts,
      groupName: input.groupName,
      providerName: input.providerName,
      envName: input.envName,
      releaseId: resolved.releaseId,
      releaseTag: resolved.releaseTag,
    });
  }

  async deployFromRepoRef(
    spaceId: string,
    userId: string,
    input: {
      repoId: string;
      ref?: string;
      refType?: RepoRefType;
      approveOauthAutoEnv?: boolean;
      approveSourceChange?: boolean;
      groupName?: string;
      providerName?: GroupProviderName;
      envName?: string;
    },
  ): Promise<AppDeploymentMutationResult> {
    return this.deploy(spaceId, userId, {
      groupName: input.groupName,
      providerName: input.providerName,
      envName: input.envName,
      approveOauthAutoEnv: input.approveOauthAutoEnv,
      approveSourceChange: input.approveSourceChange,
      source: {
        kind: "repo_ref",
        repoId: input.repoId,
        ref: input.ref,
        refType: input.refType,
      },
    });
  }

  async list(spaceId: string): Promise<AppDeploymentRecord[]> {
    const db = getDb(this.env.DB);
    const rows = await db.select().from(appDeployments)
      .where(and(eq(appDeployments.spaceId, spaceId), ne(appDeployments.status, "deleted")))
      .orderBy(desc(appDeployments.createdAt))
      .all();
    const groupNames = await loadGroupNames(this.env, rows);
    return rows.map((row) =>
      toAppDeploymentRecord(
        row,
        groupNames.get(row.groupId) ||
          safeJsonParseOrDefault<AppManifest | null>(row.manifestJson, null)?.metadata?.name ||
          row.groupId,
      )
    );
  }

  async get(
    spaceId: string,
    appDeploymentId: string,
  ): Promise<AppDeploymentRecord | null> {
    const db = getDb(this.env.DB);
    const row = await db.select().from(appDeployments).where(and(
      eq(appDeployments.id, appDeploymentId),
      eq(appDeployments.spaceId, spaceId),
      ne(appDeployments.status, "deleted"),
    )).get();
    if (!row) return null;
    const group = await findGroupById(this.env, row.groupId);
    return toAppDeploymentRecord(
      row,
      group?.name ||
        safeJsonParseOrDefault<AppManifest | null>(row.manifestJson, null)?.metadata?.name ||
        row.groupId,
    );
  }

  async remove(spaceId: string, appDeploymentId: string): Promise<void> {
    const db = getDb(this.env.DB);
    const existing = await db.select({ id: appDeployments.id })
      .from(appDeployments)
      .where(and(
        eq(appDeployments.id, appDeploymentId),
        eq(appDeployments.spaceId, spaceId),
        ne(appDeployments.status, "deleted"),
      ))
      .get();
    if (!existing) {
      throw new NotFoundError("App deployment");
    }

    await db.update(appDeployments).set({
      status: "deleted",
      updatedAt: new Date().toISOString(),
    }).where(eq(appDeployments.id, appDeploymentId)).run();
  }

  async rollback(
    spaceId: string,
    userId: string,
    appDeploymentId: string,
    _options?: {
      approveOauthAutoEnv?: boolean;
    },
  ): Promise<AppDeploymentMutationResult> {
    const db = getDb(this.env.DB);
    const current = await db.select().from(appDeployments).where(and(
      eq(appDeployments.id, appDeploymentId),
      eq(appDeployments.spaceId, spaceId),
      ne(appDeployments.status, "deleted"),
    )).get();
    if (!current) {
      throw new NotFoundError("App deployment");
    }

    const previous = await db.select().from(appDeployments).where(and(
      eq(appDeployments.spaceId, spaceId),
      eq(appDeployments.groupId, current.groupId),
      eq(appDeployments.status, "applied"),
      ne(appDeployments.id, current.id),
      lt(appDeployments.createdAt, current.createdAt),
    )).orderBy(desc(appDeployments.createdAt)).get();
    if (!previous) {
      throw new ConflictError("No previous successful deployment to roll back to");
    }

    const providerName = parseProviderName((await findGroupById(this.env, previous.groupId))?.provider);
    const storedSource = buildSourceFromRow(previous);
    const input: CreateAppDeploymentInput = storedSource.kind === "repo_ref"
      ? {
        groupName: (await findGroupById(this.env, previous.groupId))?.name,
        providerName: providerName ?? undefined,
        envName: (await findGroupById(this.env, previous.groupId))?.env ?? undefined,
        source: {
          kind: "repo_ref",
          repoId: storedSource.repo_id,
          ref: storedSource.commit_sha ?? storedSource.ref ?? undefined,
          refType: storedSource.commit_sha ? "commit" : (storedSource.ref_type ?? "branch"),
        },
      }
      : {
        groupName: (await findGroupById(this.env, previous.groupId))?.name,
        providerName: providerName ?? undefined,
        envName: (await findGroupById(this.env, previous.groupId))?.env ?? undefined,
        source: {
          kind: "package_release",
          owner: storedSource.owner,
          repoName: storedSource.repo_name,
          version: storedSource.version ?? storedSource.release_tag ?? undefined,
        },
      };

    const result = await this.deploy(spaceId, userId, input);
    const appDeployment = {
      ...result.appDeployment,
      rollback_of_app_deployment_id: current.id,
    };

    await db.update(appDeployments).set({
      rollbackOfAppDeploymentId: current.id,
      updatedAt: new Date().toISOString(),
    }).where(eq(appDeployments.id, result.appDeployment.id)).run();

    return {
      appDeployment,
      applyResult: result.applyResult,
    };
  }

  async getRolloutState(): Promise<never> {
    throwRemovedRollout();
  }
}
