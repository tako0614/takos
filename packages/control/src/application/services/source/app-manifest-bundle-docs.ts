// ============================================================
// app-manifest-bundle-docs.ts
// ============================================================
//
// Build bundle documents (Package / Workload / Endpoint / route publications)
// from a flat-schema `AppManifest`.
//
// The output document list is consumed by `buildBundlePackageData` which
// serializes it to `manifest.yaml` inside a bundle zip.
// ============================================================

import {
  type AppCompute,
  type GroupDeploymentSnapshotBuildSource,
  type AppManifest,
  BUILD_SOURCE_LABELS,
  type BundleDoc,
} from "./app-manifest-types.ts";

function buildSourceLabels(
  source: GroupDeploymentSnapshotBuildSource,
): Record<string, string> {
  return {
    [BUILD_SOURCE_LABELS.workflowPath]: source.workflow_path,
    [BUILD_SOURCE_LABELS.workflowJob]: source.workflow_job,
    [BUILD_SOURCE_LABELS.workflowArtifact]: source.workflow_artifact,
    [BUILD_SOURCE_LABELS.artifactPath]: source.artifact_path,
    ...(source.workflow_run_id
      ? { [BUILD_SOURCE_LABELS.sourceRunId]: source.workflow_run_id }
      : {}),
    ...(source.workflow_job_id
      ? { [BUILD_SOURCE_LABELS.sourceJobId]: source.workflow_job_id }
      : {}),
    ...(source.source_sha
      ? { [BUILD_SOURCE_LABELS.sourceSha]: source.source_sha }
      : {}),
  };
}

function emitPackageDoc(manifest: AppManifest, docs: BundleDoc[]): void {
  docs.push({
    apiVersion: "takos.dev/v1alpha1",
    kind: "Package",
    metadata: { name: manifest.name },
    spec: {
      ...(manifest.version ? { version: manifest.version } : {}),
      ...(Object.keys(manifest.env).length > 0 ? { env: manifest.env } : {}),
      ...(manifest.overrides ? { overrides: manifest.overrides } : {}),
    },
  });
}

function computeToWorkloadSpec(
  compute: AppCompute,
): Record<string, unknown> {
  const pluginConfig: Record<string, unknown> = {};
  if (compute.image) pluginConfig.imageRef = compute.image;
  if (compute.dockerfile) pluginConfig.dockerfile = compute.dockerfile;
  if (compute.port != null) pluginConfig.port = compute.port;

  const spec: Record<string, unknown> = {
    type: computeKindToDocType(compute.kind),
    pluginConfig,
  };
  if (compute.env) spec.env = compute.env;
  if (compute.consume) spec.consume = compute.consume;
  if (compute.healthCheck) spec.healthCheck = compute.healthCheck;
  if (compute.volumes) spec.volumes = compute.volumes;
  if (compute.depends) spec.dependsOn = compute.depends;
  if (compute.triggers) spec.triggers = compute.triggers;
  if (compute.scaling) spec.scaling = compute.scaling;
  if (compute.readiness) spec.readiness = { path: compute.readiness };
  return spec;
}

function computeKindToDocType(kind: AppCompute["kind"]): string {
  switch (kind) {
    case "worker":
      return "cloudflare.worker";
    case "service":
      return "service";
    case "attached-container":
      return "container";
  }
}

function emitComputeDocs(
  manifest: AppManifest,
  buildSources: Map<string, GroupDeploymentSnapshotBuildSource>,
  docs: BundleDoc[],
): void {
  for (const [name, compute] of Object.entries(manifest.compute)) {
    const source = compute.kind === "worker"
      ? buildSources.get(name)
      : undefined;
    if (compute.kind === "worker" && !source && !compute.build) {
      throw new Error(`Build source is missing for worker: ${name}`);
    }

    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "Workload",
      metadata: {
        name,
        ...(source ? { labels: buildSourceLabels(source) } : {}),
      },
      spec: {
        ...computeToWorkloadSpec(compute),
        ...(source ? { artifactRef: source.artifact_path } : {}),
      },
    });

    if (compute.kind === "worker" && compute.containers) {
      for (const [childName, child] of Object.entries(compute.containers)) {
        docs.push({
          apiVersion: "takos.dev/v1alpha1",
          kind: "Workload",
          metadata: { name: `${name}-${childName}` },
          spec: {
            ...computeToWorkloadSpec(child),
            parentRef: name,
          },
        });
        docs.push({
          apiVersion: "takos.dev/v1alpha1",
          kind: "Binding",
          metadata: { name: `${childName}-container-to-${name}` },
          spec: {
            from: `${name}-${childName}`,
            to: name,
            mount: {
              as: `${childName.toUpperCase().replace(/-/g, "_")}_CONTAINER`,
              type: "durableObject",
            },
          },
        });
      }
    }
  }
}

function emitRouteDocs(manifest: AppManifest, docs: BundleDoc[]): void {
  for (const [index, route] of manifest.routes.entries()) {
    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "Endpoint",
      metadata: { name: `route-${index + 1}` },
      spec: {
        protocol: "http",
        targetRef: route.target,
        ...(route.path ? { path: route.path } : {}),
        ...(route.timeoutMs != null ? { timeoutMs: route.timeoutMs } : {}),
        ...(route.methods ? { methods: route.methods } : {}),
      },
    });
  }
}

function emitPublishDocs(manifest: AppManifest, docs: BundleDoc[]): void {
  for (const pub of manifest.publish) {
    if (pub.publisher === "takos" || !pub.type || !pub.publisher || !pub.path) {
      continue;
    }
    docs.push({
      apiVersion: "takos.dev/v1alpha1" as const,
      kind: pub.type,
      metadata: { name: pub.name },
      spec: {
        ...(pub.spec ? pub.spec : {}),
        targetRef: pub.publisher,
        path: pub.path,
        ...(pub.title ? { title: pub.title } : {}),
      },
    });
  }
}

export function buildBundleDocs(
  manifest: AppManifest,
  buildSources: Map<string, GroupDeploymentSnapshotBuildSource>,
): BundleDoc[] {
  const docs: BundleDoc[] = [];
  emitPackageDoc(manifest, docs);
  emitComputeDocs(manifest, buildSources, docs);
  emitRouteDocs(manifest, docs);
  emitPublishDocs(manifest, docs);
  return docs;
}
