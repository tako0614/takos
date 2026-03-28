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
  type AppService,
  type AppWorker,
  type AppEnvConfig,
  type HealthCheck,
  type LifecycleHooks,
  type LifecycleHook,
  type UpdateStrategy,
  type ServiceBinding,
  type EnvironmentOverrides,
  type WorkerScaling,
  type Volume,
} from './app-manifest-types';
import { parseResources, validateResourceBindings } from './app-manifest-validation';
import { validateTemplateReferences } from './app-manifest-template';

// ============================================================
// Semver validation
// ============================================================

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/;

function validateSemver(version: string): void {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`spec.version must be valid semver (got "${version}")`);
  }
}

// ============================================================
// Health check parser
// ============================================================

function parseHealthCheck(raw: unknown, prefix: string): HealthCheck | undefined {
  if (!raw) return undefined;
  const record = asRecord(raw);
  const type = asString(record.type, `${prefix}.healthCheck.type`);
  if (type && !['http', 'tcp', 'exec'].includes(type)) {
    throw new Error(`${prefix}.healthCheck.type must be http, tcp, or exec`);
  }
  return {
    ...(type ? { type: type as 'http' | 'tcp' | 'exec' } : {}),
    ...(record.path ? { path: String(record.path) } : {}),
    ...(record.port != null ? { port: Number(record.port) } : {}),
    ...(record.command ? { command: String(record.command) } : {}),
    ...(record.intervalSeconds != null ? { intervalSeconds: Number(record.intervalSeconds) } : {}),
    ...(record.timeoutSeconds != null ? { timeoutSeconds: Number(record.timeoutSeconds) } : {}),
    ...(record.unhealthyThreshold != null ? { unhealthyThreshold: Number(record.unhealthyThreshold) } : {}),
  };
}

// ============================================================
// Lifecycle hooks parser
// ============================================================

function parseLifecycle(specRecord: Record<string, unknown>): LifecycleHooks | undefined {
  const raw = specRecord.lifecycle;
  if (!raw) return undefined;
  const record = asRecord(raw);
  const parseHook = (hookRaw: unknown, name: string): LifecycleHook | undefined => {
    if (!hookRaw) return undefined;
    const hook = asRecord(hookRaw);
    return {
      command: asRequiredString(hook.command, `spec.lifecycle.${name}.command`),
      ...(hook.timeoutSeconds != null ? { timeoutSeconds: Number(hook.timeoutSeconds) } : {}),
      ...(hook.sandbox != null ? { sandbox: Boolean(hook.sandbox) } : {}),
    };
  };
  return {
    ...(record.preApply ? { preApply: parseHook(record.preApply, 'preApply') } : {}),
    ...(record.postApply ? { postApply: parseHook(record.postApply, 'postApply') } : {}),
  };
}

// ============================================================
// Update strategy parser
// ============================================================

function parseUpdateStrategy(specRecord: Record<string, unknown>): UpdateStrategy | undefined {
  const raw = specRecord.update;
  if (!raw) return undefined;
  const record = asRecord(raw);
  const strategy = asString(record.strategy, 'spec.update.strategy');
  if (strategy && !['rolling', 'canary', 'blue-green', 'recreate'].includes(strategy)) {
    throw new Error('spec.update.strategy must be rolling, canary, blue-green, or recreate');
  }
  return {
    ...(strategy ? { strategy: strategy as UpdateStrategy['strategy'] } : {}),
    ...(record.canaryWeight != null ? { canaryWeight: Number(record.canaryWeight) } : {}),
    ...(record.healthCheck ? { healthCheck: String(record.healthCheck) } : {}),
    ...(record.rollbackOnFailure != null ? { rollbackOnFailure: Boolean(record.rollbackOnFailure) } : {}),
    ...(record.timeoutSeconds != null ? { timeoutSeconds: Number(record.timeoutSeconds) } : {}),
  };
}

// ============================================================
// Volume parser
// ============================================================

