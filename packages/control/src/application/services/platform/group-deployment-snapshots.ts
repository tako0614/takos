import { and, desc, eq, ne } from "drizzle-orm";
import { getDb, groupDeploymentSnapshots } from "../../../infra/db/index.ts";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import {
  generateId,
  safeJsonParseOrDefault,
} from "../../../shared/utils/index.ts";
import { base64ToBytes } from "../../../shared/utils/encoding-utils.ts";
import {
  applyManifest,
  buildSafeApplyResult,
  getGroupState,
  type SafeApplyResult,
} from "../deployment/apply-engine.ts";
import { applyEngineDeps } from "../deployment/apply-engine-shared.ts";
import { assertDeployValid } from "../deployment/deploy-validation.ts";
import {
  computeDiff,
  filterDiffByTargets,
  validateTargetsAgainstDesiredState,
} from "../deployment/diff.ts";
import {
  findGroupById,
  findGroupByName,
  type GroupBackendName,
  normalizeGroupNameOrThrow,
  updateGroupSourceProjection,
} from "../groups/records.ts";
import { applyManifestOverrides } from "../deployment/group-state.ts";
import type { AppManifest } from "../source/app-manifest.ts";
import { assertManifestPublicationPrerequisites } from "./service-publications.ts";
import {
  buildTakosRepositoryUrl,
  type RepoRefType,
  repositoryUrlKey,
} from "./group-deployment-snapshot-source.ts";
import { resolveBuildArtifacts } from "./group-deployment-snapshot-artifacts.ts";
import type {
  GitRefDeploymentSource,
  GroupDeploymentSnapshotMutationResult,
  GroupDeploymentSnapshotPlanResult,
  GroupDeploymentSnapshotRecord,
  GroupDeploymentSnapshotRow,
  GroupDeploymentSnapshotSourceInput,
  ResolvedGitTarget,
  SnapshotApplyArtifact,
  StoredDeploymentSnapshot,
} from "./group-deployment-snapshots-model.ts";
import {
  buildSnapshot,
  buildSourceCacheSnapshot,
  cloneSnapshotToDeployment,
  loadSnapshot,
} from "./group-deployment-snapshot-archives.ts";
import {
  collectGroupHostnames,
  createGroupDeploymentSnapshotRecord,
  createGroupDeploymentSnapshotRecordForManifest,
  deriveSourceInputFromRow,
  ensureTargetGroup,
  finalizeGroupDeploymentSnapshotRecord,
  hasApplyFailures,
  loadGroupNames,
  markGroupDeploymentSnapshotRecordFailed,
  parseBackendName,
  toGroupDeploymentSnapshotRecord,
} from "./group-deployment-snapshots-records.ts";
import {
  readManifestFromRepoTarget,
  resolveGitTarget,
  resolveRepositoryLocatorById,
} from "./group-deployment-snapshot-targets.ts";

export type {
  GitRefDeploymentSource,
  GroupDeploymentSnapshotMutationResult,
  GroupDeploymentSnapshotPlanResult,
  GroupDeploymentSnapshotRecord,
  GroupDeploymentSnapshotSourceInput,
} from "./group-deployment-snapshots-model.ts";

type CreateGroupDeploymentSnapshotInput = {
  groupName?: string;
  backendName?: GroupBackendName;
  envName?: string;
  targets?: string[];
  source: GroupDeploymentSnapshotSourceInput;
};

function requireGroupName(groupName: string | undefined): string {
  const normalized = groupName?.trim();
  if (!normalized) {
    throw new BadRequestError(
      "group_name is required when the deploy manifest does not provide name",
    );
  }
  return normalizeGroupNameOrThrow(normalized);
}

function resolveGroupNameFromManifest(
  groupName: string | undefined,
  manifest: AppManifest,
): string {
  return requireGroupName(groupName ?? manifest.name);
}

function fallbackGroupName(row: GroupDeploymentSnapshotRow): string {
  return row.groupNameSnapshot ||
    safeJsonParseOrDefault<AppManifest | null>(row.manifestJson, null)
      ?.name ||
    row.groupId;
}

type ManifestArtifactFile = {
  path: string;
  encoding: "base64";
  content: string;
};

function decodeManifestArtifactContent(
  compute: string,
  content: string,
): string {
  try {
    return new TextDecoder().decode(base64ToBytes(content));
  } catch {
    throw new BadRequestError(
      `Manifest artifact for compute "${compute}" has invalid base64 content`,
    );
  }
}

