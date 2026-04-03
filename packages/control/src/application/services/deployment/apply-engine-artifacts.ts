import type { Env } from "../../../shared/types/env.ts";
import type {
  AppContainer,
  AppService,
  AppWorker,
} from "../source/app-manifest-types.ts";
import type { GroupDesiredState } from "./group-state.ts";
import { isDigestPinnedImageRef } from "./image-ref.ts";

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

export type ApplyArtifactInput = ApplyWorkerArtifact | ApplyContainerArtifact;

type WorkerDirectArtifact = {
  kind: "bundle";
  deploymentId?: string;
  artifactRef?: string;
};

type ImageDirectArtifact = {
  kind: "image";
  imageRef: string;
  provider?: "oci" | "ecs" | "cloud-run" | "k8s";
};

export type ApplyEngineArtifactDeps = {
  getDeploymentById: (db: Env["DB"], deploymentId: string) => Promise<unknown>;
  findDeploymentByArtifactRef: (
    db: Env["DB"],
    artifactRef: string,
  ) => Promise<unknown>;
  getBundleContent: (env: Env, deployment: any) => Promise<string>;
};

export function parseApplyArtifact(input: unknown): ApplyArtifactInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const parsed = input as Record<string, unknown>;
  if (
    (parsed.kind === "worker_bundle" || parsed.kind === "worker-bundle") &&
    typeof parsed.bundleContent === "string"
  ) {
    return {
      kind: "worker_bundle",
      bundleContent: parsed.bundleContent,
      ...(typeof parsed.deployMessage === "string"
        ? { deployMessage: parsed.deployMessage }
        : {}),
    };
  }
  if (
    (parsed.kind === "container_image" ||
      parsed.kind === "container-image") &&
    typeof parsed.imageRef === "string" &&
    parsed.imageRef.trim().length > 0
  ) {
    return {
      kind: "container_image",
      imageRef: parsed.imageRef,
      ...(parsed.provider === "oci" || parsed.provider === "ecs" ||
          parsed.provider === "cloud-run" || parsed.provider === "k8s"
        ? { provider: parsed.provider }
        : {}),
      ...(typeof parsed.deployMessage === "string"
        ? { deployMessage: parsed.deployMessage }
        : {}),
    };
  }
  return null;
}

function resolveContainerImageArtifact(
  workloadName: string,
  workloadCategory: "container" | "service",
  spec: AppContainer | AppService,
): ApplyContainerArtifact | null {
  const directImageArtifact =
    ("artifact" in spec ? spec.artifact : undefined) as
      | ImageDirectArtifact
      | undefined;
  if (directImageArtifact?.kind === "image") {
    if (!isDigestPinnedImageRef(directImageArtifact.imageRef)) {
      throw new Error(
        `${
          workloadCategory === "container" ? "Container" : "Service"
        } "${workloadName}" requires a digest-pinned imageRef (@sha256:...) for online apply`,
      );
    }
    return {
      kind: "container_image",
      imageRef: directImageArtifact.imageRef,
      ...(directImageArtifact.provider
        ? { provider: directImageArtifact.provider }
        : {}),
      deployMessage: `takos apply ${workloadName}`,
    };
  }

  if (
    "imageRef" in spec && typeof spec.imageRef === "string" &&
    spec.imageRef.trim().length > 0
  ) {
    if (!isDigestPinnedImageRef(spec.imageRef)) {
      throw new Error(
        `${
          workloadCategory === "container" ? "Container" : "Service"
        } "${workloadName}" requires a digest-pinned imageRef (@sha256:...) for online apply`,
      );
    }
    return {
      kind: "container_image",
      imageRef: spec.imageRef,
      ...("provider" in spec &&
          (spec.provider === "oci" || spec.provider === "ecs" ||
            spec.provider === "cloud-run" || spec.provider === "k8s")
        ? { provider: spec.provider }
        : {}),
      deployMessage: `takos apply ${workloadName}`,
    };
  }

  return null;
}

export function assertApplyImageArtifact(
  workloadName: string,
  workloadCategory: "container" | "service",
  artifact: ApplyArtifactInput | null,
): asserts artifact is ApplyContainerArtifact {
  if (
    artifact?.kind === "container_image" && artifact.imageRef.trim().length > 0
  ) {
    return;
  }
  throw new Error(
    `${
      workloadCategory === "container" ? "Container" : "Service"
    } "${workloadName}" requires imageRef or artifact.kind=image for online apply`,
  );
}

export async function resolveArtifactForApply(
  deps: ApplyEngineArtifactDeps,
  env: Env,
  workload: GroupDesiredState["workloads"][string],
  directArtifactInput: unknown,
): Promise<ApplyArtifactInput | null> {
  const directArtifact = parseApplyArtifact(directArtifactInput);
  if (directArtifact) return directArtifact;
  return await resolveArtifactFromDesiredManifest(deps, env, workload);
}

export async function resolveArtifactFromDesiredManifest(
  deps: ApplyEngineArtifactDeps,
  env: Env,
  workload: GroupDesiredState["workloads"][string],
): Promise<ApplyArtifactInput | null> {
  const spec = workload.spec as AppWorker | AppContainer | AppService;
  if (workload.category === "worker") {
    const directArtifact = ("artifact" in spec ? spec.artifact : undefined) as
      | WorkerDirectArtifact
      | undefined;
    if (directArtifact?.kind === "bundle" && directArtifact.deploymentId) {
      const deployment = await deps.getDeploymentById(
        env.DB,
        directArtifact.deploymentId,
      );
      if (!deployment) {
        throw new Error(
          `Referenced deployment "${directArtifact.deploymentId}" for worker "${workload.name}" was not found`,
        );
      }
      return {
        kind: "worker_bundle",
        bundleContent: await deps.getBundleContent(env, deployment),
        deployMessage: `takos apply ${workload.name}`,
      };
    }
    if (directArtifact?.kind === "bundle" && directArtifact.artifactRef) {
      const deployment = await deps.findDeploymentByArtifactRef(
        env.DB,
        directArtifact.artifactRef,
      );
      if (!deployment) {
        throw new Error(
          `Referenced artifact "${directArtifact.artifactRef}" for worker "${workload.name}" was not found`,
        );
      }
      return {
        kind: "worker_bundle",
        bundleContent: await deps.getBundleContent(env, deployment),
        deployMessage: `takos apply ${workload.name}`,
      };
    }
    return null;
  }

  return resolveContainerImageArtifact(
    workload.name,
    workload.category,
    spec as AppContainer | AppService,
  );
}