function parseVolumes(raw: unknown, prefix: string): Volume[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;
  return raw.map((entry, i) => {
    const v = asRecord(entry);
    return {
      name: asRequiredString(v.name, `${prefix}.volumes[${i}].name`),
      mountPath: asRequiredString(v.mountPath, `${prefix}.volumes[${i}].mountPath`),
      size: asRequiredString(v.size, `${prefix}.volumes[${i}].size`),
    };
  });
}

// ============================================================
// Worker scaling parser
// ============================================================

function parseScaling(raw: unknown, _prefix: string): WorkerScaling | undefined {
  if (!raw) return undefined;
  const record = asRecord(raw);
  return {
    ...(record.minInstances != null ? { minInstances: Number(record.minInstances) } : {}),
    ...(record.maxConcurrency != null ? { maxConcurrency: Number(record.maxConcurrency) } : {}),
  };
}

// ============================================================
// Service bindings list parser (services only)
// ============================================================

function parseServiceBindingsList(raw: unknown, prefix: string): ServiceBinding[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${prefix} must be an array`);
  }
  return raw.map((entry, i) => {
    if (typeof entry === 'string') return entry;
    const obj = asRecord(entry);
    return {
      name: asRequiredString(obj.name, `${prefix}[${i}].name`),
      ...(obj.version ? { version: String(obj.version) } : {}),
    };
  });
}

// ============================================================
// Service triggers parser (schedules only)
// ============================================================

function parseServiceTriggers(name: string, serviceSpec: Record<string, unknown>): { triggers: AppService['triggers'] } | undefined {
  const raw = serviceSpec.triggers;
  if (!raw) return undefined;
  const triggersRecord = asRecord(raw);
  const schedulesRaw = triggersRecord.schedules;
  const schedules = schedulesRaw == null ? undefined : (() => {
    if (!Array.isArray(schedulesRaw)) {
      throw new Error(`spec.services.${name}.triggers.schedules must be an array`);
    }
    return schedulesRaw.map((entry, index) => {
      const record = asRecord(entry);
      return {
        cron: asRequiredString(record.cron, `spec.services.${name}.triggers.schedules[${index}].cron`),
        export: asRequiredString(record.export, `spec.services.${name}.triggers.schedules[${index}].export`),
      };
    });
  })();
  if (!schedules) return undefined;
  return {
    triggers: {
      ...(schedules ? { schedules } : {}),
    },
  };
}

// ============================================================
// Environment overrides parser
// ============================================================

function parsePartialContainers(raw: unknown): Record<string, Partial<AppContainer>> {
  const containersRecord = asRecord(raw);
  const result: Record<string, Partial<AppContainer>> = {};
  for (const [name, value] of Object.entries(containersRecord)) {
    const c = asRecord(value);
    result[name] = {
      ...(c.dockerfile ? { dockerfile: normalizeRepoPath(String(c.dockerfile)) } : {}),
      ...(c.port != null ? { port: Number(c.port) } : {}),
      ...(c.instanceType ? { instanceType: String(c.instanceType) } : {}),
      ...(c.maxInstances != null ? { maxInstances: Number(c.maxInstances) } : {}),
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(c.env, `overrides.containers.${name}.env`); return v ? { env: v } : {}; })()),
    };
  }
  return result;
}

function parsePartialWorkers(raw: unknown): Record<string, Partial<AppWorker>> {
  const workersRecord = asRecord(raw);
  const result: Record<string, Partial<AppWorker>> = {};
  for (const [name, value] of Object.entries(workersRecord)) {
    const w = asRecord(value);
    result[name] = {
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(w.env, `overrides.workers.${name}.env`); return v ? { env: v } : {}; })()),
    };
  }
  return result;
}

function parsePartialServices(raw: unknown): Record<string, Partial<AppService>> {
  const servicesRecord = asRecord(raw);
  const result: Record<string, Partial<AppService>> = {};
  for (const [name, value] of Object.entries(servicesRecord)) {
    const s = asRecord(value);
    result[name] = {
      ...(s.dockerfile ? { dockerfile: normalizeRepoPath(String(s.dockerfile)) } : {}),
      ...(s.port != null ? { port: Number(s.port) } : {}),
      ...(s.instanceType ? { instanceType: String(s.instanceType) } : {}),
      ...(s.maxInstances != null ? { maxInstances: Number(s.maxInstances) } : {}),
      ...(s.ipv4 === true ? { ipv4: true } : {}),
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(s.env, `overrides.services.${name}.env`); return v ? { env: v } : {}; })()),
    };
  }
  return result;
}

function parseOverrides(specRecord: Record<string, unknown>): EnvironmentOverrides | undefined {
  const raw = specRecord.overrides;
  if (!raw) return undefined;
  const record = asRecord(raw);
  const result: EnvironmentOverrides = {};
  for (const [envName, envOverrides] of Object.entries(record)) {
    const envRecord = asRecord(envOverrides);
    result[envName] = {
      ...(envRecord.containers ? { containers: parsePartialContainers(envRecord.containers) } : {}),
      ...(envRecord.workers ? { workers: parsePartialWorkers(envRecord.workers) } : {}),
      ...(envRecord.services ? { services: parsePartialServices(envRecord.services) } : {}),
    };
  }
  return result;
}

// ============================================================
// dependsOn validation helper
// ============================================================

function validateDependsOn(
  dependsOn: string[] | undefined,
  prefix: string,
  allNames: Set<string>,
): void {
  if (!dependsOn) return;
  for (const dep of dependsOn) {
    if (!allNames.has(dep)) {
      throw new Error(`${prefix}.dependsOn references unknown target: ${dep}`);
    }
  }
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

  // --- shared optional fields ---
  const specDescription = asString(specRecord.description, 'spec.description');
  const specIcon = asString(specRecord.icon, 'spec.icon');
  const specCategory = asString(specRecord.category, 'spec.category');
  const specTags = asStringArray(specRecord.tags, 'spec.tags');
  const specCapabilities = asStringArray(specRecord.capabilities, 'spec.capabilities');
  const mcpServers = parseMcpServers(specRecord);
  const fileHandlers = parseFileHandlers(specRecord);

  const containers = parseContainers(specRecord);
  const services = parseServices(specRecord);
  const workers = parseWorkers(specRecord, containers);
  const envConfig = parseEnvConfig(specRecord);
  const routes = parseRoutes(specRecord, workers, containers, services);
  const lifecycle = parseLifecycle(specRecord);
  const update = parseUpdateStrategy(specRecord);
  const overrides = parseOverrides(specRecord);

  // Validate dependsOn references across all component types
  const allComponentNames = new Set([
    ...Object.keys(containers),
    ...Object.keys(services),
    ...Object.keys(workers),
  ]);
  for (const [name, container] of Object.entries(containers)) {
    validateDependsOn(container.dependsOn, `spec.containers.${name}`, allComponentNames);
  }
  for (const [name, service] of Object.entries(services)) {
    validateDependsOn(service.dependsOn, `spec.services.${name}`, allComponentNames);
  }
  for (const [name, worker] of Object.entries(workers)) {
    validateDependsOn(worker.dependsOn, `spec.workers.${name}`, allComponentNames);
  }

  // Resources — pass a synthesised services map for validation
  const syntheticServices = buildSyntheticServicesFromWorkers(workers);
  const resources = parseResources(specRecord, syntheticServices);
  validateResourceBindings(syntheticServices, resources);

  // Validate env.inject template references
  if (envConfig?.inject) {
    const templateErrors = validateTemplateReferences(envConfig.inject, {
      containers,
      services,
      workers,
      routes: routes || [],
      resources,
    });
    if (templateErrors.length > 0) {
      throw new Error(`env.inject template errors: ${templateErrors.join('; ')}`);
    }
  }

  // Validate version is valid semver
  const version = asRequiredString(specRecord.version, 'spec.version');
  validateSemver(version);

  // Parse takos config with optional minVersion
  let takosConfig: AppManifest['spec']['takos'] | undefined;
  if (specRecord.takos) {
    const takosRecord = asRecord(specRecord.takos);
    const minVersion = asString(takosRecord.minVersion, 'spec.takos.minVersion');
    if (minVersion) {
      validateSemver(minVersion);
    }
    const baseTakos = asRecord(specRecord.takos) as unknown as NonNullable<AppManifest['spec']['takos']>;
    takosConfig = {
      ...baseTakos,
      ...(minVersion ? { minVersion } : {}),
    };
  }

  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'App',
    metadata,
    spec: {
      version,
      ...(specDescription ? { description: specDescription } : {}),
      ...(specIcon ? { icon: specIcon } : {}),
      ...(specCategory ? { category: specCategory as AppManifest['spec']['category'] } : {}),
      ...(specTags ? { tags: specTags } : {}),
      ...(specCapabilities ? { capabilities: specCapabilities } : {}),
      ...(envConfig ? { env: envConfig } : {}),
      ...(specRecord.oauth ? { oauth: asRecord(specRecord.oauth) as AppManifest['spec']['oauth'] } : {}),
      ...(takosConfig ? { takos: takosConfig } : {}),
      ...(Object.keys(resources).length > 0 ? { resources } : {}),
      ...(Object.keys(containers).length > 0 ? { containers } : {}),
      ...(Object.keys(services).length > 0 ? { services } : {}),
      workers,
      ...(routes && routes.length > 0 ? { routes } : {}),
      ...(lifecycle ? { lifecycle } : {}),
      ...(update ? { update } : {}),
      ...(mcpServers ? { mcpServers } : {}),
      ...(fileHandlers ? { fileHandlers } : {}),
      ...(overrides ? { overrides } : {}),
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
    const containerVolumes = parseVolumes(c.volumes, `spec.containers.${name}`);
    const containerDependsOn = asStringArray(c.dependsOn, `spec.containers.${name}.dependsOn`);
    containers[name] = {
      dockerfile: normalizeRepoPath(asRequiredString(c.dockerfile, `spec.containers.${name}.dockerfile`)),
      port,
      ...(c.instanceType ? { instanceType: String(c.instanceType) } : {}),
      ...(c.maxInstances ? { maxInstances: Number(c.maxInstances) } : {}),
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(c.env, `spec.containers.${name}.env`); return v ? { env: v } : {}; })()),
      ...(containerVolumes ? { volumes: containerVolumes } : {}),
      ...(containerDependsOn ? { dependsOn: containerDependsOn } : {}),
    };
  }
  return containers;
}

export function parseServices(specRecord: Record<string, unknown>): Record<string, AppService> {
  const servicesRecord = asRecord(specRecord.services);
  const services: Record<string, AppService> = {};
  for (const [name, value] of Object.entries(servicesRecord)) {
    const s = asRecord(value);
    const port = Number(s.port);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`spec.services.${name}.port must be a positive number`);
    }
    const serviceHealthCheck = parseHealthCheck(s.healthCheck, `spec.services.${name}`);
    const serviceVolumes = parseVolumes(s.volumes, `spec.services.${name}`);
    const serviceDependsOn = asStringArray(s.dependsOn, `spec.services.${name}.dependsOn`);
    const serviceTriggers = parseServiceTriggers(name, s);

    // Parse service bindings (services only)
    let serviceBindings: AppService['bindings'] | undefined;
    if (s.bindings) {
      const bindingsRecord = asRecord(s.bindings);
      const svcBindings = parseServiceBindingsList(bindingsRecord.services, `spec.services.${name}.bindings.services`);
      if (svcBindings) {
        serviceBindings = { services: svcBindings };
      }
    }

    services[name] = {
      dockerfile: normalizeRepoPath(asRequiredString(s.dockerfile, `spec.services.${name}.dockerfile`)),
      port,
      ...(s.instanceType ? { instanceType: String(s.instanceType) } : {}),
      ...(s.maxInstances ? { maxInstances: Number(s.maxInstances) } : {}),
      ...(s.ipv4 === true ? { ipv4: true } : {}),
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(s.env, `spec.services.${name}.env`); return v ? { env: v } : {}; })()),
      ...(serviceHealthCheck ? { healthCheck: serviceHealthCheck } : {}),
      ...(serviceBindings ? { bindings: serviceBindings } : {}),
      ...(serviceTriggers ? serviceTriggers : {}),
      ...(serviceVolumes ? { volumes: serviceVolumes } : {}),
      ...(serviceDependsOn ? { dependsOn: serviceDependsOn } : {}),
    };
  }
  return services;
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

    const workerHealthCheck = parseHealthCheck(workerSpec.healthCheck, `spec.workers.${workerName}`);
    const workerScaling = parseScaling(workerSpec.scaling, `spec.workers.${workerName}`);
    const workerDependsOn = asStringArray(workerSpec.dependsOn, `spec.workers.${workerName}.dependsOn`);
    workers[workerName] = {
      ...(containerRefs && containerRefs.length > 0 ? { containers: containerRefs } : {}),
      build,
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(workerSpec.env, `spec.workers.${workerName}.env`); return v ? { env: v } : {}; })()),
      ...(workerSpec.bindings ? parseWorkerBindings(workerName, workerSpec) : {}),
      ...(workerSpec.triggers ? parseWorkerTriggers(workerName, workerSpec) : {}),
      ...(workerHealthCheck ? { healthCheck: workerHealthCheck } : {}),
      ...(workerScaling ? { scaling: workerScaling } : {}),
      ...(workerDependsOn ? { dependsOn: workerDependsOn } : {}),
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
  services: Record<string, AppService> = {},
): AppRoute[] | undefined {
  const routesRaw = specRecord.routes;
  if (routesRaw == null) return undefined;
  if (!Array.isArray(routesRaw)) throw new Error('spec.routes must be an array');
  return routesRaw.map((entry, index) => {
    const route = asRecord(entry);
    const target = asRequiredString(route.target, `spec.routes[${index}].target`);
    const name = asRequiredString(route.name, `spec.routes[${index}].name`);
    const ingress = asString(route.ingress, `spec.routes[${index}].ingress`);

    if (!workers[target] && !containers[target] && !services[target]) {
      throw new Error(`spec.routes[${index}].target references unknown worker, container, or service: ${target}`);
    }
    if (ingress && !workers[ingress]) {
      throw new Error(`spec.routes[${index}].ingress must reference a worker`);
    }

    const routePath = asString(route.path, `spec.routes[${index}].path`);

    // Parse route method constraints
    const methods = asStringArray(route.methods, `spec.routes[${index}].methods`);
    if (methods) {
      for (const method of methods) {
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
          throw new Error(`spec.routes[${index}].methods contains invalid method: ${method}`);
        }
      }
    }

    return {
      name,
      target,
      ...(routePath ? { path: routePath } : {}),
      ...(methods ? { methods } : {}),
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

  // services: string[] | { name, version }[] — both forms accepted
  let services: ServiceBinding[] | undefined;
  const servicesRaw = bindingsRecord.services;
  if (servicesRaw != null) {
    if (!Array.isArray(servicesRaw)) {
      throw new Error(`spec.workers.${workerName}.bindings.services must be an array`);
    }
    services = servicesRaw.map((entry, i) => {
      if (typeof entry === 'string') return entry;
      const obj = asRecord(entry);
      return {
        name: asRequiredString(obj.name, `spec.workers.${workerName}.bindings.services[${i}].name`),
        ...(obj.version ? { version: String(obj.version) } : {}),
      };
    });
  }

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
      ...(services ? { services } : {}),
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
