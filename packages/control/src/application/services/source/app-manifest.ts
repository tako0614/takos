import YAML from 'yaml';
import { parseWorkflow, validateWorkflow, type Workflow, type WorkflowDiagnostic } from '@takos/actions-engine';
import { computeSHA256 } from '../../../shared/utils/hash';
import { safeJsonParseOrDefault } from '../../../shared/utils';

type AppMetadata = {
  name: string;
  appId?: string;
};

type AppResource = {
  type: 'd1' | 'r2' | 'kv' | 'secretRef' | 'vectorize';
  binding?: string;
  migrations?: string | { up: string; down: string };
  vectorize?: {
    dimensions: number;
    metric: 'cosine' | 'euclidean' | 'dot-product';
  };
};

type WorkflowArtifactBuild = {
  fromWorkflow: {
    path: string;
    job: string;
    artifact: string;
    artifactPath: string;
  };
};

type WorkerService = {
  type: 'worker';
  build: WorkflowArtifactBuild;
  env?: Record<string, string>;
  bindings?: {
    d1?: string[];
    r2?: string[];
    kv?: string[];
    vectorize?: string[];
    services?: string[];
  };
};

type AppRoute = {
  name?: string;
  service: string;
  path?: string;
  ingress?: string;
  timeoutMs?: number;
};

type AppMcpServer = {
  name: string;
  endpoint?: string;
  route?: string;
  transport?: 'streamable-http';
};

type AppFileHandler = {
  name: string;
  mimeTypes?: string[];
  extensions?: string[];
  openPath: string;
};

export type AppManifest = {
  apiVersion: 'takos.dev/v1alpha1';
  kind: 'App';
  metadata: AppMetadata;
  spec: {
    version: string;
    description?: string;
    icon?: string;
    category?: 'app' | 'service' | 'library' | 'template' | 'social';
    tags?: string[];
    capabilities?: string[];
    env?: {
      required?: string[];
    };
    oauth?: {
      clientName: string;
      redirectUris: string[];
      scopes: string[];
      autoEnv?: boolean;
      metadata?: { logoUri?: string; tosUri?: string; policyUri?: string };
    };
    takos?: {
      scopes: string[];
    };
    resources?: Record<string, AppResource>;
    services: Record<string, WorkerService>;
    routes?: AppRoute[];
    mcpServers?: AppMcpServer[];
    fileHandlers?: AppFileHandler[];
  };
};

export type AppDeploymentBuildSource = {
  service_name: string;
  workflow_path: string;
  workflow_job: string;
  workflow_artifact: string;
  artifact_path: string;
  workflow_run_id?: string;
  workflow_job_id?: string;
  source_sha?: string;
};

type BundleDoc = {
  apiVersion: 'takos.dev/v1alpha1';
  kind: 'Package' | 'Resource' | 'Workload' | 'Endpoint' | 'Binding' | 'McpServer';
  metadata: {
    name: string;
    labels?: Record<string, string>;
  };
  spec: Record<string, unknown>;
};

const BUILD_SOURCE_LABELS = {
  workflowPath: 'takos.dev/workflow-path',
  workflowJob: 'takos.dev/workflow-job',
  workflowArtifact: 'takos.dev/workflow-artifact',
  artifactPath: 'takos.dev/artifact-path',
  sourceRunId: 'takos.dev/workflow-run-id',
  sourceJobId: 'takos.dev/workflow-job-id',
  sourceSha: 'takos.dev/source-sha',
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string | undefined {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

function asRequiredString(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function asStringArray(value: unknown, field: string): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((entry, index) => asRequiredString(entry, `${field}[${index}]`));
}

function asStringMap(value: unknown, field: string): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[asRequiredString(key, `${field} key`)] = String(entry ?? '');
  }
  return out;
}

function normalizeRepoPath(path: string): string {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();
}

function filterWorkflowErrors(diagnostics: WorkflowDiagnostic[]): WorkflowDiagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
}

