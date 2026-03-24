import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { parseWorkflow, validateWorkflow } from '@takos/actions-engine';

// --- App manifest parsing ---

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

type AppMetadata = {
  name: string;
  appId?: string;
};

type AppResource = {
  type: 'd1' | 'r2' | 'kv' | 'secretRef';
  binding?: string;
  migrations?: string | { up: string; down: string };
};

type WorkerService = {
  type: 'worker';
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
    services?: string[];
  };
};

type HttpService = {
  type: 'http';
  baseUrl: string;
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
    services: Record<string, WorkerService | HttpService>;
    routes?: AppRoute[];
    mcpServers?: AppMcpServer[];
    fileHandlers?: AppFileHandler[];
  };
};

const APP_MANIFEST_FILE_NAMES = [
  path.join('.takos', 'app.yml'),
  path.join('.takos', 'app.yaml'),
];

function asString(value: unknown, field: string, required = false): string | undefined {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  return normalized;
}

function asStringArray(value: unknown, field: string): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of strings`);
  }
  const out = value.map((entry, index) => {
    const normalized = asString(entry, `${field}[${index}]`, true);
    return normalized!;
  });
  return out;
}

/** Spread helper: returns `{ [key]: value }` when value is defined, `{}` otherwise. */
function optionalProp<K extends string, V>(key: K, value: V | undefined): { [P in K]: V } | Record<string, never> {
  if (value === undefined) return {} as Record<string, never>;
  return { [key]: value } as { [P in K]: V };
}

function asStringMap(value: unknown, field: string): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = asString(key, `${field} key`, true)!;
    out[normalizedKey] = String(entry ?? '');
  }
  return out;
}

export async function findAppManifestFile(dir: string): Promise<string | null> {
  for (const relativePath of APP_MANIFEST_FILE_NAMES) {
    const candidate = path.join(dir, relativePath);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

export async function loadAppManifest(manifestPath: string): Promise<AppManifest> {
  const absolutePath = path.resolve(manifestPath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  const parsed = YAML.parse(raw);
  const record = asRecord(parsed);

  const apiVersion = asString(record.apiVersion, 'apiVersion', true);
  const kind = asString(record.kind, 'kind', true);
  if (apiVersion !== 'takos.dev/v1alpha1') {
    throw new Error(`apiVersion must be takos.dev/v1alpha1`);
  }
  if (kind !== 'App') {
    throw new Error(`kind must be App`);
  }

  const metadataRecord = asRecord(record.metadata);
  const specRecord = asRecord(record.spec);
  const metadata: AppMetadata = {
    name: asString(metadataRecord.name, 'metadata.name', true)!,
    ...optionalProp('appId', asString(metadataRecord.appId, 'metadata.appId')),
  };

  const servicesRecord = asRecord(specRecord.services);
  const services: Record<string, WorkerService | HttpService> = {};
  const serviceNames = Object.keys(servicesRecord);
  if (serviceNames.length === 0) {
    throw new Error('spec.services must contain at least one service');
  }

  for (const [serviceName, serviceValue] of Object.entries(servicesRecord)) {
    const serviceSpec = asRecord(serviceValue);
    const type = asString(serviceSpec.type, `spec.services.${serviceName}.type`, true)!;

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
      const workflowPath = asString(fromWorkflow.path, `spec.services.${serviceName}.build.fromWorkflow.path`, true)!;
      if (!workflowPath.startsWith('.takos/workflows/') || workflowPath.includes('..')) {
        throw new Error(`spec.services.${serviceName}.build.fromWorkflow.path must be under .takos/workflows/ and must not contain path traversal`);
      }
      services[serviceName] = {
        type: 'worker',
        build: {
          fromWorkflow: {
            path: workflowPath,
            job: asString(fromWorkflow.job, `spec.services.${serviceName}.build.fromWorkflow.job`, true)!,
            artifact: asString(fromWorkflow.artifact, `spec.services.${serviceName}.build.fromWorkflow.artifact`, true)!,
            artifactPath: asString(fromWorkflow.artifactPath, `spec.services.${serviceName}.build.fromWorkflow.artifactPath`, true)!,
          },
        },
        ...optionalProp('env', asStringMap(serviceSpec.env, `spec.services.${serviceName}.env`)),
        ...(serviceSpec.bindings ? {
          bindings: {
            ...optionalProp('d1', asStringArray(asRecord(serviceSpec.bindings).d1, `spec.services.${serviceName}.bindings.d1`)),
            ...optionalProp('r2', asStringArray(asRecord(serviceSpec.bindings).r2, `spec.services.${serviceName}.bindings.r2`)),
            ...optionalProp('kv', asStringArray(asRecord(serviceSpec.bindings).kv, `spec.services.${serviceName}.bindings.kv`)),
            ...optionalProp('services', asStringArray(asRecord(serviceSpec.bindings).services, `spec.services.${serviceName}.bindings.services`)),
          },
        } : {}),
      };
      continue;
    }

    if (type === 'http') {
      services[serviceName] = {
        type: 'http',
        baseUrl: asString(serviceSpec.baseUrl, `spec.services.${serviceName}.baseUrl`, true)!,
      };
      continue;
    }

    throw new Error(`spec.services.${serviceName}.type must be worker or http`);
  }

  const resourceSpecs = asRecord(specRecord.resources);
  const resources: Record<string, AppResource> = {};
  for (const [resourceName, resourceValue] of Object.entries(resourceSpecs)) {
    const resource = asRecord(resourceValue);
    const type = asString(resource.type, `spec.resources.${resourceName}.type`, true)!;
    if (!['d1', 'r2', 'kv', 'secretRef'].includes(type)) {
      throw new Error(`spec.resources.${resourceName}.type must be d1/r2/kv/secretRef`);
    }
    resources[resourceName] = {
      type: type as AppResource['type'],
      ...optionalProp('binding', asString(resource.binding, `spec.resources.${resourceName}.binding`)),
      ...(resource.migrations
        ? {
            migrations: (() => {
              if (typeof resource.migrations === 'string') {
                return asString(resource.migrations, `spec.resources.${resourceName}.migrations`);
              }
              const migrationSpec = asRecord(resource.migrations);
              return {
                up: asString(migrationSpec.up, `spec.resources.${resourceName}.migrations.up`, true)!,
                down: asString(migrationSpec.down, `spec.resources.${resourceName}.migrations.down`, true)!,
              };
            })(),
          }
        : {}),
    };
  }

  const routesRaw = specRecord.routes;
  const routes: AppRoute[] | undefined = routesRaw == null ? undefined : (() => {
    if (!Array.isArray(routesRaw)) {
      throw new Error('spec.routes must be an array');
    }
    return routesRaw.map((entry, index) => {
      const route = asRecord(entry);
      const service = asString(route.service, `spec.routes[${index}].service`, true)!;
      const ingress = asString(route.ingress, `spec.routes[${index}].ingress`);
      if (!services[service]) {
        throw new Error(`spec.routes[${index}].service references unknown service: ${service}`);
      }
      if (services[service]?.type === 'http' && !ingress) {
        throw new Error(`spec.routes[${index}].ingress is required for http service routes`);
      }
      if (ingress && services[ingress]?.type !== 'worker') {
        throw new Error(`spec.routes[${index}].ingress must reference a worker service`);
      }
      return {
        ...optionalProp('name', asString(route.name, `spec.routes[${index}].name`)),
        service,
        ...optionalProp('path', asString(route.path, `spec.routes[${index}].path`)),
        ...(ingress ? { ingress } : {}),
        ...(route.timeoutMs != null ? { timeoutMs: Number(route.timeoutMs) } : {}),
      };
    });
  })();

  const mcpServersRaw = specRecord.mcpServers;
  const mcpServers: AppMcpServer[] | undefined = mcpServersRaw == null ? undefined : (() => {
    if (!Array.isArray(mcpServersRaw)) {
      throw new Error('spec.mcpServers must be an array');
    }
    return mcpServersRaw.map((entry, index) => {
      const mcp = asRecord(entry);
      const endpoint = asString(mcp.endpoint, `spec.mcpServers[${index}].endpoint`);
      const route = asString(mcp.route, `spec.mcpServers[${index}].route`);
      if (!endpoint && !route) {
        throw new Error(`spec.mcpServers[${index}].endpoint or spec.mcpServers[${index}].route is required`);
      }
      return {
        name: asString(mcp.name, `spec.mcpServers[${index}].name`, true)!,
        ...(endpoint ? { endpoint } : {}),
        ...(route ? { route } : {}),
        ...optionalProp('transport', asString(mcp.transport, `spec.mcpServers[${index}].transport`) as 'streamable-http' | undefined),
      };
    });
  })();

  const fileHandlersRaw = specRecord.fileHandlers;
  const fileHandlers: AppFileHandler[] | undefined = fileHandlersRaw == null ? undefined : (() => {
    if (!Array.isArray(fileHandlersRaw)) {
      throw new Error('spec.fileHandlers must be an array');
    }
    return fileHandlersRaw.map((entry, index) => {
      const handler = asRecord(entry);
      return {
        name: asString(handler.name, `spec.fileHandlers[${index}].name`, true)!,
        ...optionalProp('mimeTypes', asStringArray(handler.mimeTypes, `spec.fileHandlers[${index}].mimeTypes`)),
        ...optionalProp('extensions', asStringArray(handler.extensions, `spec.fileHandlers[${index}].extensions`)),
        openPath: asString(handler.openPath, `spec.fileHandlers[${index}].openPath`, true)!,
      };
    });
  })();

  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'App',
    metadata,
    spec: {
      version: asString(specRecord.version, 'spec.version', true)!,
      ...optionalProp('description', asString(specRecord.description, 'spec.description')),
      ...optionalProp('icon', asString(specRecord.icon, 'spec.icon')),
      ...optionalProp('category', asString(specRecord.category, 'spec.category') as AppManifest['spec']['category'] | undefined),
      ...optionalProp('tags', asStringArray(specRecord.tags, 'spec.tags')),
      ...optionalProp('capabilities', asStringArray(specRecord.capabilities, 'spec.capabilities')),
      ...(specRecord.env ? { env: { ...optionalProp('required', asStringArray(asRecord(specRecord.env).required, 'spec.env.required')) } } : {}),
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

// --- End app manifest parsing ---

export async function resolveAppManifestPath(startDir = process.cwd()): Promise<string> {
  const manifestPath = await findAppManifestFile(startDir);
  if (!manifestPath) {
    throw new Error('No .takos/app.yml found in the current directory');
  }
  return manifestPath;
}

async function validateDeployWorkflowJob(
  repoRoot: string,
  workflowPath: string,
  jobKey: string,
): Promise<void> {
  const normalizedPath = workflowPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (normalizedPath.includes('..')) {
    throw new Error(`Workflow path must not contain path traversal: ${normalizedPath}`);
  }
  const absolutePath = path.resolve(repoRoot, normalizedPath);
  const resolvedRoot = path.resolve(repoRoot);
  if (!absolutePath.startsWith(resolvedRoot + path.sep) && absolutePath !== resolvedRoot) {
    throw new Error(`Workflow path escapes repository root: ${normalizedPath}`);
  }
  const raw = await fs.readFile(absolutePath, 'utf8').catch(() => {
    throw new Error(`Workflow file not found: ${normalizedPath}`);
  });

  const parsed = parseWorkflow(raw);
  const parseErrors = parsed.diagnostics.filter((d) => d.severity === 'error');
  if (parseErrors.length > 0) {
    throw new Error(`Workflow parse error (${normalizedPath}): ${parseErrors.map((entry) => entry.message).join(', ')}`);
  }

  const validation = validateWorkflow(parsed.workflow);
  const validationErrors = validation.diagnostics.filter((d) => d.severity === 'error');
  if (validationErrors.length > 0) {
    throw new Error(`Workflow validation error (${normalizedPath}): ${validationErrors.map((entry) => entry.message).join(', ')}`);
  }

  const job = parsed.workflow.jobs[jobKey];
  if (!job) {
    throw new Error(`Workflow job not found in ${normalizedPath}: ${jobKey}`);
  }
  if (job.needs) {
    throw new Error(`Deploy producer job must not use needs (${normalizedPath}#${jobKey})`);
  }
  if (job.strategy) {
    throw new Error(`Deploy producer job must not use strategy.matrix (${normalizedPath}#${jobKey})`);
  }
  if (job.services) {
    throw new Error(`Deploy producer job must not use services (${normalizedPath}#${jobKey})`);
  }
}

export async function validateAppManifest(startDir = process.cwd()) {
  const manifestPath = await resolveAppManifestPath(startDir);
  const manifest = await loadAppManifest(manifestPath);
  const repoRoot = path.dirname(path.dirname(manifestPath));

  for (const [serviceName, service] of Object.entries(manifest.spec.services)) {
    if (service.type !== 'worker') continue;
    const build = service.build.fromWorkflow;
    if (!build.artifactPath) {
      throw new Error(`spec.services.${serviceName}.build.fromWorkflow.artifactPath is required`);
    }
    await validateDeployWorkflowJob(repoRoot, build.path, build.job);
  }

  return {
    manifestPath,
    manifest,
  };
}