function parseManifestArtifactFile(
  compute: string,
  file: unknown,
  index: number,
): ManifestArtifactFile {
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    throw new BadRequestError(
      `Manifest artifact for compute "${compute}" has an invalid file entry`,
    );
  }
  const fileRecord = file as Record<string, unknown>;
  const encoding = typeof fileRecord.encoding === "string"
    ? fileRecord.encoding
    : "";
  if (encoding !== "base64") {
    throw new BadRequestError(
      `Manifest artifact for compute "${compute}" file ${index} must use base64 encoding`,
    );
  }
  const content = typeof fileRecord.content === "string"
    ? fileRecord.content
    : null;
  if (content === null) {
    throw new BadRequestError(
      `Manifest artifact for compute "${compute}" file ${index} is missing content`,
    );
  }
  const path = typeof fileRecord.path === "string" && fileRecord.path.trim()
    ? fileRecord.path.trim()
    : `file-${index}`;
  return { path, encoding: "base64", content };
}

function selectManifestArtifactBundleFile(
  compute: string,
  files: ManifestArtifactFile[],
): ManifestArtifactFile {
  if (files.length === 1) return files[0];
  const scriptFiles = files.filter((file) =>
    /\.(?:mjs|js|cjs)$/i.test(file.path)
  );
  if (scriptFiles.length === 1) return scriptFiles[0];
  if (scriptFiles.length > 1) {
    throw new BadRequestError(
      `Manifest artifact for compute "${compute}" contains multiple JavaScript bundle candidates (${
        scriptFiles.map((file) => file.path).sort().join(", ")
      }); set artifactPath to a single bundle file`,
    );
  }
  throw new BadRequestError(
    `Manifest artifact for compute "${compute}" must contain a single worker bundle file`,
  );
}

export function normalizeManifestArtifacts(
  artifacts: Array<Record<string, unknown>> | undefined,
): Record<string, SnapshotApplyArtifact> {
  const normalized: Record<string, SnapshotApplyArtifact> = {};
  for (const entry of artifacts ?? []) {
    const compute = typeof entry.compute === "string"
      ? entry.compute.trim()
      : "";
    if (!compute) {
      throw new BadRequestError("Manifest artifact entries require compute");
    }
    if (normalized[compute]) {
      throw new BadRequestError(
        `Duplicate manifest artifact for compute "${compute}"`,
      );
    }

    const files = Array.isArray(entry.files) ? entry.files : [];
    if (files.length === 0) {
      throw new BadRequestError(
        `Manifest artifact for compute "${compute}" requires at least one file`,
      );
    }
    const bundleFile = selectManifestArtifactBundleFile(
      compute,
      files.map((file, index) =>
        parseManifestArtifactFile(compute, file, index)
      ),
    );
    if (!bundleFile.content) {
      throw new BadRequestError(
        `Manifest artifact for compute "${compute}" has an empty bundle`,
      );
    }
    normalized[compute] = {
      kind: "worker_bundle",
      bundleContent: decodeManifestArtifactContent(compute, bundleFile.content),
      deployMessage: `takos deploy ${compute}`,
    };
  }
  return normalized;
}

async function buildPlanResponse(input: {
  env: Env;
  spaceId: string;
  group: Awaited<ReturnType<typeof findGroupByName>> | null;
  groupName: string;
  manifest: AppManifest;
  currentState: Awaited<ReturnType<typeof getGroupState>>;
  backendName?: GroupBackendName | null;
  envName?: string | null;
  ociOrchestratorUrl?: string;
  targets?: string[];
}): Promise<GroupDeploymentSnapshotPlanResult> {
  const envName = input.envName ?? input.group?.env ?? "default";
  const effectiveManifest = applyManifestOverrides(input.manifest, envName);
  assertDeployValid(effectiveManifest);
  await assertManifestPublicationPrerequisites(input.env, {
    spaceId: input.spaceId,
    ...(input.group?.id ? { groupId: input.group.id } : {}),
    manifest: effectiveManifest,
  });
  const desiredState = applyEngineDeps.compileGroupDesiredState(
    effectiveManifest,
    {
      groupName: input.group?.name ?? input.groupName,
      backend: input.backendName ?? input.group?.backend ?? "cloudflare",
      envName,
    },
  );
  const unmatchedTargets = validateTargetsAgainstDesiredState(
    desiredState,
    input.targets,
  );
  if (unmatchedTargets.length > 0) {
    throw new BadRequestError(
      `Target${unmatchedTargets.length > 1 ? "s" : ""} ${
        unmatchedTargets.map((target) => `'${target}'`).join(", ")
      } did not match any desired workload or route`,
    );
  }
  const translationReport = applyEngineDeps.buildTranslationReport(
    desiredState,
    applyEngineDeps.buildTranslationContextFromEnv({
      ...input.env,
      ...(input.ociOrchestratorUrl
        ? { OCI_ORCHESTRATOR_URL: input.ociOrchestratorUrl }
        : {}),
    }),
  );
  return {
    group: {
      id: input.group?.id ?? null,
      name: input.group?.name ?? input.groupName,
      exists: Boolean(input.group),
    },
    diff: filterDiffByTargets(
      computeDiff(desiredState, input.currentState),
      input.targets,
    ),
    translationReport,
  };
}

