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
  source: "inventory" | "prefix-fallback";
};

function normalizePath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .trim();
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
    artifactPath: string;
  },
): Promise<ResolvedWorkflowArtifactFile> {
  const db = workflowArtifactDeps.getDb(env.DB);
  const artifactPath = normalizePath(params.artifactPath);
  if (!artifactPath) {
    throw new Error("artifact path is required");
  }

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
    const candidateKey = inventoryArtifact.r2Key.endsWith(`/${artifactPath}`)
      ? inventoryArtifact.r2Key
      : `${inventoryArtifact.r2Key.replace(/\/+$/, "")}/${artifactPath}`;
    const artifactObject = await getObjectFromSources(
      env.GIT_OBJECTS,
      env.TENANT_SOURCE,
      candidateKey,
    );
    if (artifactObject) {
      return {
        runId: params.runId,
        jobId: params.jobId,
        artifactName: params.artifactName,
        artifactPath,
        r2Key: candidateKey,
        source: "inventory",
      };
    }
  }

  const prefixKey = `${
    buildWorkflowArtifactPrefix(params.jobId, params.artifactName)
  }${artifactPath}`;
  const prefixedObject = await getObjectFromSources(
    env.GIT_OBJECTS,
    env.TENANT_SOURCE,
    prefixKey,
  );
  if (!prefixedObject) {
    throw new Error(
      `Workflow artifact file not found: ${params.artifactName}@${artifactPath} (job ${params.jobId})`,
    );
  }

  return {
    runId: params.runId,
    jobId: params.jobId,
    artifactName: params.artifactName,
    artifactPath,
    r2Key: prefixKey,
    source: "prefix-fallback",
  };
}
