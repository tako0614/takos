import { and, desc, eq } from "drizzle-orm";
import { getDb, workflowJobs, workflowRuns } from "../../../infra/db/index.ts";
import { BadRequestError, NotFoundError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import { getBundleContent } from "../deployment/artifact-io.ts";
import { isDigestPinnedImageRef } from "../deployment/image-ref.ts";
import {
  findDeploymentByArtifactRef,
  getDeploymentById,
} from "../deployment/store.ts";
import {
  type AppContainer,
  type AppDeploymentBuildSource,
  type AppManifest,
  type AppService,
  parseAndValidateWorkflowYaml,
  validateDeployProducerJob,
} from "../source/app-manifest.ts";
import { resolveWorkflowArtifactFileForJob } from "./workflow-artifacts.ts";
import * as gitStore from "../git-smart/index.ts";
import {
  buildWorkflowRunRef,
  isDirectoryMode,
  looksLikeInlineSql,
  normalizeRepoPath,
} from "./app-deployment-source.ts";
import type {
  ApplyContainerArtifact,
  ResolvedBuildArtifacts,
  ResolvedGitTarget,
  SnapshotApplyArtifact,
} from "./app-deployments-model.ts";
import {
  readRepoBlobAtTarget,
  readRepoTextFileAtTarget,
} from "./app-deployments-targets.ts";

function getGitBucket(env: Env) {
  return env.GIT_OBJECTS || null;
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

function resolveContainerImageArtifact(
  name: string,
  workloadCategory: "container" | "service",
  spec: AppContainer | AppService,
): ApplyContainerArtifact | null {
  const imageRef = spec.artifact?.kind === "image"
    ? spec.artifact.imageRef
    : spec.imageRef;
  if (!imageRef) return null;
  if (!isDigestPinnedImageRef(imageRef)) {
    throw new BadRequestError(
      `${
        workloadCategory === "service" ? "Service" : "Container"
      } "${name}" requires a digest-pinned imageRef (@sha256:...) for app deployments`,
    );
  }
  return {
    kind: "container_image",
    imageRef,
    ...(spec.artifact?.kind === "image" && spec.artifact.provider
      ? { provider: spec.artifact.provider }
      : spec.provider
      ? { provider: spec.provider }
      : {}),
    deployMessage: `takos deploy ${name}`,
  };
}

async function addRepoSqlPathToPackage(
  env: Env,
  target: ResolvedGitTarget,
  configuredPath: string,
  packageFiles: Map<string, ArrayBuffer | Uint8Array | string>,
): Promise<void> {
  const normalizedPath = normalizeRepoPath(configuredPath);
  if (!normalizedPath) {
    throw new BadRequestError("Migration path is empty");
  }

  if (target.archiveFiles) {
    const exactFile = target.archiveFiles.get(normalizedPath) ?? null;
    if (exactFile) {
      if (!normalizedPath.toLowerCase().endsWith(".sql")) {
        throw new BadRequestError(
          `Migration file must end with .sql: ${normalizedPath}`,
        );
      }
      packageFiles.set(normalizedPath, toArrayBuffer(exactFile));
      return;
    }

    const sqlFiles = Array.from(target.archiveFiles.entries())
      .filter(([filePath]) =>
        filePath.startsWith(`${normalizedPath}/`) &&
        filePath.toLowerCase().endsWith(".sql")
      )
      .sort(([a], [b]) => a.localeCompare(b));
    if (sqlFiles.length > 0) {
      for (const [filePath, contents] of sqlFiles) {
        packageFiles.set(filePath, toArrayBuffer(contents));
      }
      return;
    }

    throw new NotFoundError(
      `Migration path not found in repo: ${normalizedPath}`,
    );
  }

  if (!target.treeSha) {
    throw new NotFoundError(
      `Migration path not found in repo: ${normalizedPath}`,
    );
  }
  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");
  const entry = await gitStore.getEntryAtPath(
    bucket,
    target.treeSha,
    normalizedPath,
  );
  if (!entry) {
    throw new NotFoundError(
      `Migration path not found in repo: ${normalizedPath}`,
    );
  }

  if (isDirectoryMode(entry.mode)) {
    const files = await gitStore.flattenTree(
      bucket,
      entry.sha,
      normalizedPath,
      {
        skipSymlinks: true,
      },
    );
    const sqlFiles = files.filter((file) =>
      file.path.toLowerCase().endsWith(".sql")
    );
    if (sqlFiles.length === 0) {
      throw new BadRequestError(
        `Migration directory contains no .sql files: ${normalizedPath}`,
      );
    }
    for (const file of sqlFiles) {
      const blob = await readRepoBlobAtTarget(env, target, file.path);
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
    throw new BadRequestError(
      `Migration file must end with .sql: ${normalizedPath}`,
    );
  }
  const blob = await readRepoBlobAtTarget(env, target, normalizedPath);
  if (!blob) {
    throw new NotFoundError(
      `Migration file not found in git object storage: ${normalizedPath}`,
    );
  }
  packageFiles.set(normalizedPath, toArrayBuffer(blob));
}

export async function resolveBuildArtifacts(
  env: Env,
  target: ResolvedGitTarget,
  manifest: AppManifest,
): Promise<ResolvedBuildArtifacts> {
  const bucket = getGitBucket(env);
  if (!bucket) throw new BadRequestError("Git storage is not configured");
  const db = getDb(env.DB);
  const workflowCache = new Map<
    string,
    ReturnType<typeof parseAndValidateWorkflowYaml>
  >();
  const packageFiles = new Map<string, ArrayBuffer | Uint8Array | string>();
  const buildSources: AppDeploymentBuildSource[] = [];
  const artifacts: Record<string, SnapshotApplyArtifact> = {};

  for (
    const [workerName, worker] of Object.entries(manifest.spec.workers || {})
  ) {
    if (worker.build?.fromWorkflow) {
      const build = worker.build.fromWorkflow;
      const artifactPath = normalizeRepoPath(build.artifactPath);
      const workflowContent = await readRepoTextFileAtTarget(
        env,
        target,
        build.path,
      );
      if (!workflowContent) {
        throw new NotFoundError(
          `Workflow file not found at repo ref: ${build.path}`,
        );
      }

      let workflow = workflowCache.get(build.path);
      if (!workflow) {
        workflow = parseAndValidateWorkflowYaml(workflowContent, build.path);
        workflowCache.set(build.path, workflow);
      }
      validateDeployProducerJob(workflow, build.path, build.job);

      const useCommittedArtifact = async (reason: string): Promise<void> => {
        const committedArtifact = await readRepoTextFileAtTarget(
          env,
          target,
          artifactPath,
        );
        if (!committedArtifact) {
          throw new BadRequestError(
            `Worker "${workerName}" must commit ${artifactPath} when deploy source resolution cannot read a Takos workflow artifact. ${reason}.`,
          );
        }
        buildSources.push({
          service_name: workerName,
          workflow_path: build.path,
          workflow_job: build.job,
          workflow_artifact: build.artifact,
          artifact_path: artifactPath,
          source_sha: target.commitSha,
        });
        artifacts[workerName] = {
          kind: "worker_bundle",
          bundleContent: committedArtifact,
          deployMessage: `takos deploy ${workerName}`,
        };
        packageFiles.set(artifactPath, committedArtifact);
      };

      if (!target.resolvedRepoId) {
        await useCommittedArtifact(
          "Takos workflow artifacts are unavailable for arbitrary public repository URLs",
        );
        continue;
      }

      const workflowRunRef = buildWorkflowRunRef(target.refType, target.ref);
      const baseConditions = and(
        eq(workflowRuns.repoId, target.resolvedRepoId),
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

      let foundRun: { id: string; sha: string | null; jobId: string } | null =
        null;
      for (const run of matchingRuns) {
        const matchingJob = await db.select({ id: workflowJobs.id })
          .from(workflowJobs)
          .where(and(
            eq(workflowJobs.runId, run.id),
            eq(workflowJobs.jobKey, build.job),
            eq(workflowJobs.status, "completed"),
            eq(workflowJobs.conclusion, "success"),
          ))
          .orderBy(
            desc(workflowJobs.completedAt),
            desc(workflowJobs.createdAt),
          )
          .get();
        if (matchingJob) {
          foundRun = { id: run.id, sha: run.sha, jobId: matchingJob.id };
          break;
        }
      }

      if (!foundRun) {
        await useCommittedArtifact(
          `Latest successful workflow run was not found for ${build.path}#${build.job} on ${target.refType}:${target.ref}`,
        );
        continue;
      }

      buildSources.push({
        service_name: workerName,
        workflow_path: build.path,
        workflow_job: build.job,
        workflow_artifact: build.artifact,
        artifact_path: artifactPath,
        workflow_run_id: foundRun.id,
        workflow_job_id: foundRun.jobId,
        ...(foundRun.sha ? { source_sha: foundRun.sha } : {}),
      });

      const artifactFile = await resolveWorkflowArtifactFileForJob(env, {
        repoId: target.resolvedRepoId,
        runId: foundRun.id,
        jobId: foundRun.jobId,
        artifactName: build.artifact,
        artifactPath: build.artifactPath,
      });
      const artifactObject = await bucket.get(artifactFile.r2Key) ||
        await env.TENANT_SOURCE?.get(artifactFile.r2Key) ||
        null;
      if (!artifactObject) {
        await useCommittedArtifact(
          `Workflow artifact file disappeared during app deploy (${artifactFile.r2Key})`,
        );
        continue;
      }
      const bundleContent = await artifactObject.text();
      artifacts[workerName] = {
        kind: "worker_bundle",
        bundleContent,
        deployMessage: `takos deploy ${workerName}`,
      };
      packageFiles.set(artifactPath, bundleContent);
      continue;
    }

    if (worker.artifact?.kind === "bundle" && worker.artifact.deploymentId) {
      const deployment = await getDeploymentById(
        env.DB,
        worker.artifact.deploymentId,
      );
      if (!deployment) {
        throw new NotFoundError(
          `Referenced deployment "${worker.artifact.deploymentId}" for worker "${workerName}" was not found`,
        );
      }
      const bundleContent = await getBundleContent(env, deployment);
      const snapshotArtifactPath = `artifacts/workers/${workerName}.js`;
      artifacts[workerName] = {
        kind: "worker_bundle",
        bundleContent,
        deployMessage: `takos deploy ${workerName}`,
      };
      packageFiles.set(snapshotArtifactPath, bundleContent);
      continue;
    }

    if (worker.artifact?.kind === "bundle" && worker.artifact.artifactRef) {
      const deployment = await findDeploymentByArtifactRef(
        env.DB,
        worker.artifact.artifactRef,
      );
      if (!deployment) {
        throw new NotFoundError(
          `Referenced artifact "${worker.artifact.artifactRef}" for worker "${workerName}" was not found`,
        );
      }
      const bundleContent = await getBundleContent(env, deployment);
      const snapshotArtifactPath = `artifacts/workers/${workerName}.js`;
      artifacts[workerName] = {
        kind: "worker_bundle",
        bundleContent,
        deployMessage: `takos deploy ${workerName}`,
      };
      packageFiles.set(snapshotArtifactPath, bundleContent);
    }
  }

  for (
    const [name, container] of Object.entries(manifest.spec.containers || {})
  ) {
    const artifact = resolveContainerImageArtifact(
      name,
      "container",
      container,
    );
    if (artifact) {
      artifacts[name] = artifact;
    }
  }
  for (
    const [name, service] of Object.entries(manifest.spec.services || {})
  ) {
    const artifact = resolveContainerImageArtifact(name, "service", service);
    if (artifact) {
      artifacts[name] = artifact;
    }
  }

  for (const resource of Object.values(manifest.spec.resources || {})) {
    if (resource.type !== "d1" || !resource.migrations) continue;
    if (typeof resource.migrations === "string") {
      if (!looksLikeInlineSql(resource.migrations)) {
        await addRepoSqlPathToPackage(
          env,
          target,
          resource.migrations,
          packageFiles,
        );
      }
      continue;
    }

    await addRepoSqlPathToPackage(
      env,
      target,
      resource.migrations.up,
      packageFiles,
    );
    await addRepoSqlPathToPackage(
      env,
      target,
      resource.migrations.down,
      packageFiles,
    );
  }

  return { buildSources, packageFiles, artifacts };
}