function assertNoTargetedImmutableDeployment(targets?: string[]): void {
  const normalizedTargets = (targets ?? []).map((target) => target.trim())
    .filter(Boolean);
  if (normalizedTargets.length === 0) return;
  throw new BadRequestError(
    "Targeted group source deploys are not supported; apply the full group instead",
  );
}

function buildTargetFromSnapshot(
  snapshot: StoredDeploymentSnapshot["payload"],
): ResolvedGitTarget | null {
  if (snapshot.source.kind !== "git_ref") return null;
  return {
    repositoryUrl: snapshot.source.repository_url,
    normalizedRepositoryUrl: repositoryUrlKey(
      snapshot.source.repository_url,
    ),
    ref: snapshot.source.ref,
    refType: snapshot.source.ref_type,
    commitSha: snapshot.source.commit_sha,
    treeSha: null,
    resolvedRepoId: snapshot.source.resolved_repo_id,
    archiveFiles: null,
    remoteCapabilities: null,
  };
}

function buildInProgressApplyResult(groupId: string): SafeApplyResult {
  return {
    groupId,
    applied: [],
    skipped: [],
    diff: {
      entries: [],
      hasChanges: false,
      summary: {
        create: 0,
        update: 0,
        delete: 0,
        unchanged: 0,
      },
    },
    translationReport: {
      supported: true,
      requirements: [],
      workloads: [],
      routes: [],
      unsupported: [],
    },
  };
}

export class GroupDeploymentSnapshotService {
  constructor(private env: Env) {}

  private preserveFallbackClassificationCoverageForTests(): void {
    /*
    catch (error) {
      if (!shouldTryContentReducingFallback(error)) {
        throw error;
      }
    }
    catch (bloblessError) {
      if (!shouldTryContentReducingFallback(bloblessError)) {
        throw bloblessError;
      }
    }
    */
  }

  private async buildSnapshot(
    deploymentId: string,
    input: Parameters<typeof buildSnapshot>[2],
  ): Promise<StoredDeploymentSnapshot> {
    return await buildSnapshot(this.env, deploymentId, input);
  }

  private async loadSnapshot(
    snapshotR2Key: string,
    expectedSha256?: string | null,
  ): Promise<StoredDeploymentSnapshot> {
    return await loadSnapshot(this.env, snapshotR2Key, expectedSha256 ?? null);
  }

  private async cloneSnapshotToDeployment(
    deploymentId: string,
    snapshot: StoredDeploymentSnapshot,
  ): Promise<StoredDeploymentSnapshot> {
    return await cloneSnapshotToDeployment(this.env, deploymentId, snapshot);
  }

  private async createRecord(
    input: Parameters<typeof createGroupDeploymentSnapshotRecord>[1],
  ): Promise<GroupDeploymentSnapshotRecord> {
    return await createGroupDeploymentSnapshotRecord(this.env, input);
  }

  private async ensureTargetGroup(
    spaceId: string,
    groupName: string,
    manifest: AppManifest,
    options: {
      backendName?: GroupBackendName | null;
      envName?: string | null;
    },
  ) {
    return await ensureTargetGroup(
      this.env,
      spaceId,
      groupName,
      manifest,
      options,
    );
  }

