import {
  type AppDeploymentBuildSource,
  type AppManifest,
  type AppWorkloadBindings,
  BUILD_SOURCE_LABELS,
  type BundleDoc,
} from "./app-manifest-types.ts";
import { getWorkloadResourceBindingDescriptors } from "./app-manifest-bindings.ts";

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

interface ManifestContainer {
  dockerfile?: string;
  imageRef?: string;
  artifact?: { kind: "image"; imageRef: string; provider?: string };
  provider?: string;
  port?: number;
  instanceType?: string;
  maxInstances?: number;
  env?: Record<string, string>;
}

interface ManifestService {
  dockerfile?: string;
  imageRef?: string;
  artifact?: { kind: "image"; imageRef: string; provider?: string };
  provider?: string;
  port?: number;
  instanceType?: string;
  maxInstances?: number;
  ipv4?: boolean;
  env?: Record<string, string>;
  healthCheck?: {
    path?: string;
    type?: string;
    port?: number;
    command?: string;
    intervalSeconds?: number;
    timeoutSeconds?: number;
    unhealthyThreshold?: number;
  };
  volumes?: Array<{ name: string; mountPath: string; size: string }>;
  dependsOn?: string[];
  bindings?: AppWorkloadBindings;
  triggers?: {
    schedules?: Array<{ cron: string; export: string }>;
    queues?: Array<{ queue: string; export: string }>;
  };
}

interface ManifestWorker {
  build?: {
    fromWorkflow: {
      path: string;
      job: string;
      artifact: string;
      artifactPath: string;
    };
  };
  artifact?: { kind: "bundle"; deploymentId?: string; artifactRef?: string };
  env?: Record<string, string>;
  bindings?: AppWorkloadBindings;
  triggers?: {
    schedules?: Array<{ cron: string; export: string }>;
    queues?: Array<{ queue: string; export: string }>;
  };
  containers?: string[];
  healthCheck?: {
    path?: string;
    type?: string;
    port?: number;
    command?: string;
    intervalSeconds?: number;
    timeoutSeconds?: number;
    unhealthyThreshold?: number;
  };
  scaling?: {
    minInstances?: number;
    maxInstances?: number;
    maxConcurrency?: number;
  };
  dependsOn?: string[];
}

interface ManifestRoute {
  name?: string;
  target: string;
  path?: string;
  ingress?: string;
  timeoutMs?: number;
  methods?: string[];
}

function emitPackageDoc(manifest: AppManifest, docs: BundleDoc[]): void {
  const envSpec: Record<string, unknown> = {};
  if (manifest.spec.env) {
    if ((manifest.spec.env as Record<string, unknown>).required) {
      envSpec.required =
        (manifest.spec.env as Record<string, unknown>).required;
    }
    if ((manifest.spec.env as Record<string, unknown>).inject) {
      envSpec.inject = (manifest.spec.env as Record<string, unknown>).inject;
    }
  }

  docs.push({
    apiVersion: "takos.dev/v1alpha1",
    kind: "Package",
    metadata: { name: manifest.metadata.name },
    spec: {
      ...(manifest.metadata.appId ? { appId: manifest.metadata.appId } : {}),
      version: manifest.spec.version,
      ...(manifest.spec.description
        ? { description: manifest.spec.description }
        : {}),
      ...(manifest.spec.icon ? { icon: manifest.spec.icon } : {}),
      ...(manifest.spec.category ? { category: manifest.spec.category } : {}),
      ...(manifest.spec.tags ? { tags: manifest.spec.tags } : {}),
      ...(manifest.spec.capabilities
        ? { capabilities: manifest.spec.capabilities }
        : {}),
      ...(Object.keys(envSpec).length > 0
        ? { env: envSpec }
        : manifest.spec.env
        ? { env: manifest.spec.env }
        : {}),
      ...(manifest.spec.oauth ? { oauth: manifest.spec.oauth } : {}),
      ...(manifest.spec.takos ? { takos: manifest.spec.takos } : {}),
      ...(manifest.spec.lifecycle
        ? { lifecycle: manifest.spec.lifecycle }
        : {}),
      ...(manifest.spec.update ? { update: manifest.spec.update } : {}),
      ...(manifest.spec.fileHandlers
        ? { fileHandlers: manifest.spec.fileHandlers }
        : {}),
      ...(manifest.spec.overrides
        ? { overrides: manifest.spec.overrides }
        : {}),
    },
  });
}