export function parseAppManifestYaml(raw: string): AppManifest {
  const parsed = YAML.parse(raw);
  const record = asRecord(parsed);

  const apiVersion = asRequiredString(record.apiVersion, 'apiVersion');
  const kind = asRequiredString(record.kind, 'kind');
  if (apiVersion !== 'takos.dev/v1alpha1') {
    throw new Error('apiVersion must be takos.dev/v1alpha1');
  }
  if (kind !== 'App') {
    throw new Error('kind must be App');
  }

  const metadataRecord = asRecord(record.metadata);
  const specRecord = asRecord(record.spec);
  const metadataAppId = asString(metadataRecord.appId, 'metadata.appId');
  const metadata: AppMetadata = {
    name: asRequiredString(metadataRecord.name, 'metadata.name'),
    ...(metadataAppId ? { appId: metadataAppId } : {}),
  };

  const servicesRecord = asRecord(specRecord.services);
  const services: Record<string, WorkerService> = {};
  const serviceNames = Object.keys(servicesRecord);
  if (serviceNames.length === 0) {
    throw new Error('spec.services must contain at least one service');
  }

  for (const [serviceName, serviceValue] of Object.entries(servicesRecord)) {
    const serviceSpec = asRecord(serviceValue);
    const type = asRequiredString(serviceSpec.type, `spec.services.${serviceName}.type`);

    if (type === 'worker') {
      const buildSpec = asRecord(serviceSpec.build);
      const fromWorkflow = asRecord(buildSpec.fromWorkflow);
      if (Object.keys(buildSpec).length === 0) {
        throw new Error(`spec.services.${serviceName}.build is required`);
      }
      if (buildSpec.command != null || buildSpec.output != null || buildSpec.cwd != null || serviceSpec.entry != null) {
        throw new Error(`spec.services.${serviceName} local build fields are not supported; use build.fromWorkflow`);
      }
      if (Object.keys(fromWorkflow).length === 0) {
        throw new Error(`spec.services.${serviceName}.build.fromWorkflow is required`);
      }
      const workflowPath = normalizeRepoPath(asRequiredString(fromWorkflow.path, `spec.services.${serviceName}.build.fromWorkflow.path`));
      if (!workflowPath.startsWith('.takos/workflows/')) {
        throw new Error(`spec.services.${serviceName}.build.fromWorkflow.path must be under .takos/workflows/`);
      }
      services[serviceName] = {
        type: 'worker',
        build: {
          fromWorkflow: {
            path: workflowPath,
            job: asRequiredString(fromWorkflow.job, `spec.services.${serviceName}.build.fromWorkflow.job`),
            artifact: asRequiredString(fromWorkflow.artifact, `spec.services.${serviceName}.build.fromWorkflow.artifact`),
            artifactPath: normalizeRepoPath(asRequiredString(fromWorkflow.artifactPath, `spec.services.${serviceName}.build.fromWorkflow.artifactPath`)),
          },
        },
        ...((() => { const v = asStringMap(serviceSpec.env, `spec.services.${serviceName}.env`); return v ? { env: v } : {}; })()),
        ...(serviceSpec.bindings ? (() => {
          const bindingsRecord = asRecord(serviceSpec.bindings);
          const d1 = asStringArray(bindingsRecord.d1, `spec.services.${serviceName}.bindings.d1`);
          const r2 = asStringArray(bindingsRecord.r2, `spec.services.${serviceName}.bindings.r2`);
          const kv = asStringArray(bindingsRecord.kv, `spec.services.${serviceName}.bindings.kv`);
          const vectorize = asStringArray(bindingsRecord.vectorize, `spec.services.${serviceName}.bindings.vectorize`);
          const svc = asStringArray(bindingsRecord.services, `spec.services.${serviceName}.bindings.services`);
          return {
            bindings: {
              ...(d1 ? { d1 } : {}),
              ...(r2 ? { r2 } : {}),
              ...(kv ? { kv } : {}),
              ...(vectorize ? { vectorize } : {}),
              ...(svc ? { services: svc } : {}),
            },
          };
        })() : {}),
      };
      continue;
    }

    throw new Error(`spec.services.${serviceName}.type must be worker`);
  }

  const resourcesRecord = asRecord(specRecord.resources);
  const resources: Record<string, AppResource> = {};
  for (const [resourceName, resourceValue] of Object.entries(resourcesRecord)) {
    const resource = asRecord(resourceValue);
    const type = asRequiredString(resource.type, `spec.resources.${resourceName}.type`);
    if (!['d1', 'r2', 'kv', 'secretRef', 'vectorize'].includes(type)) {
      throw new Error(`spec.resources.${resourceName}.type must be d1/r2/kv/secretRef/vectorize`);
    }
    resources[resourceName] = {
      type: type as AppResource['type'],
      ...((() => { const v = asString(resource.binding, `spec.resources.${resourceName}.binding`); return v ? { binding: v } : {}; })()),
      ...(resource.migrations
        ? {
            migrations: typeof resource.migrations === 'string'
              ? normalizeRepoPath(asRequiredString(resource.migrations, `spec.resources.${resourceName}.migrations`))
              : {
                  up: normalizeRepoPath(asRequiredString(asRecord(resource.migrations).up, `spec.resources.${resourceName}.migrations.up`)),
                  down: normalizeRepoPath(asRequiredString(asRecord(resource.migrations).down, `spec.resources.${resourceName}.migrations.down`)),
                },
          }
        : {}),
      ...(type === 'vectorize'
        ? {
            vectorize: {
              dimensions: Number(asRecord(resource.vectorize).dimensions ?? 1536),
              metric: ((() => {
                const metric = String(asRecord(resource.vectorize).metric ?? 'cosine').trim();
                if (!['cosine', 'euclidean', 'dot-product'].includes(metric)) {
                  throw new Error(`spec.resources.${resourceName}.vectorize.metric must be cosine/euclidean/dot-product`);
                }
                return metric as 'cosine' | 'euclidean' | 'dot-product';
              })()),
            },
          }
        : {}),
    };
  }

  const routesRaw = specRecord.routes;
  const routes: AppRoute[] | undefined = routesRaw == null ? undefined : (() => {
    if (!Array.isArray(routesRaw)) throw new Error('spec.routes must be an array');
    return routesRaw.map((entry, index) => {
      const route = asRecord(entry);
      const service = asRequiredString(route.service, `spec.routes[${index}].service`);
      const ingress = asString(route.ingress, `spec.routes[${index}].ingress`);
      if (!services[service]) {
        throw new Error(`spec.routes[${index}].service references unknown service: ${service}`);
      }
      if (ingress && services[ingress]?.type !== 'worker') {
        throw new Error(`spec.routes[${index}].ingress must reference a worker service`);
      }
      const routeName = asString(route.name, `spec.routes[${index}].name`);
      const routePath = asString(route.path, `spec.routes[${index}].path`);
      return {
        ...(routeName ? { name: routeName } : {}),
        service,
        ...(routePath ? { path: routePath } : {}),
        ...(ingress ? { ingress } : {}),
        ...(route.timeoutMs != null ? { timeoutMs: Number(route.timeoutMs) } : {}),
      };
    });
  })();

  const mcpServersRaw = specRecord.mcpServers;
  const mcpServers: AppMcpServer[] | undefined = mcpServersRaw == null ? undefined : (() => {
    if (!Array.isArray(mcpServersRaw)) throw new Error('spec.mcpServers must be an array');
    return mcpServersRaw.map((entry, index) => {
      const server = asRecord(entry);
      const endpoint = asString(server.endpoint, `spec.mcpServers[${index}].endpoint`);
      const route = asString(server.route, `spec.mcpServers[${index}].route`);
      if (!endpoint && !route) {
        throw new Error(`spec.mcpServers[${index}].endpoint or spec.mcpServers[${index}].route is required`);
      }
      return {
        name: asRequiredString(server.name, `spec.mcpServers[${index}].name`),
        ...(endpoint ? { endpoint } : {}),
        ...(route ? { route } : {}),
        ...((() => { const v = asString(server.transport, `spec.mcpServers[${index}].transport`); return v ? { transport: v as 'streamable-http' } : {}; })()),
      };
    });
  })();

  const fileHandlersRaw = specRecord.fileHandlers;
  const fileHandlers: AppFileHandler[] | undefined = fileHandlersRaw == null ? undefined : (() => {
    if (!Array.isArray(fileHandlersRaw)) throw new Error('spec.fileHandlers must be an array');
    return fileHandlersRaw.map((entry, index) => {
      const handler = asRecord(entry);
      return {
        name: asRequiredString(handler.name, `spec.fileHandlers[${index}].name`),
        ...((() => { const v = asStringArray(handler.mimeTypes, `spec.fileHandlers[${index}].mimeTypes`); return v ? { mimeTypes: v } : {}; })()),
        ...((() => { const v = asStringArray(handler.extensions, `spec.fileHandlers[${index}].extensions`); return v ? { extensions: v } : {}; })()),
        openPath: asRequiredString(handler.openPath, `spec.fileHandlers[${index}].openPath`),
      };
    });
  })();

  const specDescription = asString(specRecord.description, 'spec.description');
  const specIcon = asString(specRecord.icon, 'spec.icon');
  const specCategory = asString(specRecord.category, 'spec.category');
  const specTags = asStringArray(specRecord.tags, 'spec.tags');
  const specCapabilities = asStringArray(specRecord.capabilities, 'spec.capabilities');
  const specEnvRequired = specRecord.env ? asStringArray(asRecord(specRecord.env).required, 'spec.env.required') : undefined;

  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'App',
    metadata,
    spec: {
      version: asRequiredString(specRecord.version, 'spec.version'),
      ...(specDescription ? { description: specDescription } : {}),
      ...(specIcon ? { icon: specIcon } : {}),
      ...(specCategory ? { category: specCategory as AppManifest['spec']['category'] } : {}),
      ...(specTags ? { tags: specTags } : {}),
      ...(specCapabilities ? { capabilities: specCapabilities } : {}),
      ...(specRecord.env ? { env: { ...(specEnvRequired ? { required: specEnvRequired } : {}) } } : {}),
      ...(specRecord.oauth ? { oauth: asRecord(specRecord.oauth) as AppManifest['spec']['oauth'] } : {}),
      ...(specRecord.takos ? { takos: asRecord(specRecord.takos) as AppManifest['spec']['takos'] } : {}),
      ...(Object.keys(resources).length > 0 ? { resources } : {}),
      services,
      ...(routes ? { routes } : {}),
      ...(mcpServers ? { mcpServers } : {}),
      ...(fileHandlers ? { fileHandlers } : {}),
    },
  };
}