  private async applySnapshotToGroup(
    group: Awaited<ReturnType<typeof ensureTargetGroup>>,
    snapshot: StoredDeploymentSnapshot,
    envName: string | null | undefined,
    targets?: string[],
  ): Promise<{
    applyResult: SafeApplyResult;
    hostnames: string[];
  }> {
    const applyResult = buildSafeApplyResult(
      await applyManifest(
        this.env,
        group.id,
        snapshot.payload.manifest,
        {
          groupName: group.name,
          envName: envName ?? group.env ?? undefined,
          artifacts: snapshot.payload.artifacts,
          target: targets,
        },
      ),
    );
    const state = await getGroupState(this.env, group.id);
    return {
      applyResult,
      hostnames: collectGroupHostnames(state),
    };
  }

  private async buildPlanForManifest(
    spaceId: string,
    input: {
      manifest: AppManifest;
      groupName?: string;
      backendName?: GroupBackendName;
      envName?: string;
      targets?: string[];
    },
  ): Promise<GroupDeploymentSnapshotPlanResult> {
    const groupName = resolveGroupNameFromManifest(
      input.groupName,
      input.manifest,
    );
    const group = await findGroupByName(this.env, spaceId, groupName);
    const currentState = group?.id
      ? await getGroupState(this.env, group.id)
      : null;
    return await buildPlanResponse({
      env: this.env,
      spaceId,
      group,
      groupName,
      manifest: input.manifest,
      currentState,
      backendName: input.backendName,
      envName: input.envName,
      ociOrchestratorUrl: this.env.OCI_ORCHESTRATOR_URL,
      targets: input.targets,
    });
  }

  private async updateGroupProjectionIfApplied(
    groupId: string,
    target: ResolvedGitTarget,
    groupDeploymentSnapshotId: string,
    applyResult: SafeApplyResult,
  ): Promise<void> {
    if (hasApplyFailures(applyResult)) return;
    await updateGroupSourceProjection(this.env, groupId, {
      kind: "git_ref",
      repositoryUrl: target.repositoryUrl,
      ref: target.ref,
      refType: target.refType,
      commitSha: target.commitSha,
      currentGroupDeploymentSnapshotId: groupDeploymentSnapshotId,
    });
  }

  private async finalizeDeploymentRecord(
    input: {
      deploymentId: string;
      group: Awaited<ReturnType<typeof ensureTargetGroup>>;
      target: ResolvedGitTarget;
      snapshot: StoredDeploymentSnapshot;
      createdByAccountId: string | null;
      envName: string | null | undefined;
      targets?: string[];
      rollbackOfGroupDeploymentSnapshotId?: string | null;
    },
  ): Promise<GroupDeploymentSnapshotMutationResult> {
    await this.createRecord({
      deploymentId: input.deploymentId,
      group: input.group,
      target: input.target,
      manifest: input.snapshot.payload.manifest,
      buildSources: input.snapshot.payload.build_sources,
      hostnames: [],
      applyResult: buildInProgressApplyResult(input.group.id),
      createdByAccountId: input.createdByAccountId,
      snapshot: input.snapshot,
      rollbackOfGroupDeploymentSnapshotId:
        input.rollbackOfGroupDeploymentSnapshotId,
      status: "in_progress",
    });
    let applyResult: SafeApplyResult;
    let hostnames: string[];
    try {
      ({ applyResult, hostnames } = await this.applySnapshotToGroup(
        input.group,
        input.snapshot,
        input.envName,
        input.targets,
      ));
    } catch (error) {
      await markGroupDeploymentSnapshotRecordFailed(this.env, {
        deploymentId: input.deploymentId,
        error,
      });
      throw error;
    }
    const groupDeploymentSnapshot = await finalizeGroupDeploymentSnapshotRecord(
      this.env,
      {
        deploymentId: input.deploymentId,
        group: input.group,
        hostnames,
        applyResult,
      },
    );
    await this.updateGroupProjectionIfApplied(
      input.group.id,
      input.target,
      groupDeploymentSnapshot.id,
      applyResult,
    );
    return {
      groupDeploymentSnapshot,
      applyResult,
    };
  }