function emitResourceDocs(manifest: AppManifest, docs: BundleDoc[]): void {
  for (
    const [resourceName, resource] of Object.entries(
      manifest.spec.resources || {},
    )
  ) {
    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "Resource",
      metadata: { name: resourceName },
      spec: {
        type: resource.type,
        ...(resource.binding ? { binding: resource.binding } : {}),
        ...(resource.generate ? { generate: resource.generate } : {}),
        ...(resource.type === "vectorize" && resource.vectorize
          ? { vectorize: resource.vectorize }
          : {}),
        ...(resource.type === "queue" && resource.queue
          ? { queue: resource.queue }
          : {}),
        ...(resource.type === "analyticsEngine" && resource.analyticsEngine
          ? { analyticsEngine: resource.analyticsEngine }
          : {}),
        ...(resource.type === "workflow" && resource.workflow
          ? { workflow: resource.workflow }
          : {}),
        ...(resource.type === "durableObject" && resource.durableObject
          ? { durableObject: resource.durableObject }
          : {}),
        ...(resource.type === "d1" && resource.migrations
          ? typeof resource.migrations === "string"
            ? { migrations: resource.migrations }
            : {
              migrations: resource.migrations.up,
              rollbackMigrations: resource.migrations.down,
            }
          : {}),
        ...(resource.limits ? { limits: resource.limits } : {}),
      },
    });
  }
}

