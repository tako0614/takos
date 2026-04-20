import type { R2Bucket } from "../../../shared/types/bindings.ts";
import {
  getDb as realGetDb,
  workflowArtifacts,
  workflowRuns,
} from "../../../infra/db/index.ts";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Env } from "../../../shared/types/index.ts";
import { logError } from "../../../shared/utils/logger.ts";

export const workflowArtifactDeps = {
  getDb: realGetDb,
};

type ArtifactBucket = Pick<R2Bucket, "get" | "delete" | "list">;

export type WorkflowArtifactRecord = {
  id: string;
  runId: string;
  name: string;
  r2Key: string;
  sizeBytes: number | null;
  mimeType: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type ResolvedWorkflowArtifactFile = {
  runId: string;
  jobId: string;
  artifactName: string;
  artifactPath: string;
  r2Key: string;
  source: "inventory" | "prefix-fallback" | "directory-fallback";
};

function normalizePath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .trim();
}

function normalizeArtifactPath(value: string): string {
  const raw = String(value || "").trim();
  if (/^(?:[a-zA-Z]:[\\/]|[\\/])/.test(raw)) {
    throw new Error("artifact path must be repository-relative");
  }
  const normalized = normalizePath(raw);
  if (!normalized) {
    throw new Error("artifact path is required");
  }
  const segments = normalized.split("/");
  if (
    segments.some((segment) => segment === ".." || segment === ".")
  ) {
    throw new Error("artifact path must not contain path traversal");
  }
  return normalized;
}

function normalizeOptionalArtifactPath(
  value: string | null | undefined,
): string | undefined {
  if (value == null) return undefined;
  return normalizeArtifactPath(value);
}

function isExpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt) < new Date();
}

export function buildWorkflowArtifactPrefix(
  jobId: string,
  artifactName: string,
): string {
  return `actions/artifacts/${jobId}/${artifactName}/`;
}

async function getObjectFromSources(
  primary: ArtifactBucket | null | undefined,
  secondary: ArtifactBucket | null | undefined,
  key: string,
) {
  const primaryObject = primary ? await primary.get(key) : null;
  if (primaryObject) return primaryObject;
  return secondary ? await secondary.get(key) : null;
}

async function listScriptKeys(
  bucket: ArtifactBucket | null | undefined,
  prefix: string,
): Promise<string[]> {
  if (!bucket?.list) return [];
  const listed = await bucket.list({ prefix });
  const objects = (listed as { objects?: Array<{ key?: string }> }).objects ??
    [];
  return objects
    .map((object) => typeof object.key === "string" ? object.key : "")
    .filter((key) => key.startsWith(prefix))
    .filter((key) => /\.(?:mjs|js|cjs)$/i.test(key));
}

async function resolveArtifactObjectKeyFromSources(
  primary: ArtifactBucket | null | undefined,
  secondary: ArtifactBucket | null | undefined,
  key: string,
): Promise<{ r2Key: string; source: "exact" | "directory" } | null> {
  const exactObject = await getObjectFromSources(primary, secondary, key);
  if (exactObject) return { r2Key: key, source: "exact" };

  const prefix = `${key.replace(/\/+$/, "")}/`;
  const scriptKeys = new Set<string>();
  for (const scriptKey of await listScriptKeys(primary, prefix)) {
    scriptKeys.add(scriptKey);
  }
  for (const scriptKey of await listScriptKeys(secondary, prefix)) {
    scriptKeys.add(scriptKey);
  }
  const sortedScriptKeys = [...scriptKeys].sort((a, b) => a.localeCompare(b));
  if (sortedScriptKeys.length === 1) {
    return { r2Key: sortedScriptKeys[0], source: "directory" };
  }
  if (sortedScriptKeys.length > 1) {
    throw new Error(
      `Workflow artifact directory contains multiple JavaScript bundle candidates (${
        sortedScriptKeys.join(", ")
      }); set artifactPath to a single bundle file`,
    );
  }
  return null;
}

function resolveArtifactPathForKey(
  artifactPath: string | undefined,
  candidateKey: string,
  resolvedKey: string,
): string {
  if (resolvedKey === candidateKey) {
    if (artifactPath) return artifactPath;
    const normalizedCandidate = candidateKey.replace(/\/+$/, "");
    return normalizedCandidate.split("/").pop() ?? "";
  }
  const prefix = `${candidateKey.replace(/\/+$/, "")}/`;
  if (!resolvedKey.startsWith(prefix)) return artifactPath ?? "";
  const suffix = resolvedKey.slice(prefix.length);
  if (!artifactPath) return suffix;
  return `${artifactPath.replace(/\/+$/, "")}/${suffix}`;
}

function appendArtifactPath(
  baseKey: string,
  artifactPath: string | undefined,
): string {
  const normalizedBase = baseKey.replace(/\/+$/, "");
  if (!artifactPath) return normalizedBase;
  if (normalizedBase.endsWith(`/${artifactPath}`)) return normalizedBase;
  return `${normalizedBase}/${artifactPath}`;
}

export async function listWorkflowArtifactsForRun(
  env: Pick<Env, "DB">,
  repoId: string,
  runId: string,
) {
  const db = workflowArtifactDeps.getDb(env.DB);
  const run = await db.select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.repoId, repoId)))
    .get();
  if (!run) return null;

  return await db.select()
    .from(workflowArtifacts)
    .where(eq(workflowArtifacts.runId, runId))
    .orderBy(asc(workflowArtifacts.createdAt))
    .all();
}

