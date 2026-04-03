import type {
  AppDeploymentBuildSource,
  AppManifest,
  AppWorkloadBindings,
  BUILD_SOURCE_LABELS,
  BundleDoc,
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

export function emitNewFormatDocs(
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
      )
        .some((descriptor) => descriptor.resourceName === resourceName);
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
    const targetRef = route.target;
    docs.push({
      apiVersion: "takos.dev/v1alpha1",
      kind: "Endpoint",
      metadata: { name: route.name || `route-${index + 1}` },
      spec: {
        protocol: "http",
        targetRef,
        ...(route.ingress ? { ingressRef: route.ingress } : {}),
        ...(route.path ? { path: route.path } : {}),
        ...(route.timeoutMs != null ? { timeoutMs: route.timeoutMs } : {}),
        ...(route.methods ? { methods: route.methods } : {}),
      },
    });
  }
}
