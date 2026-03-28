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
  type AppService,
  type WorkerService,
  type ContainerService,
} from './app-manifest-types';
import { parseResources, validateResourceBindings } from './app-manifest-validation';

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

  const services = parseServices(specRecord);
  const resources = parseResources(specRecord, services);
  validateResourceBindings(services, resources);

  const routes = parseRoutes(specRecord, services);
  const mcpServers = parseMcpServers(specRecord);
  const fileHandlers = parseFileHandlers(specRecord);

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

// --- internal parsing helpers ---

function parseServices(specRecord: Record<string, unknown>): Record<string, AppService> {
  const servicesRecord = asRecord(specRecord.services);
  const services: Record<string, AppService> = {};
  const serviceNames = Object.keys(servicesRecord);
  if (serviceNames.length === 0) {
    throw new Error('spec.services must contain at least one service');
  }

  for (const [serviceName, serviceValue] of Object.entries(servicesRecord)) {
    const serviceSpec = asRecord(serviceValue);
    const type = asRequiredString(serviceSpec.type, `spec.services.${serviceName}.type`);

    if (type === 'worker') {
      services[serviceName] = parseWorkerService(serviceName, serviceSpec);
      continue;
    }

    if (type === 'container') {
      services[serviceName] = parseContainerService(serviceName, serviceSpec);
      continue;
    }

    throw new Error(`spec.services.${serviceName}.type must be worker or container`);
  }

  return services;
}

function parseWorkerService(serviceName: string, serviceSpec: Record<string, unknown>): WorkerService {
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

  return {
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
    ...(serviceSpec.bindings ? parseServiceBindings(serviceName, serviceSpec) : {}),
    ...(serviceSpec.triggers ? parseServiceTriggers(serviceName, serviceSpec) : {}),
  };
}

function parseContainerService(serviceName: string, serviceSpec: Record<string, unknown>): ContainerService {
  const containerSpec = asRecord(serviceSpec.container);
  if (Object.keys(containerSpec).length === 0) {
    throw new Error(`spec.services.${serviceName}.container is required for container type`);
  }
  const dockerfile = asRequiredString(containerSpec.dockerfile, `spec.services.${serviceName}.container.dockerfile`);
  const port = Number(containerSpec.port);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`spec.services.${serviceName}.container.port must be a positive number`);
  }
  return {
    type: 'container',
    container: {
      dockerfile: normalizeRepoPath(dockerfile),
      port,
      ...(containerSpec.instanceType ? { instanceType: String(containerSpec.instanceType) } : {}),
      ...(containerSpec.maxInstances ? { maxInstances: Number(containerSpec.maxInstances) } : {}),
    },
    ...((() => { const v = asStringMap(serviceSpec.env, `spec.services.${serviceName}.env`); return v ? { env: v } : {}; })()),
  };
}

function parseServiceBindings(serviceName: string, serviceSpec: Record<string, unknown>): { bindings: WorkerService['bindings'] } {
  const bindingsRecord = asRecord(serviceSpec.bindings);
  const d1 = asStringArray(bindingsRecord.d1, `spec.services.${serviceName}.bindings.d1`);
  const r2 = asStringArray(bindingsRecord.r2, `spec.services.${serviceName}.bindings.r2`);
  const kv = asStringArray(bindingsRecord.kv, `spec.services.${serviceName}.bindings.kv`);
  const vectorize = asStringArray(bindingsRecord.vectorize, `spec.services.${serviceName}.bindings.vectorize`);
  const queues = asStringArray(bindingsRecord.queues, `spec.services.${serviceName}.bindings.queues`);
  const analytics = asStringArray(bindingsRecord.analytics, `spec.services.${serviceName}.bindings.analytics`);
  const workflows = asStringArray(bindingsRecord.workflows, `spec.services.${serviceName}.bindings.workflows`);
  const durableObjectsArr = asStringArray(bindingsRecord.durableObjects, `spec.services.${serviceName}.bindings.durableObjects`);
  const svc = asStringArray(bindingsRecord.services, `spec.services.${serviceName}.bindings.services`);
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

function parseServiceTriggers(serviceName: string, serviceSpec: Record<string, unknown>): { triggers: WorkerService['triggers'] } {
  const triggersRecord = asRecord(serviceSpec.triggers);
  const schedulesRaw = triggersRecord.schedules;
  const queuesRaw = triggersRecord.queues;
  const schedules = schedulesRaw == null ? undefined : (() => {
    if (!Array.isArray(schedulesRaw)) {
      throw new Error(`spec.services.${serviceName}.triggers.schedules must be an array`);
    }
    return schedulesRaw.map((entry, index) => {
      const record = asRecord(entry);
      return {
        cron: asRequiredString(record.cron, `spec.services.${serviceName}.triggers.schedules[${index}].cron`),
        export: asRequiredString(record.export, `spec.services.${serviceName}.triggers.schedules[${index}].export`),
      };
    });
  })();
  const queues = queuesRaw == null ? undefined : (() => {
    if (!Array.isArray(queuesRaw)) {
      throw new Error(`spec.services.${serviceName}.triggers.queues must be an array`);
    }
    return queuesRaw.map((entry, index) => {
      const record = asRecord(entry);
      return {
        queue: asRequiredString(record.queue, `spec.services.${serviceName}.triggers.queues[${index}].queue`),
        export: asRequiredString(record.export, `spec.services.${serviceName}.triggers.queues[${index}].export`),
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

function parseRoutes(
  specRecord: Record<string, unknown>,
  services: Record<string, AppService>,
): AppRoute[] | undefined {
  const routesRaw = specRecord.routes;
  if (routesRaw == null) return undefined;
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