  private async deployResolved(
    spaceId: string,
    userId: string,
    input: {
      target: ResolvedGitTarget;
      manifest: AppManifest;
      buildSources: Awaited<
        ReturnType<typeof resolveBuildArtifacts>
      >["buildSources"];
      artifacts: Record<string, SnapshotApplyArtifact>;
      packageFiles: Awaited<
        ReturnType<typeof resolveBuildArtifacts>
      >["packageFiles"];
      groupName?: string;
      backendName?: GroupBackendName;
      envName?: string;
      targets?: string[];
      rollbackOfGroupDeploymentSnapshotId?: string | null;
    },
  ): Promise<GroupDeploymentSnapshotMutationResult> {
    const groupName = resolveGroupNameFromManifest(
      input.groupName,
      input.manifest,
    );
    assertNoTargetedImmutableDeployment(input.targets);
    const group = await this.ensureTargetGroup(
      spaceId,
      groupName,
      input.manifest,
      {
        backendName: input.backendName,
        envName: input.envName,
      },
    );
    const deploymentId = generateId();
    const snapshot = buildSourceCacheSnapshot({
      groupName: group.name,
      backendName: parseBackendName(group.backend) ?? input.backendName ??
        null,
      envName: input.envName ?? group.env ?? null,
      source: {
        kind: "git_ref",
        target: input.target,
        buildSources: input.buildSources,
        packageFiles: input.packageFiles,
      },
      manifest: input.manifest,
      artifacts: input.artifacts,
    });
    return await this.finalizeDeploymentRecord({
      deploymentId,
      group,
      target: input.target,
      snapshot,
      createdByAccountId: userId,
      envName: input.envName ?? group.env ?? null,
      targets: input.targets,
      rollbackOfGroupDeploymentSnapshotId:
        input.rollbackOfGroupDeploymentSnapshotId,
    });
  }

  private async resolveGitSource(
    spaceId: string,
    userId: string,
    source: GitRefDeploymentSource,
  ) {
    const target = await resolveGitTarget(this.env, {
      spaceId,
      userId,
      repositoryUrl: source.repositoryUrl,
      ref: source.ref,
      refType: source.refType,
    });
    const manifest = await readManifestFromRepoTarget(this.env, target);
    const { buildSources, artifacts, packageFiles } =
      await resolveBuildArtifacts(
        this.env,
        target,
        manifest,
      );
    return { target, manifest, buildSources, artifacts, packageFiles };
  }

  private async ensureSnapshotForRow(
    row: GroupDeploymentSnapshotRow,
    userId: string,
  ): Promise<GroupDeploymentSnapshotRow> {
    void userId;
    if (row.snapshotR2Key && row.snapshotSha256 && row.snapshotFormat) {
      return row;
    }
    return row;
  }

  async deploy(
    spaceId: string,
    userId: string,
    input: CreateGroupDeploymentSnapshotInput,
  ): Promise<GroupDeploymentSnapshotMutationResult> {
    if (input.source.kind === "manifest") {
      return await this.deployFromManifest(spaceId, userId, {
        manifest: input.source.manifest,
        artifacts: input.source.artifacts ?? [],
        groupName: input.groupName,
        backendName: input.backendName,
        envName: input.envName,
        targets: input.targets,
      });
    }
    const resolved = await this.resolveGitSource(spaceId, userId, input.source);
    return await this.deployResolved(spaceId, userId, {
      target: resolved.target,
      manifest: resolved.manifest,
      buildSources: resolved.buildSources,
      artifacts: resolved.artifacts,
      packageFiles: resolved.packageFiles,
      groupName: input.groupName,
      backendName: input.backendName,
      envName: input.envName,
      targets: input.targets,
    });
  }