function emitNewFormatDocs(
  manifest: AppManifest,
  buildSources: Map<string, AppDeploymentBuildSource>,
  docs: BundleDoc[],
): void {
  const spec = manifest.spec as unknown as Record<string, unknown>;
  const containers = (spec.containers || {}) as Record<
    string,
    ManifestContainer
  >;
  const services = (spec.services || {}) as Record<string, ManifestService>;
  const workers = (spec.workers || {}) as Record<string, ManifestWorker>;
  const routes = (spec.routes || []) as ManifestRoute[];

  const workerReferencedContainers = new Set<string>();
  for (const worker of Object.values(workers)) {
    for (const cRef of worker.containers || []) {
      workerReferencedContainers.add(cRef);
    }
  }

  for (const [containerName, container] of Object.entries(containers)) {
    if (workerReferencedContainers.has(containerName)) continue;
    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "Workload",
      metadata: { name: containerName },
      spec: {
        type: "container",
        pluginConfig: {
          ...(container.dockerfile ? { dockerfile: container.dockerfile } : {}),
          ...(container.imageRef ? { imageRef: container.imageRef } : {}),
          ...(container.artifact ? { artifact: container.artifact } : {}),
          ...(container.provider ? { provider: container.provider } : {}),
          ...(container.port != null ? { port: container.port } : {}),
          ...(container.instanceType
            ? { instanceType: container.instanceType }
            : {}),
          ...(container.maxInstances
            ? { maxInstances: container.maxInstances }
            : {}),
        },
        ...(container.env ? { env: container.env } : {}),
      },
    });
  }

  for (const [serviceName, service] of Object.entries(services)) {
    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "Workload",
      metadata: { name: serviceName },
      spec: {
        type: "service",
        pluginConfig: {
          ...(service.dockerfile ? { dockerfile: service.dockerfile } : {}),
          ...(service.imageRef ? { imageRef: service.imageRef } : {}),
          ...(service.artifact ? { artifact: service.artifact } : {}),
          ...(service.provider ? { provider: service.provider } : {}),
          ...(service.port != null ? { port: service.port } : {}),
          ...(service.instanceType
            ? { instanceType: service.instanceType }
            : {}),
          ...(service.maxInstances
            ? { maxInstances: service.maxInstances }
            : {}),
          ...(service.ipv4 ? { ipv4: true } : {}),
        },
        ...(service.env ? { env: service.env } : {}),
        ...(service.healthCheck ? { healthCheck: service.healthCheck } : {}),
        ...(service.volumes ? { volumes: service.volumes } : {}),
        ...(service.dependsOn ? { dependsOn: service.dependsOn } : {}),
        ...(service.bindings ? { bindings: service.bindings } : {}),
        ...(service.triggers ? { triggers: service.triggers } : {}),
      },
    });
  }

  for (const [workerName, worker] of Object.entries(workers)) {
    const source = buildSources.get(workerName);
    if (!source && worker.artifact?.kind !== "bundle") {
      throw new Error(`Build source is missing for worker: ${workerName}`);
    }

    const resolvedContainers = (worker.containers || []).map((cRef) => {
      const cDef = containers[cRef];
      if (!cDef) {
        throw new Error(
          `Worker '${workerName}' references unknown container '${cRef}'`,
        );
      }
      return { name: cRef, ...cDef };
    });

    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "Workload",
      metadata: {
        name: workerName,
        ...(source ? { labels: buildSourceLabels(source) } : {}),
      },
      spec: {
        type: "cloudflare.worker",
        artifactRef: source?.artifact_path ?? worker.artifact?.artifactRef,
        pluginConfig: {
          env: worker.env || {},
          bindings: {
            services: worker.bindings?.services || [],
          },
          ...(worker.triggers ? { triggers: worker.triggers } : {}),
          ...(resolvedContainers.length > 0
            ? {
              containers: resolvedContainers.map((c) => ({
                name: c.name,
                dockerfile: c.dockerfile,
                port: c.port,
                ...(c.instanceType ? { instanceType: c.instanceType } : {}),
                ...(c.maxInstances ? { maxInstances: c.maxInstances } : {}),
              })),
            }
            : {}),
        },
        ...(worker.healthCheck ? { healthCheck: worker.healthCheck } : {}),
        ...(worker.scaling ? { scaling: worker.scaling } : {}),
        ...(worker.dependsOn ? { dependsOn: worker.dependsOn } : {}),
      },
    });

    for (const c of resolvedContainers) {
      docs.push({
        apiVersion: "takos.dev/v1alpha1",
        kind: "Workload",
        metadata: { name: `${workerName}-${c.name}` },
        spec: {
          type: "container",
          parentRef: workerName,
          pluginConfig: {
            dockerfile: c.dockerfile,
            port: c.port,
            ...(c.instanceType ? { instanceType: c.instanceType } : {}),
            ...(c.maxInstances ? { maxInstances: c.maxInstances } : {}),
          },
        },
      });

      docs.push({
        apiVersion: "takos.dev/v1alpha1",
        kind: "Binding",
        metadata: { name: `${c.name}-container-to-${workerName}` },
        spec: {
          from: `${workerName}-${c.name}`,
          to: workerName,
          mount: {
            as: `${c.name.toUpperCase().replace(/-/g, "_")}_CONTAINER`,
            type: "durableObject",
          },
        },
      });
    }
  }

  const resources = manifest.spec.resources || {};
  const bindableWorkloads = {
    ...workers,
    ...services,
  };
  for (const [resourceName, resource] of Object.entries(resources)) {
    if (!resource.binding) continue;
    for (const [workloadName, workload] of Object.entries(bindableWorkloads)) {
      const mountType = resource.type === "secretRef"
        ? undefined
        : resource.type;
      const inBindings = getWorkloadResourceBindingDescriptors(
        workload.bindings,
      ).some((descriptor) => descriptor.resourceName === resourceName);
      if (!inBindings || !mountType) continue;
      docs.push({
        apiVersion: "takos.dev/v1alpha1",
        kind: "Binding",
        metadata: { name: `${resourceName}-to-${workloadName}` },
        spec: {
          from: resourceName,
          to: workloadName,
          mount: {
            as: resource.binding,
            type: mountType,
          },
        },
      });
    }
  }

  for (const [index, route] of routes.entries()) {
    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "Endpoint",
      metadata: { name: route.name || `route-${index + 1}` },
      spec: {
        protocol: "http",
        targetRef: route.target,
        ...(route.ingress ? { ingressRef: route.ingress } : {}),
        ...(route.path ? { path: route.path } : {}),
        ...(route.timeoutMs != null ? { timeoutMs: route.timeoutMs } : {}),
        ...(route.methods ? { methods: route.methods } : {}),
      },
    });
  }
}

function emitMcpServerDocs(manifest: AppManifest, docs: BundleDoc[]): void {
  for (const server of manifest.spec.mcpServers || []) {
    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "McpServer",
      metadata: { name: server.name },
      spec: {
        endpointRef: server.endpoint || server.route,
        name: server.name,
        transport: server.transport || "streamable-http",
        ...(server.authSecretRef
          ? { authSecretRef: server.authSecretRef }
          : {}),
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
  emitResourceDocs(manifest, docs);
  emitNewFormatDocs(manifest, buildSources, docs);
  emitMcpServerDocs(manifest, docs);
  return docs;
}
