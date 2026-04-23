import type { groupDeploymentSnapshots } from "../../../infra/db/index.ts";
import type { SafeApplyResult } from "../deployment/apply-engine.ts";
import type { DiffResult } from "../deployment/diff.ts";
import type { TranslationReport } from "../deployment/translation-report.ts";
import type {
  AppManifest,
  GroupDeploymentSnapshotBuildSource,
} from "../source/app-manifest.ts";
import type { RepoRefType } from "./group-deployment-snapshot-source.ts";

export type GroupDeploymentSnapshotStatus =
  | "in_progress"
  | "applied"
  | "failed"
  | "deleted";

export type GitRefDeploymentSource = {
  kind: "git_ref";
  repositoryUrl: string;
  ref?: string;
  refType?: RepoRefType;
};

export type ManifestDeploymentSource = {
  kind: "manifest";
  manifest: AppManifest;
  artifacts?: Array<Record<string, unknown>>;
};

export type GroupDeploymentSnapshotSourceInput =
  | GitRefDeploymentSource
  | ManifestDeploymentSource;

export type ResolvedGitTarget = {
  repositoryUrl: string;
  normalizedRepositoryUrl: string;
  ref: string;
  refType: RepoRefType;
  commitSha: string;
  treeSha: string | null;
  resolvedRepoId: string | null;
  archiveFiles: Map<string, Uint8Array> | null;
  remoteCapabilities: string[] | null;
};

export type ApplyWorkerArtifact = {
  kind: "worker_bundle";
  bundleContent: string;
  deployMessage?: string;
};

export type ApplyContainerArtifact = {
  kind: "container_image";
  imageRef: string;
  backend?: "oci" | "ecs" | "cloud-run" | "k8s";
  deployMessage?: string;
};

export type SnapshotApplyArtifact =
  | ApplyWorkerArtifact
  | ApplyContainerArtifact;

export type ResolvedBuildArtifacts = {
  buildSources: GroupDeploymentSnapshotBuildSource[];
  packageFiles: Map<string, ArrayBuffer | Uint8Array | string>;
  artifacts: Record<string, SnapshotApplyArtifact>;
};

export type DeploymentSnapshotGitRefSource = {
  kind: "git_ref";
  repository_url: string;
  ref: string;
  ref_type: RepoRefType;
  commit_sha: string;
  resolved_repo_id: string | null;
};

export type DeploymentSnapshotManifestSource = {
  kind: "manifest";
  /**
   * Caller-supplied build provenance metadata as accepted by
   * `POST /api/spaces/:spaceId/group-deployment-snapshots` with `source.kind: 'manifest'`.
   * Stored verbatim so a manifest-sourced rollback can carry the same
   * provenance through to the new deployment row.
   */
  manifest_artifacts: Array<Record<string, unknown>>;
};

export type DeploymentSnapshotSource =
  | DeploymentSnapshotGitRefSource
  | DeploymentSnapshotManifestSource;

export type DeploymentSnapshotPayload = {
  schema_version: 1;
  created_at: string;
  group_name: string;
  backend: "cloudflare" | "local" | "aws" | "gcp" | "k8s" | null;
  env_name: string | null;
  source: DeploymentSnapshotSource;
  manifest: AppManifest;
  build_sources: GroupDeploymentSnapshotBuildSource[];
  artifacts: Record<string, SnapshotApplyArtifact>;
};

export type StoredDeploymentSnapshot = {
  payload: DeploymentSnapshotPayload;
  bundleData: ArrayBuffer;
  r2Key: string;
  sha256: string;
  sizeBytes: number;
  format: "deployment-snapshot-v1" | "source-cache-v1";
};

export type GroupDeploymentSnapshotRow =
  typeof groupDeploymentSnapshots.$inferSelect;

export type GroupDeploymentSnapshotGitRefSource = {
  kind: "git_ref";
  repository_url: string | null;
  ref: string | null;
  ref_type: RepoRefType | null;
  commit_sha: string | null;
  resolved_repo_id: string | null;
};

export type GroupDeploymentSnapshotManifestSource = {
  kind: "manifest";
  artifact_count: number;
};

export type GroupDeploymentSnapshotSource =
  | GroupDeploymentSnapshotGitRefSource
  | GroupDeploymentSnapshotManifestSource;

export type GroupDeploymentSnapshotRecord = {
  id: string;
  group: { id: string; name: string };
  source: GroupDeploymentSnapshotSource;
  snapshot: {
    state: "available" | "source_cached" | "unsupported";
    rollback_ready: boolean;
    format: string | null;
  };
  status: GroupDeploymentSnapshotStatus;
  manifest_version: string | null;
  hostnames: string[];
  rollback_of_group_deployment_snapshot_id: string | null;
  created_at: string;
  updated_at: string;
};

export type GroupDeploymentSnapshotMutationResult = {
  groupDeploymentSnapshot: GroupDeploymentSnapshotRecord;
  applyResult: SafeApplyResult;
};

export type GroupDeploymentSnapshotPlanResult = {
  group: { id: string | null; name: string; exists: boolean };
  diff: DiffResult;
  translationReport: TranslationReport;
};

export type RepositoryLocatorRow = {
  repoId: string;
  accountId: string;
  accountSlug: string;
  name: string;
  visibility: string;
  defaultBranch: string;
  remoteCloneUrl: string | null;
};