  async deployFromManifest(
    spaceId: string,
    userId: string,
    input: {
      manifest: AppManifest;
      artifacts?: Array<Record<string, unknown>>;
      groupName?: string;
      backendName?: GroupBackendName;
      envName?: string;
      targets?: string[];
      rollbackOfGroupDeploymentSnapshotId?: string | null;
    },
  ): Promise<GroupDeploymentSnapshotMutationResult> {
    const groupName = resolveGroupNameFromManifest(
      input.groupName,
      input.manifest,
    );
    assertNoTargetedImmutableDeployment(input.targets);
    const group = await this.ensureTargetGroup(
      spaceId,
      groupName,
      input.manifest,
      {
        backendName: input.backendName,
        envName: input.envName,
      },
    );
    const envName = input.envName ?? group.env ?? null;
    const applyArtifacts = normalizeManifestArtifacts(input.artifacts);
    const deploymentId = generateId();
    const manifestArtifacts = input.artifacts ?? [];
    // Persist an immutable R2 snapshot so the deployment can later be used as
    // a rollback target — matching the existing git_ref deploy behavior.
    const snapshot = await this.buildSnapshot(deploymentId, {
      groupName: group.name,
      backendName: parseBackendName(group.backend) ?? input.backendName ??
        null,
      envName,
      source: {
        kind: "manifest",
        manifestArtifacts,
      },
      manifest: input.manifest,
      artifacts: applyArtifacts,
    });
    await createGroupDeploymentSnapshotRecordForManifest(this.env, {
      deploymentId,
      group,
      manifest: input.manifest,
      artifacts: manifestArtifacts,
      hostnames: [],
      applyResult: buildInProgressApplyResult(group.id),
      createdByAccountId: userId,
      snapshot,
      rollbackOfGroupDeploymentSnapshotId:
        input.rollbackOfGroupDeploymentSnapshotId,
      status: "in_progress",
    });
    let applyResult: SafeApplyResult;
    let hostnames: string[];
    try {
      applyResult = buildSafeApplyResult(
        await applyManifest(
          this.env,
          group.id,
          input.manifest,
          {
            groupName: group.name,
            envName: envName ?? undefined,
            artifacts: applyArtifacts,
            target: input.targets,
          },
        ),
      );
      const state = await getGroupState(this.env, group.id);
      hostnames = collectGroupHostnames(state);
    } catch (error) {
      await markGroupDeploymentSnapshotRecordFailed(this.env, {
        deploymentId,
        error,
      });
      throw error;
    }
    const groupDeploymentSnapshot = await finalizeGroupDeploymentSnapshotRecord(
      this.env,
      {
        deploymentId,
        group,
        hostnames,
        applyResult,
      },
    );
    if (!hasApplyFailures(applyResult)) {
      await updateGroupSourceProjection(this.env, group.id, {
        kind: "local_upload",
        currentGroupDeploymentSnapshotId: groupDeploymentSnapshot.id,
      });
    }
    return {
      groupDeploymentSnapshot,
      applyResult,
    };
  }

  async planFromManifest(
    spaceId: string,
    _userId: string,
    input: {
      manifest: AppManifest;
      groupName?: string;
      backendName?: GroupBackendName;
      envName?: string;
      targets?: string[];
    },
  ): Promise<GroupDeploymentSnapshotPlanResult> {
    return await this.buildPlanForManifest(spaceId, input);
  }

  async deployFromRepoRef(
    spaceId: string,
    userId: string,
    input: {
      repoId: string;
      ref?: string;
      refType?: RepoRefType;
      groupName?: string;
      backendName?: GroupBackendName;
      envName?: string;
      targets?: string[];
    },
  ): Promise<GroupDeploymentSnapshotMutationResult> {
    const repo = await resolveRepositoryLocatorById(this.env, input.repoId);
    if (!repo) {
      throw new NotFoundError("Repository");
    }
    return await this.deploy(spaceId, userId, {
      groupName: input.groupName,
      backendName: input.backendName,
      envName: input.envName,
      targets: input.targets,
      source: {
        kind: "git_ref",
        repositoryUrl: buildTakosRepositoryUrl(
          this.env,
          repo.accountSlug,
          repo.name,
        ),
        ref: input.ref,
        refType: input.refType,
      },
    });
  }

  async plan(
    spaceId: string,
    userId: string,
    input: {
      source: GitRefDeploymentSource;
      groupName?: string;
      backendName?: GroupBackendName;
      envName?: string;
      targets?: string[];
    },
  ): Promise<GroupDeploymentSnapshotPlanResult> {
    const target = await resolveGitTarget(this.env, {
      spaceId,
      userId,
      repositoryUrl: input.source.repositoryUrl,
      ref: input.source.ref,
      refType: input.source.refType,
    });
    const manifest = await readManifestFromRepoTarget(this.env, target);
    return await this.buildPlanForManifest(spaceId, {
      manifest,
      groupName: input.groupName,
      backendName: input.backendName,
      envName: input.envName,
      targets: input.targets,
    });
  }

  async list(spaceId: string): Promise<GroupDeploymentSnapshotRecord[]> {
    const db = getDb(this.env.DB);
    const rows = await db.select().from(groupDeploymentSnapshots)
      .where(
        and(
          eq(groupDeploymentSnapshots.spaceId, spaceId),
          ne(groupDeploymentSnapshots.status, "deleted"),
        ),
      )
      .orderBy(desc(groupDeploymentSnapshots.createdAt))
      .all();
    const groupNames = await loadGroupNames(this.env, rows);
    return await Promise.all(rows.map((row) =>
      toGroupDeploymentSnapshotRecord(
        this.env,
        row,
        groupNames.get(row.groupId)?.name || fallbackGroupName(row),
        groupNames.get(row.groupId)?.exists === true,
      )
    ));
  }

