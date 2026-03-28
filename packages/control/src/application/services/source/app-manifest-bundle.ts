import YAML from 'yaml';
import { computeSHA256 } from '../../../shared/utils/hash';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import {
  normalizeRepoPath,
  BUILD_SOURCE_LABELS,
  type AppManifest,
  type AppDeploymentBuildSource,
  type BundleDoc,
} from './app-manifest-types';

function buildSourceLabels(source: AppDeploymentBuildSource): Record<string, string> {
  return {
    [BUILD_SOURCE_LABELS.workflowPath]: source.workflow_path,
    [BUILD_SOURCE_LABELS.workflowJob]: source.workflow_job,
    [BUILD_SOURCE_LABELS.workflowArtifact]: source.workflow_artifact,
    [BUILD_SOURCE_LABELS.artifactPath]: source.artifact_path,
    ...(source.workflow_run_id ? { [BUILD_SOURCE_LABELS.sourceRunId]: source.workflow_run_id } : {}),
    ...(source.workflow_job_id ? { [BUILD_SOURCE_LABELS.sourceJobId]: source.workflow_job_id } : {}),
    ...(source.source_sha ? { [BUILD_SOURCE_LABELS.sourceSha]: source.source_sha } : {}),
  };
}

// ── New format types (inline until types merge) ──────────────────────────────

/** Container definition in the new `spec.containers` section (CF Containers) */
interface ManifestContainer {
  dockerfile: string;
  port?: number;
  instanceType?: string;
  maxInstances?: number;
  env?: Record<string, string>;
}

/** Service definition in the new `spec.services` section (常設コンテナ) */
interface ManifestService {
  dockerfile: string;
  port?: number;
  instanceType?: string;
  maxInstances?: number;
  ipv4?: boolean;
  env?: Record<string, string>;
}

/** Worker definition in the new `spec.workers` section */
interface ManifestWorker {
  build: {
    fromWorkflow: {
      path: string;
      job: string;
      artifact: string;
      artifactPath: string;
    };
  };
  env?: Record<string, string>;
  bindings?: {
    d1?: string[];
    r2?: string[];
    kv?: string[];
    vectorize?: string[];
    queues?: string[];
    analytics?: string[];
    workflows?: string[];
    durableObjects?: string[];
    services?: string[];
  };
  triggers?: {
    schedules?: Array<{ cron: string; export: string }>;
    queues?: Array<{ queue: string; export: string }>;
  };
  containers?: string[];
}

interface ManifestRoute {
  name?: string;
  target: string;
  path?: string;
  ingress?: string;
  timeoutMs?: number;
}

// ── New-format bundle generation ─────────────────────────────────────────────

