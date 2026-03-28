import YAML from 'yaml';
import {
  asRecord,
  asString,
  asRequiredString,
  asStringArray,
  asStringMap,
  normalizeRepoPath,
  type AppManifest,
  type AppMetadata,
  type AppRoute,
  type AppMcpServer,
  type AppFileHandler,
  type AppContainer,
  type AppWorker,
  type AppEnvConfig,
} from './app-manifest-types';
import { parseResources, validateResourceBindings } from './app-manifest-validation';
import { validateTemplateReferences } from './app-manifest-template';

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

  if (specRecord.services != null) {
    throw new Error('spec.services is no longer supported. Use spec.containers and spec.workers instead.');
  }

  // --- shared optional fields ---
  const specDescription = asString(specRecord.description, 'spec.description');
  const specIcon = asString(specRecord.icon, 'spec.icon');
  const specCategory = asString(specRecord.category, 'spec.category');
  const specTags = asStringArray(specRecord.tags, 'spec.tags');
  const specCapabilities = asStringArray(specRecord.capabilities, 'spec.capabilities');
  const mcpServers = parseMcpServers(specRecord);
  const fileHandlers = parseFileHandlers(specRecord);

  const containers = parseContainers(specRecord);
  const workers = parseWorkers(specRecord, containers);
  const envConfig = parseEnvConfig(specRecord);
  const routes = parseRoutes(specRecord, workers, containers);

  // Resources — pass a synthesised services map for validation
  const syntheticServices = buildSyntheticServicesFromWorkers(workers);
  const resources = parseResources(specRecord, syntheticServices);
  validateResourceBindings(syntheticServices, resources);

  // Validate env.inject template references
  if (envConfig?.inject) {
    const templateErrors = validateTemplateReferences(envConfig.inject, {
      containers,
      workers,
      routes: routes || [],
      resources,
    });
    if (templateErrors.length > 0) {
      throw new Error(`env.inject template errors: ${templateErrors.join('; ')}`);
    }
  }

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
      ...(envConfig ? { env: envConfig } : {}),
      ...(specRecord.oauth ? { oauth: asRecord(specRecord.oauth) as AppManifest['spec']['oauth'] } : {}),
      ...(specRecord.takos ? { takos: asRecord(specRecord.takos) as AppManifest['spec']['takos'] } : {}),
      ...(Object.keys(resources).length > 0 ? { resources } : {}),
      ...(Object.keys(containers).length > 0 ? { containers } : {}),
      workers,
      ...(routes && routes.length > 0 ? { routes } : {}),
      ...(mcpServers ? { mcpServers } : {}),
      ...(fileHandlers ? { fileHandlers } : {}),
    },
  };
}

export const parseAppManifestText = parseAppManifestYaml;

// ============================================================
// New format parsers: containers, workers, env, routes
// ============================================================

export function parseContainers(specRecord: Record<string, unknown>): Record<string, AppContainer> {
  const containersRecord = asRecord(specRecord.containers);
  const containers: Record<string, AppContainer> = {};
  for (const [name, value] of Object.entries(containersRecord)) {
    const c = asRecord(value);
    const port = Number(c.port);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`spec.containers.${name}.port must be a positive number`);
    }
    containers[name] = {
      dockerfile: normalizeRepoPath(asRequiredString(c.dockerfile, `spec.containers.${name}.dockerfile`)),
      port,
      ...(c.instanceType ? { instanceType: String(c.instanceType) } : {}),
      ...(c.maxInstances ? { maxInstances: Number(c.maxInstances) } : {}),
      ...(c.ipv4 === true ? { ipv4: true } : {}),
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(c.env, `spec.containers.${name}.env`); return v ? { env: v } : {}; })()),
    };
  }
  return containers;
}

export function parseWorkers(
  specRecord: Record<string, unknown>,
  containers: Record<string, AppContainer>,
): Record<string, AppWorker> {
  const workersRecord = asRecord(specRecord.workers);
  const workers: Record<string, AppWorker> = {};
  const workerNames = Object.keys(workersRecord);
  if (workerNames.length === 0) {
    throw new Error('spec.workers must contain at least one worker');
  }

  for (const [workerName, workerValue] of Object.entries(workersRecord)) {
    const workerSpec = asRecord(workerValue);
    const build = parseWorkerBuild(workerName, workerSpec);

    // Validate container references
    let containerRefs: string[] | undefined;
    const containersRaw = workerSpec.containers;
    if (containersRaw != null) {
      if (!Array.isArray(containersRaw)) {
        throw new Error(`spec.workers.${workerName}.containers must be an array of container names`);
      }
      containerRefs = containersRaw.map((entry, i) => {
        const ref = asRequiredString(entry, `spec.workers.${workerName}.containers[${i}]`);
        if (!containers[ref]) {
          throw new Error(`spec.workers.${workerName}.containers[${i}] references unknown container: ${ref}`);
        }
        return ref;
      });
    }

    workers[workerName] = {
      ...(containerRefs && containerRefs.length > 0 ? { containers: containerRefs } : {}),
      build,
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(workerSpec.env, `spec.workers.${workerName}.env`); return v ? { env: v } : {}; })()),
      ...(workerSpec.bindings ? parseWorkerBindings(workerName, workerSpec) : {}),
      ...(workerSpec.triggers ? parseWorkerTriggers(workerName, workerSpec) : {}),
    };
  }

  return workers;
}

