import { and, desc, eq, lt, ne } from "drizzle-orm";
import { appDeployments, getDb } from "../../../infra/db/index.ts";
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
import { computeDiff } from "../deployment/diff.ts";
import {
  findGroupById,
  findGroupByName,
  type GroupProviderName,
  updateGroupSourceProjection,
} from "../groups/records.ts";
import type { AppManifest } from "../source/app-manifest.ts";
import {
  buildTakosRepositoryUrl,
  type RepoRefType,
  repositoryUrlKey,
} from "./app-deployment-source.ts";
import { resolveBuildArtifacts } from "./app-deployments-artifacts.ts";
import type {
  AppDeploymentMutationResult,
  AppDeploymentPlanResult,
  AppDeploymentRecord,
  AppDeploymentRow,
  AppDeploymentSourceInput,
  GitRefDeploymentSource,
  ResolvedGitTarget,
  SnapshotApplyArtifact,
  StoredDeploymentSnapshot,
} from "./app-deployments-model.ts";
import {
  buildSnapshot,
  cloneSnapshotToDeployment,
  loadSnapshot,
} from "./app-deployments-snapshots.ts";
import {
  collectGroupHostnames,
  createAppDeploymentRecord,
  createAppDeploymentRecordForManifest,
  deriveSourceInputFromRow,
  ensureTargetGroup,
  hasApplyFailures,
  loadGroupNames,
  parseProviderName,
  toAppDeploymentRecord,
} from "./app-deployments-records.ts";
import {
  readManifestFromRepoTarget,
  resolveGitTarget,
  resolveRepositoryLocatorById,
} from "./app-deployments-targets.ts";

export type {
  AppDeploymentMutationResult,
  AppDeploymentRecord,
  AppDeploymentSourceInput,
  GitRefDeploymentSource,
} from "./app-deployments-model.ts";

type CreateAppDeploymentInput = {
  groupName?: string;
  providerName?: GroupProviderName;
  envName?: string;
  source: AppDeploymentSourceInput;
};

function resolveDefaultGroupName(manifest: AppManifest): string {
  return manifest.name;
}