function emitNewFormatDocs(
  manifest: AppManifest,
  buildSources: Map<string, AppDeploymentBuildSource>,
  docs: BundleDoc[],
): void {
  const spec = manifest.spec as unknown as Record<string, unknown>;
  const containers = (spec.containers || {}) as Record<string, ManifestContainer>;
  const services = (spec.services || {}) as Record<string, ManifestService>;
  const workers = (spec.workers || {}) as Record<string, ManifestWorker>;
  const routes = (spec.routes || []) as ManifestRoute[];

  // Track which containers are referenced by workers (non-standalone)
  const workerReferencedContainers = new Set<string>();
  for (const worker of Object.values(workers)) {
    for (const cRef of worker.containers || []) {
      workerReferencedContainers.add(cRef);
    }
  }

  // ── Standalone containers (CF Containers not referenced by workers) ────────
  for (const [containerName, container] of Object.entries(containers)) {
    if (workerReferencedContainers.has(containerName)) continue;
    docs.push({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'Workload',
      metadata: { name: containerName },
      spec: {
        type: 'container',
        pluginConfig: {
          dockerfile: container.dockerfile,
          ...(container.port != null ? { port: container.port } : {}),
          ...(container.instanceType ? { instanceType: container.instanceType } : {}),
          ...(container.maxInstances ? { maxInstances: container.maxInstances } : {}),
        },
        ...(container.env ? { env: container.env } : {}),
      },
    });
  }

  // ── Services (常設コンテナ) ────────────────────────────────────────────────
  for (const [serviceName, service] of Object.entries(services)) {
    docs.push({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'Workload',
      metadata: { name: serviceName },
      spec: {
        type: 'service',
        pluginConfig: {
          dockerfile: service.dockerfile,
          ...(service.port != null ? { port: service.port } : {}),
          ...(service.instanceType ? { instanceType: service.instanceType } : {}),
          ...(service.maxInstances ? { maxInstances: service.maxInstances } : {}),
          ...(service.ipv4 ? { ipv4: true } : {}),
        },
        ...(service.env ? { env: service.env } : {}),
      },
    });
  }

  // ── Workers ────────────────────────────────────────────────────────────────
  for (const [workerName, worker] of Object.entries(workers)) {
    const source = buildSources.get(workerName);
    if (!source) {
      throw new Error(`Build source is missing for worker: ${workerName}`);
    }

    // Resolve container references from the containers section
    const resolvedContainers = (worker.containers || []).map((cRef) => {
      const cDef = containers[cRef];
      if (!cDef) {
        throw new Error(`Worker '${workerName}' references unknown container '${cRef}'`);
      }
      return { name: cRef, ...cDef };
    });

    docs.push({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'Workload',
      metadata: {
        name: workerName,
        labels: buildSourceLabels(source),
      },
      spec: {
        type: 'cloudflare.worker',
        artifactRef: source.artifact_path,
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
      },
    });

    // Emit child container Workload + Binding for each container attached to this worker
    for (const c of resolvedContainers) {
      docs.push({
        apiVersion: 'takos.dev/v1alpha1',
        kind: 'Workload',
        metadata: { name: `${workerName}-${c.name}` },
        spec: {
          type: 'container',
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
        apiVersion: 'takos.dev/v1alpha1',
        kind: 'Binding',
        metadata: { name: `${c.name}-container-to-${workerName}` },
        spec: {
          from: `${workerName}-${c.name}`,
          to: workerName,
          mount: {
            as: `${c.name.toUpperCase().replace(/-/g, '_')}_CONTAINER`,
            type: 'durableObject',
          },
        },
      });
    }
  }

  // ── Resource bindings (new format: iterate workers) ────────────────────────
  const resources = manifest.spec.resources || {};
  for (const [resourceName, resource] of Object.entries(resources)) {
    if (!resource.binding) continue;
    for (const [workerName, worker] of Object.entries(workers)) {
      const bindingLists = worker.bindings || {};
      const mountType = resource.type === 'secretRef' ? undefined : resource.type;
      const inBindings = [
        ...(bindingLists.d1 || []),
        ...(bindingLists.r2 || []),
        ...(bindingLists.kv || []),
        ...(bindingLists.vectorize || []),
        ...(bindingLists.queues || []),
        ...(bindingLists.analytics || []),
        ...(bindingLists.workflows || []),
        ...(bindingLists.durableObjects || []),
      ];
      if (!inBindings.includes(resourceName) || !mountType) continue;
      docs.push({
        apiVersion: 'takos.dev/v1alpha1',
        kind: 'Binding',
        metadata: { name: `${resourceName}-to-${workerName}` },
        spec: {
          from: resourceName,
          to: workerName,
          mount: {
            as: resource.binding,
            type: mountType,
          },
        },
      });
    }
  }

  // ── Routes ─────────────────────────────────────────────────────────────────
  for (const [index, route] of routes.entries()) {
    const targetRef = route.target;
    docs.push({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'Endpoint',
      metadata: { name: route.name || `route-${index + 1}` },
      spec: {
        protocol: 'http',
        targetRef,
        ...(route.ingress ? { ingressRef: route.ingress } : {}),
        ...(route.path ? { path: route.path } : {}),
        ...(route.timeoutMs != null ? { timeoutMs: route.timeoutMs } : {}),
      },
    });
  }
}

// ── Public entry point ───────────────────────────────────────────────────────

export function appManifestToBundleDocs(
  manifest: AppManifest,
  buildSources: Map<string, AppDeploymentBuildSource>,
): BundleDoc[] {
  const docs: BundleDoc[] = [];

  // Package doc
  const envSpec: Record<string, unknown> = {};
  if (manifest.spec.env) {
    if ((manifest.spec.env as Record<string, unknown>).required) {
      envSpec.required = (manifest.spec.env as Record<string, unknown>).required;
    }
    if ((manifest.spec.env as Record<string, unknown>).inject) {
      envSpec.inject = (manifest.spec.env as Record<string, unknown>).inject;
    }
  }
  docs.push({
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'Package',
    metadata: { name: manifest.metadata.name },
    spec: {
      ...(manifest.metadata.appId ? { appId: manifest.metadata.appId } : {}),
      version: manifest.spec.version,
      ...(manifest.spec.description ? { description: manifest.spec.description } : {}),
      ...(manifest.spec.icon ? { icon: manifest.spec.icon } : {}),
      ...(manifest.spec.category ? { category: manifest.spec.category } : {}),
      ...(manifest.spec.tags ? { tags: manifest.spec.tags } : {}),
      ...(manifest.spec.capabilities ? { capabilities: manifest.spec.capabilities } : {}),
      ...(Object.keys(envSpec).length > 0 ? { env: envSpec } : manifest.spec.env ? { env: manifest.spec.env } : {}),
      ...(manifest.spec.oauth ? { oauth: manifest.spec.oauth } : {}),
      ...(manifest.spec.takos ? { takos: manifest.spec.takos } : {}),
      ...(manifest.spec.fileHandlers ? { fileHandlers: manifest.spec.fileHandlers } : {}),
    },
  });

  // Resources (shared between old and new format)
  for (const [resourceName, resource] of Object.entries(manifest.spec.resources || {})) {
    docs.push({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'Resource',
      metadata: { name: resourceName },
      spec: {
        type: resource.type,
        ...(resource.binding ? { binding: resource.binding } : {}),
        ...(resource.generate ? { generate: resource.generate } : {}),
        ...(resource.type === 'vectorize' && resource.vectorize ? { vectorize: resource.vectorize } : {}),
        ...(resource.type === 'queue' && resource.queue ? { queue: resource.queue } : {}),
        ...(resource.type === 'analyticsEngine' && resource.analyticsEngine ? { analyticsEngine: resource.analyticsEngine } : {}),
        ...(resource.type === 'workflow' && resource.workflow ? { workflow: resource.workflow } : {}),
        ...(resource.type === 'durableObject' && resource.durableObject ? { durableObject: resource.durableObject } : {}),
        ...(resource.migrations
          ? typeof resource.migrations === 'string'
            ? { migrations: resource.migrations }
            : { migrations: resource.migrations.up, rollbackMigrations: resource.migrations.down }
          : {}),
      },
    });
  }

  emitNewFormatDocs(manifest, buildSources, docs);

  // MCP servers (shared)
  for (const server of manifest.spec.mcpServers || []) {
    docs.push({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'McpServer',
      metadata: { name: server.name },
      spec: {
        endpointRef: server.endpoint || server.route,
        name: server.name,
        transport: server.transport || 'streamable-http',
        ...(server.authSecretRef ? { authSecretRef: server.authSecretRef } : {}),
      },
    });
  }

  return docs;
}

function toManifestDocYaml(doc: BundleDoc): string {
  return YAML.stringify(doc).trimEnd();
}

function toUint8Array(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  return new Uint8Array(content);
}

export async function buildBundlePackageData(
  docs: BundleDoc[],
  files: Map<string, ArrayBuffer | Uint8Array | string>,
): Promise<ArrayBuffer> {
  const manifestYaml = `${docs.map(toManifestDocYaml).join('\n---\n')}\n`;
  const entries = new Map<string, Uint8Array>();
  entries.set('manifest.yaml', new TextEncoder().encode(manifestYaml));

  for (const [filePathRaw, content] of files.entries()) {
    const filePath = normalizeRepoPath(filePathRaw);
    if (!filePath) continue;
    entries.set(filePath, toUint8Array(content));
  }

  const checksums: string[] = [];
  for (const [filePath, content] of entries.entries()) {
    checksums.push(`${await computeSHA256(content)} ${filePath}`);
  }
  entries.set('checksums.txt', new TextEncoder().encode(`${checksums.sort().join('\n')}\n`));

  const jszip = await import('jszip');
  const JSZip = 'default' in jszip ? jszip.default : jszip;
  const zip = new JSZip();
  for (const [filePath, content] of entries.entries()) {
    zip.file(filePath, content);
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

export async function buildParsedPackageFromDocs(
  docs: BundleDoc[],
  files: Map<string, ArrayBuffer | Uint8Array | string>,
): Promise<{ manifestYaml: string; normalizedFiles: Map<string, ArrayBuffer>; checksums: Map<string, string> }> {
  const manifestYaml = `${docs.map(toManifestDocYaml).join('\n---\n')}\n`;
  const normalizedFiles = new Map<string, ArrayBuffer>();
  normalizedFiles.set('manifest.yaml', new TextEncoder().encode(manifestYaml).buffer as ArrayBuffer);

  for (const [filePathRaw, content] of files.entries()) {
    const filePath = normalizeRepoPath(filePathRaw);
    if (!filePath) continue;
    const bytes = toUint8Array(content);
    normalizedFiles.set(filePath, bytes.buffer as ArrayBuffer);
  }

  const checksums = new Map<string, string>();
  for (const [filePath, content] of normalizedFiles.entries()) {
    checksums.set(filePath, await computeSHA256(new Uint8Array(content)));
  }

  return { manifestYaml, normalizedFiles, checksums };
}

export function extractBuildSourcesFromManifestJson(manifestJson: string | null | undefined): AppDeploymentBuildSource[] {
  const manifest = safeJsonParseOrDefault<{ objects?: Array<{ kind?: string; metadata?: { name?: string; labels?: Record<string, string> } }> } | null>(manifestJson, null);
  const objects = Array.isArray(manifest?.objects) ? manifest.objects : [];
  return objects
    .filter((item) => item.kind === 'Workload')
    .map((item) => {
      const labels = item.metadata?.labels || {};
      const workflowPath = labels[BUILD_SOURCE_LABELS.workflowPath];
      const workflowJob = labels[BUILD_SOURCE_LABELS.workflowJob];
      const workflowArtifact = labels[BUILD_SOURCE_LABELS.workflowArtifact];
      const artifactPath = labels[BUILD_SOURCE_LABELS.artifactPath];
      if (!workflowPath || !workflowJob || !workflowArtifact || !artifactPath || !item.metadata?.name) {
        return null;
      }
      return {
        service_name: item.metadata.name,
        workflow_path: workflowPath,
        workflow_job: workflowJob,
        workflow_artifact: workflowArtifact,
        artifact_path: artifactPath,
        ...(labels[BUILD_SOURCE_LABELS.sourceRunId] ? { workflow_run_id: labels[BUILD_SOURCE_LABELS.sourceRunId] } : {}),
        ...(labels[BUILD_SOURCE_LABELS.sourceJobId] ? { workflow_job_id: labels[BUILD_SOURCE_LABELS.sourceJobId] } : {}),
        ...(labels[BUILD_SOURCE_LABELS.sourceSha] ? { source_sha: labels[BUILD_SOURCE_LABELS.sourceSha] } : {}),
      } satisfies AppDeploymentBuildSource;
    })
    .filter((item): item is AppDeploymentBuildSource => item != null)
    .sort((left, right) => left.service_name.localeCompare(right.service_name));
}

export function selectAppManifestPathFromRepo(entries: ReadonlyArray<string>): string | null {
  if (entries.includes('.takos/app.yml')) return '.takos/app.yml';
  if (entries.includes('.takos/app.yaml')) return '.takos/app.yaml';
  return null;
}
