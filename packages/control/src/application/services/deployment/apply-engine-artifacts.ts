import type { Env } from "../../../shared/types/env.ts";
import type { AppCompute } from "../source/app-manifest-types.ts";
import type { GroupDesiredState } from "./group-state.ts";
import type { Deployment } from "./models.ts";
import { isDigestPinnedImageRef } from "./image-ref.ts";

// Narrowed aliases for the three compute kinds.
type AppWorker = AppCompute & { kind: "worker" };
type AppService = AppCompute & { kind: "service" };
type AppContainer = AppCompute & { kind: "attached-container" };

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

export type ApplyArtifactInput = ApplyWorkerArtifact | ApplyContainerArtifact;

export type ApplyEngineArtifactDeps = {
  getDeploymentById: (db: Env["DB"], deploymentId: string) => Promise<unknown>;
  findDeploymentByArtifactRef: (
    db: Env["DB"],
    artifactRef: string,
  ) => Promise<unknown>;
  getBundleContent: (env: Env, deployment: Deployment) => Promise<string>;
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
    const backend = parsed.backend;
    return {
      kind: "container_image",
      imageRef: parsed.imageRef,
      ...(
        backend === "oci" || backend === "ecs" ||
          backend === "cloud-run" || backend === "k8s"
          ? { backend }
          : {}
      ),
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
  // Flat schema: `compute.image` is the only image ref source for a
  // service / attached container. No envelope-level `artifact` field.
  if (typeof spec.image === "string" && spec.image.trim().length > 0) {
    if (!isDigestPinnedImageRef(spec.image)) {
      throw new Error(
        `${
          workloadCategory === "container" ? "Container" : "Service"
        } "${workloadName}" requires a digest-pinned imageRef (@sha256:...) for online apply`,
      );
    }
    return {
      kind: "container_image",
      imageRef: spec.image,
      deployMessage: `takos deploy ${workloadName}`,
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
  _deps: ApplyEngineArtifactDeps,
  _env: Env,
  workload: GroupDesiredState["workloads"][string],
): Promise<ApplyArtifactInput | null> {
  const spec = workload.spec as AppWorker | AppContainer | AppService;
  if (workload.category === "worker") {
    // In the flat schema, worker bundle artifacts are resolved by the
    // caller via the CI artifact registry, not via an embedded `artifact`
    // field. When no directArtifactInput is supplied at apply time there is
    // no fallback source for the bundle content.
    return null;
  }

  return resolveContainerImageArtifact(
    workload.name,
    workload.category,
    spec as AppContainer | AppService,
  );
}
