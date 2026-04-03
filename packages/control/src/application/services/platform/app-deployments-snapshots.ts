import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import {
  type AppDeploymentBuildSource,
  type AppManifest,
  appManifestToBundleDocs,
  buildBundlePackageData,
} from "../source/app-manifest.ts";
import type {
  DeploymentSnapshotPayload,
  ResolvedGitTarget,
  SnapshotApplyArtifact,
  StoredDeploymentSnapshot,
} from "./app-deployments-model.ts";

const SNAPSHOT_SCHEMA_VERSION = 1 as const;

function getSnapshotBucket(env: Env) {
  return env.TENANT_SOURCE || env.GIT_OBJECTS || null;
}

export async function buildSnapshot(
  env: Env,
  deploymentId: string,
  input: {
    groupName: string;
    providerName: "cloudflare" | "local" | "aws" | "gcp" | "k8s" | null;
    envName: string | null;
    target: ResolvedGitTarget;
    manifest: AppManifest;
    buildSources: AppDeploymentBuildSource[];
    artifacts: Record<string, SnapshotApplyArtifact>;
    packageFiles: Map<string, ArrayBuffer | Uint8Array | string>;
  },
): Promise<StoredDeploymentSnapshot> {
  const bucket = getSnapshotBucket(env);
  if (!bucket) {
    throw new BadRequestError(
      "Snapshot storage is not configured (TENANT_SOURCE or GIT_OBJECTS)",
    );
  }

  const payload: DeploymentSnapshotPayload = {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    group_name: input.groupName,
    provider: input.providerName,
    env_name: input.envName,
    source: {
      kind: "git_ref" as const,
      repository_url: input.target.repositoryUrl,
      ref: input.target.ref,
      ref_type: input.target.refType,
      commit_sha: input.target.commitSha,
      resolved_repo_id: input.target.resolvedRepoId,
    },
    manifest: input.manifest,
    build_sources: input.buildSources,
    artifacts: input.artifacts,
  };

  const files = new Map(input.packageFiles);
  files.set("snapshot.json", JSON.stringify(payload, null, 2));
  const bundleData = await buildBundlePackageData(
    appManifestToBundleDocs(
      input.manifest,
      new Map(input.buildSources.map((entry) => [entry.service_name, entry])),
    ),
    files,
  );
  const bytes = new Uint8Array(bundleData);
  const r2Key = `app-deployments/${deploymentId}/snapshot.takopack`;
  await bucket.put(r2Key, bundleData, {
    httpMetadata: { contentType: "application/x-takopack" },
  });
  return {
    payload,
    bundleData,
    r2Key,
    sha256: await computeSHA256(bytes),
    sizeBytes: bytes.byteLength,
    format: "takopack-v1",
  };
}

export async function loadSnapshot(
  env: Env,
  snapshotR2Key: string,
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
    parsed.source?.kind !== "git_ref" || !parsed.manifest
  ) {
    throw new ConflictError(`Snapshot payload is invalid: ${snapshotR2Key}`);
  }

  return {
    payload: parsed,
    bundleData,
    r2Key: snapshotR2Key,
    sha256: await computeSHA256(bytes),
    sizeBytes: bytes.byteLength,
    format: "takopack-v1",
  };
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
  const r2Key = `app-deployments/${deploymentId}/snapshot.takopack`;
  await bucket.put(r2Key, snapshot.bundleData, {
    httpMetadata: { contentType: "application/x-takopack" },
  });
  return {
    ...snapshot,
    r2Key,
  };
}