export function parseEnvConfig(specRecord: Record<string, unknown>): AppEnvConfig | undefined {
  if (specRecord.env == null) return undefined;
  const envRecord = asRecord(specRecord.env);
  const required = asStringArray(envRecord.required, 'spec.env.required');
  const inject = asStringMap(envRecord.inject, 'spec.env.inject');

  // Validate template syntax in inject values
  if (inject) {
    for (const [key, value] of Object.entries(inject)) {
      // Check for unclosed template braces
      const opens = (value.match(/\{\{/g) || []).length;
      const closes = (value.match(/\}\}/g) || []).length;
      if (opens !== closes) {
        throw new Error(`spec.env.inject.${key} has mismatched template braces`);
      }
    }
  }

  if (!required && !inject) return undefined;

  return {
    ...(required ? { required } : {}),
    ...(inject ? { inject } : {}),
  };
}

function parseRoutes(
  specRecord: Record<string, unknown>,
  workers: Record<string, AppWorker>,
  containers: Record<string, AppContainer>,
): AppRoute[] | undefined {
  const routesRaw = specRecord.routes;
  if (routesRaw == null) return undefined;
  if (!Array.isArray(routesRaw)) throw new Error('spec.routes must be an array');
  return routesRaw.map((entry, index) => {
    const route = asRecord(entry);
    const target = asRequiredString(route.target, `spec.routes[${index}].target`);
    const name = asRequiredString(route.name, `spec.routes[${index}].name`);
    const ingress = asString(route.ingress, `spec.routes[${index}].ingress`);

    if (!workers[target] && !containers[target]) {
      throw new Error(`spec.routes[${index}].target references unknown worker or container: ${target}`);
    }
    if (ingress && !workers[ingress]) {
      throw new Error(`spec.routes[${index}].ingress must reference a worker`);
    }

    const routePath = asString(route.path, `spec.routes[${index}].path`);
    return {
      name,
      target,
      ...(routePath ? { path: routePath } : {}),
      ...(ingress ? { ingress } : {}),
      ...(route.timeoutMs != null ? { timeoutMs: Number(route.timeoutMs) } : {}),
    };
  });
}

// ============================================================
// Internal helpers
// ============================================================

function parseWorkerBuild(workerName: string, workerSpec: Record<string, unknown>) {
  const buildSpec = asRecord(workerSpec.build);
  const fromWorkflow = asRecord(buildSpec.fromWorkflow);
  if (Object.keys(buildSpec).length === 0) {
    throw new Error(`spec.workers.${workerName}.build is required`);
  }
  if (buildSpec.command != null || buildSpec.output != null || buildSpec.cwd != null || workerSpec.entry != null) {
    throw new Error(`spec.workers.${workerName} local build fields are not supported; use build.fromWorkflow`);
  }
  if (Object.keys(fromWorkflow).length === 0) {
    throw new Error(`spec.workers.${workerName}.build.fromWorkflow is required`);
  }
  const workflowPath = normalizeRepoPath(asRequiredString(fromWorkflow.path, `spec.workers.${workerName}.build.fromWorkflow.path`));
  if (!workflowPath.startsWith('.takos/workflows/')) {
    throw new Error(`spec.workers.${workerName}.build.fromWorkflow.path must be under .takos/workflows/`);
  }
  return {
    fromWorkflow: {
      path: workflowPath,
      job: asRequiredString(fromWorkflow.job, `spec.workers.${workerName}.build.fromWorkflow.job`),
      artifact: asRequiredString(fromWorkflow.artifact, `spec.workers.${workerName}.build.fromWorkflow.artifact`),
      artifactPath: normalizeRepoPath(asRequiredString(fromWorkflow.artifactPath, `spec.workers.${workerName}.build.fromWorkflow.artifactPath`)),
    },
  };
}

