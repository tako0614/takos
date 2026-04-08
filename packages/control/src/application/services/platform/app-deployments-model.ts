import type { appDeployments } from "../../../infra/db/index.ts";
import type { SafeApplyResult } from "../deployment/apply-engine.ts";
import type {
  AppDeploymentBuildSource,
  AppManifest,
} from "../source/app-manifest.ts";
import type { RepoRefType } from "./app-deployment-source.ts";

export type AppDeploymentStatus = "applied" | "failed" | "deleted";

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

export type AppDeploymentSourceInput =
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
  provider?: "oci" | "ecs" | "cloud-run" | "k8s";
  deployMessage?: string;
};

export type SnapshotApplyArtifact =
  | ApplyWorkerArtifact
  | ApplyContainerArtifact;

export type ResolvedBuildArtifacts = {
  buildSources: AppDeploymentBuildSource[];
  packageFiles: Map<string, ArrayBuffer | Uint8Array | string>;
  artifacts: Record<string, SnapshotApplyArtifact>;
};

export type DeploymentSnapshotPayload = {
  schema_version: 1;
  created_at: string;
  group_name: string;
  provider: "cloudflare" | "local" | "aws" | "gcp" | "k8s" | null;
  env_name: string | null;
  source: {
    kind: "git_ref";
    repository_url: string;
    ref: string;
    ref_type: RepoRefType;
    commit_sha: string;
    resolved_repo_id: string | null;
  };
  manifest: AppManifest;
  build_sources: AppDeploymentBuildSource[];
  artifacts: Record<string, SnapshotApplyArtifact>;
};

export type StoredDeploymentSnapshot = {
  payload: DeploymentSnapshotPayload;
  bundleData: ArrayBuffer;
  r2Key: string;
  sha256: string;
  sizeBytes: number;
  format: "takopack-v1";
};

export type AppDeploymentRow = typeof appDeployments.$inferSelect;

export type AppDeploymentSource = {
  kind: "git_ref";
  repository_url: string | null;
  ref: string | null;
  ref_type: RepoRefType | null;
  commit_sha: string | null;
  resolved_repo_id: string | null;
};

export type AppDeploymentRecord = {
  id: string;
  group: { id: string; name: string };
  source: AppDeploymentSource;
  snapshot: {
    state: "available" | "backfill_required" | "unsupported";
    rollback_ready: boolean;
    format: string | null;
  };
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

export type RepositoryLocatorRow = {
  repoId: string;
  accountId: string;
  accountSlug: string;
  name: string;
  visibility: string;
  defaultBranch: string;
  remoteCloneUrl: string | null;
};
