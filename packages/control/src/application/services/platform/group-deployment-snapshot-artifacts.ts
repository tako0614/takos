import { and, desc, eq } from "drizzle-orm";
import { getDb, workflowJobs, workflowRuns } from "../../../infra/db/index.ts";
import { BadRequestError, NotFoundError } from "takos-common/errors";
import type { Env } from "../../../shared/types/index.ts";
import { isDigestPinnedImageRef } from "../deployment/image-ref.ts";
import {
  type AppCompute,
  type AppManifest,
  type GroupDeploymentSnapshotBuildSource,
  parseAndValidateWorkflowYaml,
  validateDeployProducerJob,
} from "../source/app-manifest.ts";

// Narrowed aliases so the existing helper signatures still read naturally.
type AppContainer = AppCompute & { kind: "attached-container" };
type AppService = AppCompute & { kind: "service" };
import { resolveWorkflowArtifactFileForJob } from "./workflow-artifacts.ts";
import {
  buildWorkflowRunRef,
  normalizeRepoRelativePath,
} from "./group-deployment-snapshot-source.ts";
import type {
  ApplyContainerArtifact,
  ResolvedBuildArtifacts,
  ResolvedGitTarget,
  SnapshotApplyArtifact,
} from "./group-deployment-snapshots-model.ts";
import {
  listRepoPaths,
  readRepoTextFileAtTarget,
} from "./group-deployment-snapshot-targets.ts";

function getGitBucket(env: Env) {
  return env.GIT_OBJECTS || null;
}

async function resolveCommittedWorkerBundle(
  env: Env,
  target: ResolvedGitTarget,
  artifactPath: string,
): Promise<{ artifactPath: string; content: string } | null> {
  const exact = await readRepoTextFileAtTarget(env, target, artifactPath);
  if (exact !== null) return { artifactPath, content: exact };

  const prefix = `${artifactPath.replace(/\/+$/, "")}/`;
  const scriptPaths = (await listRepoPaths(env, target))
    .filter((path) => path.startsWith(prefix))
    .filter((path) => /\.(?:mjs|js|cjs)$/i.test(path))
    .sort((a, b) => a.localeCompare(b));

  if (scriptPaths.length === 0) return null;
  if (scriptPaths.length > 1) {
    throw new BadRequestError(
      `Committed artifact directory for ${artifactPath} contains multiple JavaScript bundle candidates (${
        scriptPaths.join(", ")
      }); set artifactPath to a single bundle file`,
    );
  }

  const content = await readRepoTextFileAtTarget(env, target, scriptPaths[0]);
  if (content === null) return null;
  return { artifactPath: scriptPaths[0], content };
}

