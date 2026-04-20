import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import {
  type AppManifest,
  appManifestToBundleDocs,
  buildBundlePackageData,
  type GroupDeploymentSnapshotBuildSource,
} from "../source/app-manifest.ts";
import type {
  DeploymentSnapshotPayload,
  DeploymentSnapshotSource,
  ResolvedGitTarget,
  SnapshotApplyArtifact,
  StoredDeploymentSnapshot,
} from "./group-deployment-snapshots-model.ts";

const SNAPSHOT_SCHEMA_VERSION = 1 as const;

function getSnapshotBucket(env: Env) {
  return env.TENANT_SOURCE || env.GIT_OBJECTS || null;
}

export type BuildSnapshotGitRefSource = {
  kind: "git_ref";
  target: ResolvedGitTarget;
  buildSources: GroupDeploymentSnapshotBuildSource[];
  packageFiles: Map<string, ArrayBuffer | Uint8Array | string>;
};

export type BuildSnapshotManifestSource = {
  kind: "manifest";
  manifestArtifacts: Array<Record<string, unknown>>;
};

export type BuildSnapshotSource =
  | BuildSnapshotGitRefSource
  | BuildSnapshotManifestSource;

function toSnapshotSource(
  source: BuildSnapshotSource,
): DeploymentSnapshotSource {
  if (source.kind === "git_ref") {
    return {
      kind: "git_ref",
      repository_url: source.target.repositoryUrl,
      ref: source.target.ref,
      ref_type: source.target.refType,
      commit_sha: source.target.commitSha,
      resolved_repo_id: source.target.resolvedRepoId,
    };
  }
  return {
    kind: "manifest",
    manifest_artifacts: source.manifestArtifacts,
  };
}

function buildSourcesFor(
  source: BuildSnapshotSource,
): GroupDeploymentSnapshotBuildSource[] {
  return source.kind === "git_ref" ? source.buildSources : [];
}

function packageFilesFor(
  source: BuildSnapshotSource,
): Map<string, ArrayBuffer | Uint8Array | string> {
  return source.kind === "git_ref"
    ? new Map(source.packageFiles)
    : new Map<string, ArrayBuffer | Uint8Array | string>();
}

export async function buildSnapshot(
  env: Env,
  deploymentId: string,
  input: {
    groupName: string;
    backendName: "cloudflare" | "local" | "aws" | "gcp" | "k8s" | null;
    envName: string | null;
    source: BuildSnapshotSource;
    manifest: AppManifest;
    artifacts: Record<string, SnapshotApplyArtifact>;
  },
): Promise<StoredDeploymentSnapshot> {
  const bucket = getSnapshotBucket(env);
  if (!bucket) {
    throw new BadRequestError(
      "Snapshot storage is not configured (TENANT_SOURCE or GIT_OBJECTS)",
    );
  }

  const buildSources = buildSourcesFor(input.source);
  const payload: DeploymentSnapshotPayload = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    group_name: input.groupName,
    backend: input.backendName,
    env_name: input.envName,
    source: toSnapshotSource(input.source),
    manifest: input.manifest,
    build_sources: buildSources,
    artifacts: input.artifacts,
  };

  const files = packageFilesFor(input.source);
  files.set("snapshot.json", JSON.stringify(payload, null, 2));
  const bundleData = await buildBundlePackageData(
    appManifestToBundleDocs(
      input.manifest,
      new Map(buildSources.map((entry) => [entry.service_name, entry])),
    ),
    files,
  );
  const bytes = new Uint8Array(bundleData);
  const r2Key = `group-deployment-snapshots/${deploymentId}/snapshot.zip`;
  await bucket.put(r2Key, bundleData, {
    httpMetadata: { contentType: "application/zip" },
  });
  return {
    payload,
    bundleData,
    r2Key,
    sha256: await computeSHA256(bytes),
    sizeBytes: bytes.byteLength,
    format: "deployment-snapshot-v1",
  };
}

export async function loadSnapshot(
  env: Env,
  snapshotR2Key: string,
  expectedSha256?: string | null,
): Promise<StoredDeploymentSnapshot> {
  const bucket = getSnapshotBucket(env);
  if (!bucket) {
    throw new BadRequestError(
      "Snapshot storage is not configured (TENANT_SOURCE or GIT_OBJECTS)",
    );
  }
  const object = await bucket.get(snapshotR2Key);
  if (!object) {
    throw new NotFoundError(`Deployment snapshot at ${snapshotR2Key}`);
  }

  const bundleData = await object.arrayBuffer();
  const bytes = new Uint8Array(bundleData);
  const jszip = await import("jszip");
  const JSZip = "default" in jszip ? jszip.default : jszip;
  const zip = await JSZip.loadAsync(bundleData);
  const snapshotFile = zip.file("snapshot.json");
  if (!snapshotFile) {
    throw new ConflictError(
      `Snapshot package is missing snapshot.json: ${snapshotR2Key}`,
    );
  }
  const parsed = safeJsonParseOrDefault<
    StoredDeploymentSnapshot["payload"] | null
  >(
    await snapshotFile.async("string"),
    null,
  );
  if (
    !parsed || parsed.schema_version !== SNAPSHOT_SCHEMA_VERSION ||
    !parsed.source || !parsed.manifest ||
    (parsed.source.kind !== "git_ref" && parsed.source.kind !== "manifest")
  ) {
    throw new ConflictError(`Snapshot payload is invalid: ${snapshotR2Key}`);
  }

  return {
    payload: parsed,
    bundleData,
    r2Key: snapshotR2Key,
    sha256: await verifySnapshotHash(bytes, expectedSha256, snapshotR2Key),
    sizeBytes: bytes.byteLength,
    format: "deployment-snapshot-v1",
  };
}

async function verifySnapshotHash(
  bytes: Uint8Array,
  expectedSha256: string | null | undefined,
  snapshotR2Key: string,
): Promise<string> {
  const actualSha256 = await computeSHA256(bytes);
  if (expectedSha256 && actualSha256 !== expectedSha256) {
    throw new ConflictError(
      `Snapshot hash mismatch for ${snapshotR2Key}: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  return actualSha256;
}

export async function cloneSnapshotToDeployment(
  env: Env,
  deploymentId: string,
  snapshot: StoredDeploymentSnapshot,
): Promise<StoredDeploymentSnapshot> {
  const bucket = getSnapshotBucket(env);
  if (!bucket) {
    throw new BadRequestError(
      "Snapshot storage is not configured (TENANT_SOURCE or GIT_OBJECTS)",
    );
  }
  const r2Key = `group-deployment-snapshots/${deploymentId}/snapshot.zip`;
  await bucket.put(r2Key, snapshot.bundleData, {
    httpMetadata: { contentType: "application/zip" },
  });
  return {
    ...snapshot,
    r2Key,
  };
}