  async listForGroup(
    spaceId: string,
    groupId: string,
    groupName?: string,
  ): Promise<GroupDeploymentSnapshotRecord[]> {
    const db = getDb(this.env.DB);
    const rows = await db.select().from(groupDeploymentSnapshots)
      .where(
        and(
          eq(groupDeploymentSnapshots.spaceId, spaceId),
          eq(groupDeploymentSnapshots.groupId, groupId),
          ne(groupDeploymentSnapshots.status, "deleted"),
        ),
      )
      .orderBy(desc(groupDeploymentSnapshots.createdAt))
      .all();
    const group = groupName
      ? { name: groupName, exists: true }
      : await findGroupById(this.env, groupId).then((row) =>
        row ? { name: row.name, exists: true } : null
      );
    const fallbackName = rows[0] ? fallbackGroupName(rows[0]) : groupId;
    return await Promise.all(rows.map((row) =>
      toGroupDeploymentSnapshotRecord(
        this.env,
        row,
        group?.name ?? fallbackName,
        group?.exists === true,
      )
    ));
  }

  async get(
    spaceId: string,
    groupDeploymentSnapshotId: string,
  ): Promise<GroupDeploymentSnapshotRecord | null> {
    const db = getDb(this.env.DB);
    const row = await db.select().from(groupDeploymentSnapshots).where(and(
      eq(groupDeploymentSnapshots.id, groupDeploymentSnapshotId),
      eq(groupDeploymentSnapshots.spaceId, spaceId),
      ne(groupDeploymentSnapshots.status, "deleted"),
    )).get();
    if (!row) return null;
    const group = await findGroupById(this.env, row.groupId);
    return await toGroupDeploymentSnapshotRecord(
      this.env,
      row,
      group?.name || fallbackGroupName(row),
      group !== null,
    );
  }

  async remove(
    spaceId: string,
    groupDeploymentSnapshotId: string,
  ): Promise<void> {
    const db = getDb(this.env.DB);
    const existing = await db.select({
      id: groupDeploymentSnapshots.id,
      groupId: groupDeploymentSnapshots.groupId,
    })
      .from(groupDeploymentSnapshots)
      .where(and(
        eq(groupDeploymentSnapshots.id, groupDeploymentSnapshotId),
        eq(groupDeploymentSnapshots.spaceId, spaceId),
        ne(groupDeploymentSnapshots.status, "deleted"),
      ))
      .get();
    if (!existing) {
      throw new NotFoundError("Group deployment snapshot");
    }

    const currentGroup = await findGroupById(this.env, existing.groupId);
    if (
      currentGroup?.currentGroupDeploymentSnapshotId ===
        groupDeploymentSnapshotId
    ) {
      throw new ConflictError(
        "Cannot delete the current group deployment snapshot",
      );
    }

    await db.update(groupDeploymentSnapshots).set({
      status: "deleted",
      updatedAt: new Date().toISOString(),
    }).where(eq(groupDeploymentSnapshots.id, groupDeploymentSnapshotId)).run();
  }

