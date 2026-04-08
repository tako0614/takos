// ============================================================
// app-manifest-bundle-docs.ts
// ============================================================
//
// Build bundle documents (Package / Resource / Workload / Endpoint /
// Binding / McpServer) from a flat-schema `AppManifest`. Phase 2 port
// of the legacy envelope-schema emitter.
//
// The output document list is consumed by `buildBundlePackageData` which
// serializes it to `manifest.yaml` inside a bundle zip.
// ============================================================

import {
  type AppCompute,
  type AppDeploymentBuildSource,
  type AppManifest,
  type AppStorage,
  BUILD_SOURCE_LABELS,
  type BundleDoc,
} from "./app-manifest-types.ts";

function buildSourceLabels(
  source: AppDeploymentBuildSource,
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
      ...(manifest.scopes.length > 0 ? { scopes: manifest.scopes } : {}),
      ...(manifest.oauth ? { oauth: manifest.oauth } : {}),
      ...(manifest.overrides ? { overrides: manifest.overrides } : {}),
    },
  });
}

function emitStorageDocs(manifest: AppManifest, docs: BundleDoc[]): void {
  for (const [storageName, storage] of Object.entries(manifest.storage)) {
    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "Resource",
      metadata: { name: storageName },
      spec: storageToDocSpec(storage),
    });
  }
}

function storageToDocSpec(storage: AppStorage): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    type: storage.type,
    ...(storage.bind ? { binding: storage.bind } : {}),
  };
  if (storage.migrations) spec.migrations = storage.migrations;
  if (storage.queue) spec.queue = storage.queue;
  if (storage.vectorIndex) spec.vectorIndex = storage.vectorIndex;
  if (storage.generate) spec.generate = storage.generate;
  if (storage.workflow) spec.workflow = storage.workflow;
  if (storage.durableObject) spec.durableObject = storage.durableObject;
  return spec;
}

function computeToWorkloadSpec(
  compute: AppCompute,
): Record<string, unknown> {
  const pluginConfig: Record<string, unknown> = {};
  if (compute.image) pluginConfig.imageRef = compute.image;
  if (compute.dockerfile) pluginConfig.dockerfile = compute.dockerfile;
  if (compute.port != null) pluginConfig.port = compute.port;
  if (compute.instanceType) pluginConfig.instanceType = compute.instanceType;
  if (compute.maxInstances) pluginConfig.maxInstances = compute.maxInstances;

  const spec: Record<string, unknown> = {
    type: computeKindToDocType(compute.kind),
    pluginConfig,
  };
  if (compute.env) spec.env = compute.env;
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
  buildSources: Map<string, AppDeploymentBuildSource>,
  docs: BundleDoc[],
): void {
  for (const [name, compute] of Object.entries(manifest.compute)) {
    const source = compute.kind === "worker" ? buildSources.get(name) : undefined;
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

function emitStorageBindings(
  manifest: AppManifest,
  docs: BundleDoc[],
): void {
  // Flat schema: every top-level compute (worker / service) that has an
  // explicit env map referencing a storage `bind` name gets a Binding doc.
  // Attached containers never carry direct storage bindings.
  const eligibleWorkloads = Object.entries(manifest.compute).filter(
    ([, compute]) =>
      compute.kind === "worker" || compute.kind === "service",
  );

  for (const [storageName, storage] of Object.entries(manifest.storage)) {
    if (!storage.bind) continue;
    for (const [workloadName, compute] of eligibleWorkloads) {
      if (!compute.env || !(storage.bind in compute.env)) continue;
      docs.push({
        apiVersion: "takos.dev/v1alpha1",
        kind: "Binding",
        metadata: { name: `${storageName}-to-${workloadName}` },
        spec: {
          from: storageName,
          to: workloadName,
          mount: {
            as: storage.bind,
            type: storage.type,
          },
        },
      });
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
    if (pub.type !== "McpServer") continue;
    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "McpServer",
      metadata: { name: pub.name ?? "mcp" },
      spec: {
        path: pub.path,
        ...(pub.transport ? { transport: pub.transport } : {}),
        ...(pub.authSecretRef ? { authSecretRef: pub.authSecretRef } : {}),
      },
    });
  }
}

export function buildBundleDocs(
  manifest: AppManifest,
  buildSources: Map<string, AppDeploymentBuildSource>,
): BundleDoc[] {
  const docs: BundleDoc[] = [];
  emitPackageDoc(manifest, docs);
  emitStorageDocs(manifest, docs);
  emitComputeDocs(manifest, buildSources, docs);
  emitStorageBindings(manifest, docs);
  emitRouteDocs(manifest, docs);
  emitPublishDocs(manifest, docs);
  return docs;
}