export const parseAppManifestText = parseAppManifestYaml;

export function parseAndValidateWorkflowYaml(raw: string, workflowPath: string): Workflow {
  const { workflow, diagnostics } = parseWorkflow(raw);
  const parseErrors = filterWorkflowErrors(diagnostics);
  if (parseErrors.length > 0) {
    throw new Error(`Workflow parse error (${workflowPath}): ${parseErrors.map((entry) => entry.message).join(', ')}`);
  }

  const validation = validateWorkflow(workflow);
  const validationErrors = filterWorkflowErrors(validation.diagnostics);
  if (validationErrors.length > 0) {
    throw new Error(`Workflow validation error (${workflowPath}): ${validationErrors.map((entry) => entry.message).join(', ')}`);
  }

  return workflow;
}

export function validateDeployProducerJob(workflow: Workflow, workflowPath: string, jobKey: string): void {
  const job = workflow.jobs[jobKey];
  if (!job) {
    throw new Error(`Workflow job not found in ${workflowPath}: ${jobKey}`);
  }
  if (job.needs) {
    throw new Error(`Deploy producer job must not use needs (${workflowPath}#${jobKey})`);
  }
  if (job.strategy) {
    throw new Error(`Deploy producer job must not use strategy.matrix (${workflowPath}#${jobKey})`);
  }
  if (job.services) {
    throw new Error(`Deploy producer job must not use services (${workflowPath}#${jobKey})`);
  }
}

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

export const appManifestToTakopackObjects = appManifestToBundleDocs;

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