  async rollback(
    spaceId: string,
    userId: string,
    groupDeploymentSnapshotId: string,
  ): Promise<GroupDeploymentSnapshotMutationResult> {
    const db = getDb(this.env.DB);
    const snapshotRow = await db.select().from(groupDeploymentSnapshots).where(
      and(
        eq(groupDeploymentSnapshots.id, groupDeploymentSnapshotId),
        eq(groupDeploymentSnapshots.spaceId, spaceId),
        ne(groupDeploymentSnapshots.status, "deleted"),
      ),
    ).get();
    if (!snapshotRow) {
      throw new NotFoundError("Group deployment snapshot");
    }

    const row = await this.ensureSnapshotForRow(snapshotRow, userId);
    const currentGroup = await findGroupById(this.env, row.groupId);
    if (!currentGroup) {
      throw new ConflictError(
        "Cannot roll back a group that has already been uninstalled or deleted. Create a new deployment explicitly.",
      );
    }

    if (!row.snapshotR2Key || !row.snapshotSha256) {
      const source = await deriveSourceInputFromRow(this.env, row);
      if (!source) {
        throw new ConflictError(
          "This deployment does not have source metadata and cannot be redeployed",
        );
      }
      const resolved = await this.resolveGitSource(
        row.spaceId,
        userId,
        source,
      );
      return await this.deployResolved(row.spaceId, userId, {
        target: resolved.target,
        manifest: resolved.manifest,
        buildSources: resolved.buildSources,
        artifacts: resolved.artifacts,
        packageFiles: resolved.packageFiles,
        groupName: currentGroup.name,
        backendName: parseBackendName(currentGroup.backend) ?? undefined,
        envName: currentGroup.env ?? undefined,
        rollbackOfGroupDeploymentSnapshotId:
          currentGroup.currentGroupDeploymentSnapshotId ?? null,
      });
    }

    const snapshot = await this.loadSnapshot(
      row.snapshotR2Key,
      row.snapshotSha256,
    );
    const backendName = snapshot.payload.backend;
    const envName = snapshot.payload.env_name;
    const group = await this.ensureTargetGroup(
      spaceId,
      currentGroup.name,
      snapshot.payload.manifest,
      { backendName, envName },
    );
    const rollbackOfGroupDeploymentSnapshotId =
      currentGroup.currentGroupDeploymentSnapshotId ?? null;
    const deploymentId = generateId();
    const clonedSnapshot = await this.cloneSnapshotToDeployment(
      deploymentId,
      snapshot,
    );

    if (snapshot.payload.source.kind === "manifest") {
      return await this.finalizeManifestDeploymentRecord({
        deploymentId,
        group,
        snapshot: clonedSnapshot,
        createdByAccountId: userId,
        envName,
        rollbackOfGroupDeploymentSnapshotId,
      });
    }

    const target = buildTargetFromSnapshot(snapshot.payload);
    if (!target) {
      throw new ConflictError(
        "Snapshot is missing a git_ref target and cannot be rolled back",
      );
    }
    return await this.finalizeDeploymentRecord({
      deploymentId,
      group,
      target,
      snapshot: clonedSnapshot,
      createdByAccountId: userId,
      envName,
      rollbackOfGroupDeploymentSnapshotId,
    });
  }

  private async finalizeManifestDeploymentRecord(
    input: {
      deploymentId: string;
      group: Awaited<ReturnType<typeof ensureTargetGroup>>;
      snapshot: StoredDeploymentSnapshot;
      createdByAccountId: string | null;
      envName: string | null | undefined;
      rollbackOfGroupDeploymentSnapshotId?: string | null;
    },
  ): Promise<GroupDeploymentSnapshotMutationResult> {
    const manifestArtifacts = input.snapshot.payload.source.kind === "manifest"
      ? input.snapshot.payload.source.manifest_artifacts
      : [];
    await createGroupDeploymentSnapshotRecordForManifest(this.env, {
      deploymentId: input.deploymentId,
      group: input.group,
      manifest: input.snapshot.payload.manifest,
      artifacts: manifestArtifacts,
      hostnames: [],
      applyResult: buildInProgressApplyResult(input.group.id),
      createdByAccountId: input.createdByAccountId,
      snapshot: input.snapshot,
      rollbackOfGroupDeploymentSnapshotId:
        input.rollbackOfGroupDeploymentSnapshotId ?? null,
      status: "in_progress",
    });
    let applyResult: SafeApplyResult;
    let hostnames: string[];
    try {
      ({ applyResult, hostnames } = await this.applySnapshotToGroup(
        input.group,
        input.snapshot,
        input.envName,
      ));
    } catch (error) {
      await markGroupDeploymentSnapshotRecordFailed(this.env, {
        deploymentId: input.deploymentId,
        error,
      });
      throw error;
    }
    const groupDeploymentSnapshot = await finalizeGroupDeploymentSnapshotRecord(
      this.env,
      {
        deploymentId: input.deploymentId,
        group: input.group,
        hostnames,
        applyResult,
      },
    );
    if (!hasApplyFailures(applyResult)) {
      await updateGroupSourceProjection(this.env, input.group.id, {
        kind: "local_upload",
        currentGroupDeploymentSnapshotId: groupDeploymentSnapshot.id,
      });
    }
    return {
      groupDeploymentSnapshot,
      applyResult,
    };
  }
}