export async function getWorkflowArtifactById(
  env: Pick<Env, "DB">,
  repoId: string,
  artifactId: string,
) {
  const db = workflowArtifactDeps.getDb(env.DB);
  // Join workflowArtifacts with workflowRuns to verify repoId
  const result = await db.select({
    id: workflowArtifacts.id,
    runId: workflowArtifacts.runId,
    name: workflowArtifacts.name,
    r2Key: workflowArtifacts.r2Key,
    sizeBytes: workflowArtifacts.sizeBytes,
    mimeType: workflowArtifacts.mimeType,
    expiresAt: workflowArtifacts.expiresAt,
    createdAt: workflowArtifacts.createdAt,
    repoId: workflowRuns.repoId,
  })
    .from(workflowArtifacts)
    .innerJoin(workflowRuns, eq(workflowArtifacts.runId, workflowRuns.id))
    .where(
      and(
        eq(workflowArtifacts.id, artifactId),
        eq(workflowRuns.repoId, repoId),
      ),
    )
    .get();
  if (!result) return null;

  return {
    id: result.id,
    runId: result.runId,
    name: result.name,
    r2Key: result.r2Key,
    sizeBytes: result.sizeBytes,
    mimeType: result.mimeType,
    expiresAt: result.expiresAt,
    createdAt: result.createdAt,
    workflowRun: { repoId: result.repoId },
  };
}

export async function deleteWorkflowArtifactById(
  env: Pick<Env, "DB">,
  bucket: ArtifactBucket | null | undefined,
  repoId: string,
  artifactId: string,
) {
  const db = workflowArtifactDeps.getDb(env.DB);
  const artifact = await getWorkflowArtifactById(env, repoId, artifactId);
  if (!artifact) return null;

  if (bucket && artifact.r2Key) {
    try {
      await bucket.delete(artifact.r2Key);
    } catch (err) {
      logError("Failed to delete artifact from object storage", err, {
        module: "services/platform/workflow-artifacts",
      });
    }
  }

  await db.delete(workflowArtifacts)
    .where(eq(workflowArtifacts.id, artifactId))
    .run();

  return artifact;
}

export async function resolveWorkflowArtifactFileForJob(
  env: Pick<Env, "DB" | "GIT_OBJECTS" | "TENANT_SOURCE">,
  params: {
    repoId: string;
    runId: string;
    jobId: string;
    artifactName: string;
    artifactPath?: string | null;
  },
): Promise<ResolvedWorkflowArtifactFile> {
  const db = workflowArtifactDeps.getDb(env.DB);
  const artifactPath = normalizeOptionalArtifactPath(params.artifactPath);

  // Find inventory artifact by name + runId, verifying repoId via join
  const inventoryArtifact = await db.select({
    runId: workflowArtifacts.runId,
    name: workflowArtifacts.name,
    r2Key: workflowArtifacts.r2Key,
    expiresAt: workflowArtifacts.expiresAt,
  })
    .from(workflowArtifacts)
    .innerJoin(workflowRuns, eq(workflowArtifacts.runId, workflowRuns.id))
    .where(
      and(
        eq(workflowArtifacts.runId, params.runId),
        eq(workflowArtifacts.name, params.artifactName),
        eq(workflowRuns.repoId, params.repoId),
      ),
    )
    .orderBy(desc(workflowArtifacts.createdAt))
    .get();

  if (inventoryArtifact && !isExpired(inventoryArtifact.expiresAt)) {
    const candidateKey = appendArtifactPath(
      inventoryArtifact.r2Key,
      artifactPath,
    );
    const resolved = await resolveArtifactObjectKeyFromSources(
      env.GIT_OBJECTS,
      env.TENANT_SOURCE,
      candidateKey,
    );
    if (resolved) {
      return {
        runId: params.runId,
        jobId: params.jobId,
        artifactName: params.artifactName,
        artifactPath: resolveArtifactPathForKey(
          artifactPath,
          candidateKey,
          resolved.r2Key,
        ),
        r2Key: resolved.r2Key,
        source: resolved.source === "directory"
          ? "directory-fallback"
          : "inventory",
      };
    }
  }

  const prefixKey = appendArtifactPath(
    buildWorkflowArtifactPrefix(params.jobId, params.artifactName),
    artifactPath,
  );
  const prefixedObject = await resolveArtifactObjectKeyFromSources(
    env.GIT_OBJECTS,
    env.TENANT_SOURCE,
    prefixKey,
  );
  if (!prefixedObject) {
    const artifactLabel = artifactPath
      ? `${params.artifactName}@${artifactPath}`
      : params.artifactName;
    throw new Error(
      `Workflow artifact file not found: ${artifactLabel} (job ${params.jobId})`,
    );
  }

  return {
    runId: params.runId,
    jobId: params.jobId,
    artifactName: params.artifactName,
    artifactPath: resolveArtifactPathForKey(
      artifactPath,
      prefixKey,
      prefixedObject.r2Key,
    ),
    r2Key: prefixedObject.r2Key,
    source: prefixedObject.source === "directory"
      ? "directory-fallback"
      : "prefix-fallback",
  };
}