function fallbackGroupName(row: AppDeploymentRow): string {
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

function buildPlanResponse(input: {
  group: Awaited<ReturnType<typeof findGroupByName>> | null;
  groupName: string;
  manifest: AppManifest;
  currentState: Awaited<ReturnType<typeof getGroupState>>;
  providerName?: GroupProviderName | null;
  envName?: string | null;
  ociOrchestratorUrl?: string;
}): AppDeploymentPlanResult {
  assertDeployValid(input.manifest);
  const desiredState = applyEngineDeps.compileGroupDesiredState(
    input.manifest,
    {
      groupName: input.group?.name ?? input.groupName,
      provider: input.providerName ?? input.group?.provider ?? "cloudflare",
      envName: input.envName ?? input.group?.env ?? "default",
    },
  );
  const translationReport = applyEngineDeps.buildTranslationReport(
    desiredState,
    { ociOrchestratorUrl: input.ociOrchestratorUrl },
  );
  return {
    group: {
      id: input.group?.id ?? null,
      name: input.group?.name ?? input.groupName,
      exists: Boolean(input.group),
    },
    diff: computeDiff(desiredState, input.currentState),
    translationReport,
  };
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

export class AppDeploymentService {
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
  ): Promise<StoredDeploymentSnapshot> {
    return await loadSnapshot(this.env, snapshotR2Key);
  }

  private async cloneSnapshotToDeployment(
    deploymentId: string,
    snapshot: StoredDeploymentSnapshot,
  ): Promise<StoredDeploymentSnapshot> {
    return await cloneSnapshotToDeployment(this.env, deploymentId, snapshot);
  }

  private async createRecord(
    input: Parameters<typeof createAppDeploymentRecord>[1],
  ): Promise<AppDeploymentRecord> {
    return await createAppDeploymentRecord(this.env, input);
  }

  private async ensureTargetGroup(
    spaceId: string,
    groupName: string,
    manifest: AppManifest,
    options: {
      providerName?: GroupProviderName | null;
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
      providerName?: GroupProviderName;
      envName?: string;
    },
  ): Promise<AppDeploymentPlanResult> {
    const groupName = input.groupName ||
      resolveDefaultGroupName(input.manifest);
    const group = await findGroupByName(this.env, spaceId, groupName);
    const currentState = group?.id
      ? await getGroupState(this.env, group.id)
      : null;
    return buildPlanResponse({
      group,
      groupName,
      manifest: input.manifest,
      currentState,
      providerName: input.providerName,
      envName: input.envName,
      ociOrchestratorUrl: this.env.OCI_ORCHESTRATOR_URL,
    });
  }

  private async updateGroupProjectionIfApplied(
    groupId: string,
    target: ResolvedGitTarget,
    appDeploymentId: string,
    applyResult: SafeApplyResult,
  ): Promise<void> {
    if (hasApplyFailures(applyResult)) return;
    await updateGroupSourceProjection(this.env, groupId, {
      kind: "git_ref",
      repositoryUrl: target.repositoryUrl,
      ref: target.ref,
      refType: target.refType,
      commitSha: target.commitSha,
      currentAppDeploymentId: appDeploymentId,
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
      rollbackOfAppDeploymentId?: string | null;
    },
  ): Promise<AppDeploymentMutationResult> {
    const { applyResult, hostnames } = await this.applySnapshotToGroup(
      input.group,
      input.snapshot,
      input.envName,
    );
    const appDeployment = await this.createRecord({
      deploymentId: input.deploymentId,
      group: input.group,
      target: input.target,
      manifest: input.snapshot.payload.manifest,
      buildSources: input.snapshot.payload.build_sources,
      hostnames,
      applyResult,
      createdByAccountId: input.createdByAccountId,
      snapshot: input.snapshot,
      rollbackOfAppDeploymentId: input.rollbackOfAppDeploymentId,
    });
    await this.updateGroupProjectionIfApplied(
      input.group.id,
      input.target,
      appDeployment.id,
      applyResult,
    );
    return {
      appDeployment,
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
      providerName?: GroupProviderName;
      envName?: string;
      rollbackOfAppDeploymentId?: string | null;
    },
  ): Promise<AppDeploymentMutationResult> {
    const groupName = input.groupName ||
      resolveDefaultGroupName(input.manifest);
    const group = await this.ensureTargetGroup(
      spaceId,
      groupName,
      input.manifest,
      {
        providerName: input.providerName,
        envName: input.envName,
      },
    );
    const deploymentId = generateId();
    const snapshot = await this.buildSnapshot(deploymentId, {
      groupName: group.name,
      providerName: parseProviderName(group.provider) ?? input.providerName ??
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
      rollbackOfAppDeploymentId: input.rollbackOfAppDeploymentId,
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
    row: AppDeploymentRow,
    userId: string,
  ): Promise<AppDeploymentRow> {
    if (row.snapshotR2Key && row.snapshotSha256 && row.snapshotFormat) {
      return row;
    }

    const source = await deriveSourceInputFromRow(this.env, row);
    if (!source) {
      throw new ConflictError(
        "This deployment predates immutable snapshots and its repository URL could not be reconstructed",
      );
    }

    const resolved = await this.resolveGitSource(row.spaceId, userId, source);
    const group = await findGroupById(this.env, row.groupId);
    const snapshot = await this.buildSnapshot(row.id, {
      groupName: fallbackGroupName(row),
      providerName: parseProviderName(group?.provider),
      envName: group?.env ?? null,
      source: {
        kind: "git_ref",
        target: resolved.target,
        buildSources: resolved.buildSources,
        packageFiles: resolved.packageFiles,
      },
      manifest: resolved.manifest,
      artifacts: resolved.artifacts,
    });

    const db = getDb(this.env.DB);
    await db.update(appDeployments).set({
      sourceKind: "git_ref",
      sourceRepositoryUrl: resolved.target.repositoryUrl,
      sourceResolvedRepoId: resolved.target.resolvedRepoId,
      sourceRepoId: resolved.target.resolvedRepoId,
      sourceRef: resolved.target.ref,
      sourceRefType: resolved.target.refType,
      sourceCommitSha: resolved.target.commitSha,
      manifestJson: JSON.stringify(resolved.manifest),
      buildSourcesJson: JSON.stringify(resolved.buildSources),
      snapshotR2Key: snapshot.r2Key,
      snapshotSha256: snapshot.sha256,
      snapshotSizeBytes: snapshot.sizeBytes,
      snapshotFormat: snapshot.format,
      updatedAt: new Date().toISOString(),
    }).where(eq(appDeployments.id, row.id)).run();

    const updated = await db.select().from(appDeployments)
      .where(eq(appDeployments.id, row.id))
      .get();
    if (!updated) {
      throw new NotFoundError("App deployment");
    }
    return updated;
  }

  async deploy(
    spaceId: string,
    userId: string,
    input: CreateAppDeploymentInput,
  ): Promise<AppDeploymentMutationResult> {
    if (input.source.kind === "manifest") {
      return await this.deployFromManifest(spaceId, userId, {
        manifest: input.source.manifest,
        artifacts: input.source.artifacts ?? [],
        groupName: input.groupName,
        providerName: input.providerName,
        envName: input.envName,
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
      providerName: input.providerName,
      envName: input.envName,
    });
  }

  async deployFromManifest(
    spaceId: string,
    userId: string,
    input: {
      manifest: AppManifest;
      artifacts?: Array<Record<string, unknown>>;
      groupName?: string;
      providerName?: GroupProviderName;
      envName?: string;
      rollbackOfAppDeploymentId?: string | null;
    },
  ): Promise<AppDeploymentMutationResult> {
    const groupName = input.groupName ||
      resolveDefaultGroupName(input.manifest);
    const group = await this.ensureTargetGroup(
      spaceId,
      groupName,
      input.manifest,
      {
        providerName: input.providerName,
        envName: input.envName,
      },
    );
    const envName = input.envName ?? group.env ?? null;
    const applyArtifacts = normalizeManifestArtifacts(input.artifacts);
    const applyResult = buildSafeApplyResult(
      await applyManifest(
        this.env,
        group.id,
        input.manifest,
        {
          groupName: group.name,
          envName: envName ?? undefined,
          artifacts: applyArtifacts,
        },
      ),
    );
    const state = await getGroupState(this.env, group.id);
    const hostnames = collectGroupHostnames(state);
    const deploymentId = generateId();
    const manifestArtifacts = input.artifacts ?? [];
    // Persist an immutable R2 snapshot so the deployment can later be used as
    // a rollback target — matching the existing git_ref deploy behavior.
    const snapshot = await this.buildSnapshot(deploymentId, {
      groupName: group.name,
      providerName: parseProviderName(group.provider) ?? input.providerName ??
        null,
      envName,
      source: {
        kind: "manifest",
        manifestArtifacts,
      },
      manifest: input.manifest,
      artifacts: applyArtifacts,
    });
    const appDeployment = await createAppDeploymentRecordForManifest(this.env, {
      deploymentId,
      group,
      manifest: input.manifest,
      artifacts: manifestArtifacts,
      hostnames,
      applyResult,
      createdByAccountId: userId,
      snapshot,
      rollbackOfAppDeploymentId: input.rollbackOfAppDeploymentId,
    });
    if (!hasApplyFailures(applyResult)) {
      await updateGroupSourceProjection(this.env, group.id, {
        kind: "local_upload",
        currentAppDeploymentId: appDeployment.id,
      });
    }
    return {
      appDeployment,
      applyResult,
    };
  }

  async planFromManifest(
    spaceId: string,
    _userId: string,
    input: {
      manifest: AppManifest;
      groupName?: string;
      providerName?: GroupProviderName;
      envName?: string;
    },
  ): Promise<AppDeploymentPlanResult> {
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
      providerName?: GroupProviderName;
      envName?: string;
    },
  ): Promise<AppDeploymentMutationResult> {
    const repo = await resolveRepositoryLocatorById(this.env, input.repoId);
    if (!repo) {
      throw new NotFoundError("Repository");
    }
    return await this.deploy(spaceId, userId, {
      groupName: input.groupName,
      providerName: input.providerName,
      envName: input.envName,
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
      providerName?: GroupProviderName;
      envName?: string;
    },
  ): Promise<AppDeploymentPlanResult> {
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
      providerName: input.providerName,
      envName: input.envName,
    });
  }

  async list(spaceId: string): Promise<AppDeploymentRecord[]> {
    const db = getDb(this.env.DB);
    const rows = await db.select().from(appDeployments)
      .where(
        and(
          eq(appDeployments.spaceId, spaceId),
          ne(appDeployments.status, "deleted"),
        ),
      )
      .orderBy(desc(appDeployments.createdAt))
      .all();
    const groupNames = await loadGroupNames(this.env, rows);
    return await Promise.all(rows.map((row) =>
      toAppDeploymentRecord(
        this.env,
        row,
        groupNames.get(row.groupId)?.name || fallbackGroupName(row),
        groupNames.get(row.groupId)?.exists === true,
      )
    ));
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
    return await toAppDeploymentRecord(
      this.env,
      row,
      group?.name || fallbackGroupName(row),
      group !== null,
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

    const previousRaw = await db.select().from(appDeployments).where(and(
      eq(appDeployments.spaceId, spaceId),
      eq(appDeployments.groupId, current.groupId),
      eq(appDeployments.status, "applied"),
      ne(appDeployments.id, current.id),
      lt(appDeployments.createdAt, current.createdAt),
    )).orderBy(desc(appDeployments.createdAt)).get();
    if (!previousRaw) {
      throw new ConflictError(
        "No previous successful deployment to roll back to",
      );
    }

    const previous = await this.ensureSnapshotForRow(previousRaw, userId);
    if (!previous.snapshotR2Key) {
      throw new ConflictError(
        "This deployment does not have an immutable snapshot and could not be backfilled",
      );
    }

    const snapshot = await this.loadSnapshot(previous.snapshotR2Key);
    const currentGroup = await findGroupById(this.env, current.groupId);
    if (!currentGroup) {
      throw new ConflictError(
        "Cannot roll back a group that has already been uninstalled or deleted. Create a new deployment explicitly.",
      );
    }
    const providerName = snapshot.payload.provider;
    const envName = snapshot.payload.env_name;
    const group = await this.ensureTargetGroup(
      spaceId,
      currentGroup.name,
      snapshot.payload.manifest,
      { providerName, envName },
    );
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
        rollbackOfAppDeploymentId: current.id,
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
      rollbackOfAppDeploymentId: current.id,
    });
  }

  private async finalizeManifestDeploymentRecord(
    input: {
      deploymentId: string;
      group: Awaited<ReturnType<typeof ensureTargetGroup>>;
      snapshot: StoredDeploymentSnapshot;
      createdByAccountId: string | null;
      envName: string | null | undefined;
      rollbackOfAppDeploymentId?: string | null;
    },
  ): Promise<AppDeploymentMutationResult> {
    const { applyResult, hostnames } = await this.applySnapshotToGroup(
      input.group,
      input.snapshot,
      input.envName,
    );
    const manifestArtifacts = input.snapshot.payload.source.kind === "manifest"
      ? input.snapshot.payload.source.manifest_artifacts
      : [];
    const appDeployment = await createAppDeploymentRecordForManifest(this.env, {
      deploymentId: input.deploymentId,
      group: input.group,
      manifest: input.snapshot.payload.manifest,
      artifacts: manifestArtifacts,
      hostnames,
      applyResult,
      createdByAccountId: input.createdByAccountId,
      snapshot: input.snapshot,
      rollbackOfAppDeploymentId: input.rollbackOfAppDeploymentId ?? null,
    });
    if (!hasApplyFailures(applyResult)) {
      await updateGroupSourceProjection(this.env, input.group.id, {
        kind: "local_upload",
        currentAppDeploymentId: appDeployment.id,
      });
    }
    return {
      appDeployment,
      applyResult,
    };
  }
}