function parseWorkerBindings(workerName: string, workerSpec: Record<string, unknown>): { bindings: AppWorker['bindings'] } {
  const bindingsRecord = asRecord(workerSpec.bindings);
  const d1 = asStringArray(bindingsRecord.d1, `spec.workers.${workerName}.bindings.d1`);
  const r2 = asStringArray(bindingsRecord.r2, `spec.workers.${workerName}.bindings.r2`);
  const kv = asStringArray(bindingsRecord.kv, `spec.workers.${workerName}.bindings.kv`);
  const vectorize = asStringArray(bindingsRecord.vectorize, `spec.workers.${workerName}.bindings.vectorize`);
  const queues = asStringArray(bindingsRecord.queues, `spec.workers.${workerName}.bindings.queues`);
  const analytics = asStringArray(bindingsRecord.analytics, `spec.workers.${workerName}.bindings.analytics`);
  const workflows = asStringArray(bindingsRecord.workflows, `spec.workers.${workerName}.bindings.workflows`);
  const durableObjectsArr = asStringArray(bindingsRecord.durableObjects, `spec.workers.${workerName}.bindings.durableObjects`);
  const svc = asStringArray(bindingsRecord.services, `spec.workers.${workerName}.bindings.services`);
  return {
    bindings: {
      ...(d1 ? { d1 } : {}),
      ...(r2 ? { r2 } : {}),
      ...(kv ? { kv } : {}),
      ...(vectorize ? { vectorize } : {}),
      ...(queues ? { queues } : {}),
      ...(analytics ? { analytics } : {}),
      ...(workflows ? { workflows } : {}),
      ...(durableObjectsArr ? { durableObjects: durableObjectsArr } : {}),
      ...(svc ? { services: svc } : {}),
    },
  };
}

function parseWorkerTriggers(workerName: string, workerSpec: Record<string, unknown>): { triggers: AppWorker['triggers'] } {
  const triggersRecord = asRecord(workerSpec.triggers);
  const schedulesRaw = triggersRecord.schedules;
  const queuesRaw = triggersRecord.queues;
  const schedules = schedulesRaw == null ? undefined : (() => {
    if (!Array.isArray(schedulesRaw)) {
      throw new Error(`spec.workers.${workerName}.triggers.schedules must be an array`);
    }
    return schedulesRaw.map((entry, index) => {
      const record = asRecord(entry);
      return {
        cron: asRequiredString(record.cron, `spec.workers.${workerName}.triggers.schedules[${index}].cron`),
        export: asRequiredString(record.export, `spec.workers.${workerName}.triggers.schedules[${index}].export`),
      };
    });
  })();
  const queues = queuesRaw == null ? undefined : (() => {
    if (!Array.isArray(queuesRaw)) {
      throw new Error(`spec.workers.${workerName}.triggers.queues must be an array`);
    }
    return queuesRaw.map((entry, index) => {
      const record = asRecord(entry);
      return {
        queue: asRequiredString(record.queue, `spec.workers.${workerName}.triggers.queues[${index}].queue`),
        export: asRequiredString(record.export, `spec.workers.${workerName}.triggers.queues[${index}].export`),
      };
    });
  })();
  return {
    triggers: {
      ...(schedules ? { schedules } : {}),
      ...(queues ? { queues } : {}),
    },
  };
}

/**
 * Build a synthetic service map from workers so that
 * `parseResources` / `validateResourceBindings` can work.
 */
function buildSyntheticServicesFromWorkers(
  workers: Record<string, AppWorker>,
): Record<string, { type: 'worker'; bindings?: AppWorker['bindings']; triggers?: AppWorker['triggers'] }> {
  const services: Record<string, { type: 'worker'; bindings?: AppWorker['bindings']; triggers?: AppWorker['triggers'] }> = {};
  for (const [name, worker] of Object.entries(workers)) {
    services[name] = {
      type: 'worker',
      ...(worker.bindings ? { bindings: worker.bindings } : {}),
      ...(worker.triggers ? { triggers: worker.triggers } : {}),
    };
  }
  return services;
}

function parseMcpServers(specRecord: Record<string, unknown>): AppMcpServer[] | undefined {
  const mcpServersRaw = specRecord.mcpServers;
  if (mcpServersRaw == null) return undefined;
  if (!Array.isArray(mcpServersRaw)) throw new Error('spec.mcpServers must be an array');
  return mcpServersRaw.map((entry, index) => {
    const server = asRecord(entry);
    const endpoint = asString(server.endpoint, `spec.mcpServers[${index}].endpoint`);
    const route = asString(server.route, `spec.mcpServers[${index}].route`);
    if (!endpoint && !route) {
      throw new Error(`spec.mcpServers[${index}].endpoint or spec.mcpServers[${index}].route is required`);
    }
    const authSecretRef = asString(server.authSecretRef, `spec.mcpServers[${index}].authSecretRef`);
    return {
      name: asRequiredString(server.name, `spec.mcpServers[${index}].name`),
      ...(endpoint ? { endpoint } : {}),
      ...(route ? { route } : {}),
      ...((() => { const v = asString(server.transport, `spec.mcpServers[${index}].transport`); return v ? { transport: v as 'streamable-http' } : {}; })()),
      ...(authSecretRef ? { authSecretRef } : {}),
    };
  });
}

function parseFileHandlers(specRecord: Record<string, unknown>): AppFileHandler[] | undefined {
  const fileHandlersRaw = specRecord.fileHandlers;
  if (fileHandlersRaw == null) return undefined;
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
}
