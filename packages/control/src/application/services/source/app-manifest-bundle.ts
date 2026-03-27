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

export function appManifestToBundleDocs(
  manifest: AppManifest,
  buildSources: Map<string, AppDeploymentBuildSource>,
): BundleDoc[] {
  const docs: BundleDoc[] = [];

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
      ...(manifest.spec.env ? { env: manifest.spec.env } : {}),
      ...(manifest.spec.oauth ? { oauth: manifest.spec.oauth } : {}),
      ...(manifest.spec.takos ? { takos: manifest.spec.takos } : {}),
      ...(manifest.spec.fileHandlers ? { fileHandlers: manifest.spec.fileHandlers } : {}),
    },
  });

  for (const [resourceName, resource] of Object.entries(manifest.spec.resources || {})) {
    docs.push({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'Resource',
      metadata: { name: resourceName },
      spec: {
        type: resource.type,
        ...(resource.binding ? { binding: resource.binding } : {}),
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

  for (const [serviceName, service] of Object.entries(manifest.spec.services)) {
    const source = buildSources.get(serviceName);
    if (!source) {
      throw new Error(`Build source is missing for worker service: ${serviceName}`);
    }
    docs.push({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'Workload',
      metadata: {
        name: serviceName,
        labels: buildSourceLabels(source),
      },
      spec: {
        type: 'cloudflare.worker',
        artifactRef: source.artifact_path,
        pluginConfig: {
          env: service.env || {},
          bindings: {
            services: service.bindings?.services || [],
          },
          ...(service.triggers ? { triggers: service.triggers } : {}),
        },
      },
    });
  }

  for (const [resourceName, resource] of Object.entries(manifest.spec.resources || {})) {
    if (!resource.binding) continue;
    for (const [serviceName, service] of Object.entries(manifest.spec.services)) {
      if (service.type !== 'worker') continue;
      const bindingLists = service.bindings || {};
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
        metadata: { name: `${resourceName}-to-${serviceName}` },
        spec: {
          from: resourceName,
          to: serviceName,
          mount: {
            as: resource.binding,
            type: mountType,
          },
        },
      });
    }
  }

  for (const [index, route] of (manifest.spec.routes || []).entries()) {
    docs.push({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'Endpoint',
      metadata: { name: route.name || `route-${index + 1}` },
      spec: {
        protocol: 'http',
        targetRef: route.service,
        ...(route.ingress ? { ingressRef: route.ingress } : {}),
        ...(route.path ? { path: route.path } : {}),
        ...(route.timeoutMs != null ? { timeoutMs: route.timeoutMs } : {}),
      },
    });
  }

  for (const server of manifest.spec.mcpServers || []) {
    docs.push({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'McpServer',
      metadata: { name: server.name },
      spec: {
        endpointRef: server.endpoint || server.route,
        name: server.name,
        transport: server.transport || 'streamable-http',
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