export function resolveContainerImageArtifact(
  name: string,
  workloadCategory: "container" | "service",
  spec: AppContainer | AppService,
): ApplyContainerArtifact | null {
  // Flat schema: the image ref for a service / attached container lives
  // in `compute.image`. The previous envelope-level `artifact` field was
  // retired in Phase 1.
  const imageRef = typeof spec.image === "string" ? spec.image : undefined;
  if (!imageRef) {
    throw new BadRequestError(
      `${
        workloadCategory === "service" ? "Service" : "Container"
      } "${name}" requires compute.image for group deployment snapshots; dockerfile-only workloads are local-only`,
    );
  }
  if (!isDigestPinnedImageRef(imageRef)) {
    throw new BadRequestError(
      `${
        workloadCategory === "service" ? "Service" : "Container"
      } "${name}" requires a digest-pinned imageRef (@sha256:...) for group deployment snapshots`,
    );
  }
  return {
    kind: "container_image",
    imageRef,
    deployMessage: `takos deploy ${name}`,
  };
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
  const buildSources: GroupDeploymentSnapshotBuildSource[] = [];
  const artifacts: Record<string, SnapshotApplyArtifact> = {};

  const workerEntries = Object.entries(manifest.compute ?? {}).filter(
    ([, compute]) => compute.kind === "worker",
  );
  for (const [workerName, worker] of workerEntries) {
    if (worker.build?.fromWorkflow) {
      const build = worker.build.fromWorkflow;
      const artifactPath = build.artifactPath
        ? normalizeRepoRelativePath(
          build.artifactPath,
          `compute.${workerName}.build.fromWorkflow.artifactPath`,
        )
        : undefined;
      const workflowPath = normalizeRepoRelativePath(
        build.path,
        `compute.${workerName}.build.fromWorkflow.path`,
      );
      if (!workflowPath.startsWith(".takos/workflows/")) {
        throw new BadRequestError(
          `compute.${workerName}.build.fromWorkflow.path must be under .takos/workflows/`,
        );
      }
      const useCommittedArtifact = async (reason: string): Promise<void> => {
        const committedFallbackPath = artifactPath ??
          normalizeRepoRelativePath(
            build.artifact,
            `compute.${workerName}.build.fromWorkflow.artifact`,
          );
        const committedArtifact = await resolveCommittedWorkerBundle(
          env,
          target,
          committedFallbackPath,
        );
        if (!committedArtifact) {
          throw new BadRequestError(
            `Worker "${workerName}" must commit a single JavaScript bundle under ${committedFallbackPath} when deploy source resolution cannot read a Takos workflow artifact. ${reason}.`,
          );
        }
        buildSources.push({
          service_name: workerName,
          workflow_path: workflowPath,
          workflow_job: build.job,
          workflow_artifact: build.artifact,
          artifact_path: committedArtifact.artifactPath,
          source_sha: target.commitSha,
        });
        artifacts[workerName] = {
          kind: "worker_bundle",
          bundleContent: committedArtifact.content,
          deployMessage: `takos deploy ${workerName}`,
        };
        packageFiles.set(
          committedArtifact.artifactPath,
          committedArtifact.content,
        );
      };

      if (!target.resolvedRepoId) {
        await useCommittedArtifact(
          "Takos workflow artifacts are unavailable for arbitrary public repository URLs",
        );
        continue;
      }

      const workflowContent = await readRepoTextFileAtTarget(
        env,
        target,
        workflowPath,
      );
      if (!workflowContent) {
        throw new NotFoundError(
          `Workflow file not found at repo ref: ${workflowPath}`,
        );
      }

      let workflow = workflowCache.get(workflowPath);
      if (!workflow) {
        workflow = parseAndValidateWorkflowYaml(workflowContent, workflowPath);
        workflowCache.set(workflowPath, workflow);
      }
      validateDeployProducerJob(workflow, workflowPath, build.job);

      const workflowRunRef = buildWorkflowRunRef(target.refType, target.ref);
      const baseConditions = and(
        eq(workflowRuns.repoId, target.resolvedRepoId),
        eq(workflowRuns.workflowPath, workflowPath),
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
          `Latest successful workflow run was not found for ${workflowPath}#${build.job} on ${target.refType}:${target.ref}`,
        );
        continue;
      }

      const artifactFile = await resolveWorkflowArtifactFileForJob(env, {
        repoId: target.resolvedRepoId,
        runId: foundRun.id,
        jobId: foundRun.jobId,
        artifactName: build.artifact,
        artifactPath,
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
      buildSources.push({
        service_name: workerName,
        workflow_path: workflowPath,
        workflow_job: build.job,
        workflow_artifact: build.artifact,
        artifact_path: artifactFile.artifactPath,
        workflow_run_id: foundRun.id,
        workflow_job_id: foundRun.jobId,
        ...(foundRun.sha ? { source_sha: foundRun.sha } : {}),
      });
      artifacts[workerName] = {
        kind: "worker_bundle",
        bundleContent,
        deployMessage: `takos deploy ${workerName}`,
      };
      packageFiles.set(artifactFile.artifactPath, bundleContent);
      continue;
    }

    // In the flat schema there are no envelope-level `artifact.kind=bundle`
    // shortcuts — workers always build from workflow artifacts. When no
    // build workflow is declared and the artifact path cannot be resolved,
    // the deploy pipeline falls through to the CLI upload path.
  }

  // Attached containers (nested under workers) and top-level services.
  for (const [name, compute] of Object.entries(manifest.compute ?? {})) {
    if (compute.kind === "service") {
      const artifact = resolveContainerImageArtifact(
        name,
        "service",
        compute as AppService,
      );
      if (artifact) artifacts[name] = artifact;
      continue;
    }
    if (compute.kind === "worker" && compute.containers) {
      for (const [childName, child] of Object.entries(compute.containers)) {
        if (child.cloudflare?.container) continue;
        const artifact = resolveContainerImageArtifact(
          childName,
          "container",
          child as AppContainer,
        );
        if (artifact) artifacts[childName] = artifact;
      }
    }
  }

  return { buildSources, packageFiles, artifacts };
}
