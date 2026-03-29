import YAML from 'yaml';
import type { AppManifest, AppMetadata } from '../app-manifest-types';
import { asRecord, asString, asRequiredString, asStringArray, asStringMap } from '../app-manifest-utils';
import { parseResources, validateResourceBindings } from '../app-manifest-validation';
import { validateTemplateReferences } from '../app-manifest-template';

import { validateSemver, parseLifecycle, parseUpdateStrategy, validateDependsOn } from './parse-common';
import { parseContainers } from './parse-containers';
import { parseWorkers, buildSyntheticServicesFromWorkers } from './parse-workers';
import { parseServices, parseMcpServers, parseFileHandlers } from './parse-services';
import { parseRoutes } from './parse-routes';
import { parseEnvConfig } from './parse-env';
import { parseOverrides } from './parse-overrides';

function validateMcpServers(
  mcpServers: NonNullable<AppManifest['spec']['mcpServers']> | undefined,
  routes: NonNullable<AppManifest['spec']['routes']> | undefined,
  resources: Record<string, NonNullable<AppManifest['spec']['resources']>[string]>,
): void {
  if (!mcpServers || mcpServers.length === 0) return;

  const routeNames = new Set((routes || []).map((route) => route.name));

  for (const server of mcpServers) {
    if (server.endpoint && server.route) {
      throw new Error(`spec.mcpServers.${server.name} must not specify both endpoint and route`);
    }
    if (server.route && !routeNames.has(server.route)) {
      throw new Error(`spec.mcpServers.${server.name}.route references unknown route: ${server.route}`);
    }
    if (server.authSecretRef && resources[server.authSecretRef]?.type !== 'secretRef') {
      throw new Error(`spec.mcpServers.${server.name}.authSecretRef must reference a secretRef resource: ${server.authSecretRef}`);
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
  validateMcpServers(mcpServers, routes, resources);

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

// Re-export sub-module functions for any consumers that import them directly
export { parseContainers } from './parse-containers';
export { parseServices } from './parse-services';
export { parseWorkers } from './parse-workers';
export { parseEnvConfig } from './parse-env';
