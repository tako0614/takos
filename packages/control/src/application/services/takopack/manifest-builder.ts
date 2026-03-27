/** Builds the normalised TakopackManifest from parsed objects, files, and checksums. */

import type {
  ManifestEndpoint, ManifestWorkerConfig, TakopackApplyReportEntry,
  TakopackBindingObject, TakopackEndpointObject, TakopackManifest,
  TakopackMcpServerObject, TakopackObject, TakopackPackageObject,
  TakopackResourceObject, TakopackRolloutObject, TakopackWorkloadObject,
} from './types';
import { cloudflareWorkerPlugin } from './plugins';
import { asRecord, asStringArray, parseOptionalTimeoutMs } from './manifest-utils';
import { buildBindingLookup } from './manifest-bindings';
import { parseResourceObjects, parseRolloutSpec } from './manifest-resources-parsing';

export function buildNormalizedManifest(params: {
  objects: TakopackObject[];
  files: Map<string, ArrayBuffer>;
  checksums: Map<string, string>;
}): { manifest: TakopackManifest; applyReport: TakopackApplyReportEntry[] } {
  const packageObjects = params.objects.filter((obj) => obj.kind === 'Package') as TakopackPackageObject[];
  const resourceObjects = params.objects.filter((obj) => obj.kind === 'Resource') as TakopackResourceObject[];
  const workloadObjects = params.objects.filter((obj) => obj.kind === 'Workload') as TakopackWorkloadObject[];
  const endpointObjects = params.objects.filter((obj) => obj.kind === 'Endpoint') as TakopackEndpointObject[];
  const bindingObjects = params.objects.filter((obj) => obj.kind === 'Binding') as TakopackBindingObject[];
  const mcpServerObjects = params.objects.filter((obj) => obj.kind === 'McpServer') as TakopackMcpServerObject[];
  const rolloutObjects = params.objects.filter((obj) => obj.kind === 'Rollout') as TakopackRolloutObject[];

  if (packageObjects.length !== 1) {
    throw new Error(`manifest.yaml must contain exactly one Package object (found ${packageObjects.length})`);
  }

  const pkg = packageObjects[0];
  const pkgSpec = asRecord(pkg.spec);
  const rawAppId = String(pkgSpec.appId || '').trim();
  const appId = rawAppId || pkg.metadata.name;
  const version = String(pkgSpec.version || '').trim();
  if (!version) {
    throw new Error('Package.spec.version is required');
  }

  const applyReport: TakopackApplyReportEntry[] = params.objects.map((obj) => ({
    objectName: obj.metadata.name,
    kind: obj.kind,
    phase: 'validated',
    status: 'success',
  }));

  if (!rawAppId) {
    applyReport.push({
      objectName: pkg.metadata.name,
      kind: 'Package',
      phase: 'validated',
      status: 'success',
      message: 'Package.spec.appId is missing; falling back to metadata.name.',
    });
  }

  const {
    resourcesD1, resourcesR2, resourcesKV, resourcesQueue,
    resourcesAnalyticsEngine, resourcesWorkflow, resourcesVectorize, resourcesDurableObject,
  } = parseResourceObjects(resourceObjects);

  // Build resource lookup for cross-references (e.g. McpServer.authSecretRef)
  const resourceByName = new Map(
    resourceObjects.map((r) => [r.metadata.name, { type: String(r.spec.type || ''), generate: Boolean(r.spec.generate) }]),
  );
  const bindingLookup = buildBindingLookup(resourceObjects, workloadObjects, bindingObjects);

  const workers: ManifestWorkerConfig[] = [];
  const workloadRuntimeByName = new Map<string, string>();
  const workloadWorkerRefByName = new Map<string, string>();
  for (const workload of workloadObjects) {
    const pluginType = String(workload.spec.type || '').trim();
    if (pluginType !== cloudflareWorkerPlugin.type) {
      throw new Error(
        `Unsupported workload plugin type: ${pluginType || '<empty>'}. Supported: ${cloudflareWorkerPlugin.type}`
      );
    }
    const plugin = cloudflareWorkerPlugin;

    const bindings = bindingLookup.get(workload.metadata.name) || {
      d1: [],
      r2: [],
      kv: [],
      queue: [],
      analyticsEngine: [],
      workflow: [],
      vectorize: [],
      durableObject: [],
    };
    plugin.validate(workload, {
      files: params.files,
      checksums: params.checksums,
    });

    const applied = plugin.apply(workload, {
      files: params.files,
      checksums: params.checksums,
      bindings,
    });

    const runtime = String(applied.runtime || pluginType).trim() || pluginType;
    workloadRuntimeByName.set(workload.metadata.name, runtime);

    if (applied.worker) {
      workers.push(applied.worker);
      workloadWorkerRefByName.set(workload.metadata.name, applied.worker.name);
    }
  }

  const workloadNames = new Set(workloadObjects.map((workload) => workload.metadata.name));
  const endpoints: ManifestEndpoint[] = endpointObjects.map((endpointObject) => {
    const spec = asRecord(endpointObject.spec);
    const protocol = String(spec.protocol || '').trim();
    if (protocol !== 'http') {
      throw new Error(`Endpoint ${endpointObject.metadata.name} has unsupported protocol: ${protocol || '<empty>'}`);
    }

    const targetRef = String(spec.targetRef || '').trim();
    if (!targetRef) {
      throw new Error(`Endpoint ${endpointObject.metadata.name} is missing spec.targetRef`);
    }
    if (!workloadNames.has(targetRef)) {
      throw new Error(`Endpoint ${endpointObject.metadata.name} references unknown workload: ${targetRef}`);
    }

    const targetRuntime = workloadRuntimeByName.get(targetRef) || '';
    if (!targetRuntime) {
      throw new Error(`Endpoint ${endpointObject.metadata.name} target workload runtime is unresolved: ${targetRef}`);
    }

    const rawIngressRef = String(spec.ingressRef || '').trim();
    if (targetRuntime !== 'cloudflare.worker') {
      throw new Error(
        `Endpoint ${endpointObject.metadata.name} target workload must be cloudflare.worker (${targetRef})`
      );
    }
    const resolvedTargetRuntime: 'cloudflare.worker' = 'cloudflare.worker';
    const ingressRef = rawIngressRef || targetRef;

    let ingressWorker: string | undefined;
    if (ingressRef) {
      if (!workloadNames.has(ingressRef)) {
        throw new Error(`Endpoint ${endpointObject.metadata.name} ingressRef references unknown workload: ${ingressRef}`);
      }
      const ingressRuntime = workloadRuntimeByName.get(ingressRef) || '';
      if (ingressRuntime !== 'cloudflare.worker') {
        throw new Error(
          `Endpoint ${endpointObject.metadata.name} ingressRef must reference a cloudflare.worker workload (${ingressRef})`
        );
      }
      ingressWorker = workloadWorkerRefByName.get(ingressRef);
      if (!ingressWorker) {
        throw new Error(
          `Endpoint ${endpointObject.metadata.name} ingress workload has no deployable worker reference: ${ingressRef}`
        );
      }
    }

    const path = String(spec.path || '').trim();
    if (path && !path.startsWith('/')) {
      throw new Error(`Endpoint ${endpointObject.metadata.name} spec.path must start with "/"`);
    }

    const timeoutMs = parseOptionalTimeoutMs(
      spec.timeoutMs,
      `Endpoint ${endpointObject.metadata.name} spec.timeoutMs`
    );

    const routes = path ? [{ pathPrefix: path }] : [];

    return {
      name: endpointObject.metadata.name,
      protocol: 'http',
      targetRef,
      targetRuntime: resolvedTargetRuntime,
      ...(ingressRef ? { ingressRef } : {}),
      ...(ingressWorker ? { ingressWorker } : {}),
      routes,
      ...(path ? { path } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    };
  });

  const endpointByName = new Map(endpoints.map((endpoint) => [endpoint.name, endpoint]));
  const mcpServers = mcpServerObjects.map((mcpServer) => {
    const spec = asRecord(mcpServer.spec);
    const endpointRef = String(spec.endpointRef || '').trim();
    if (!endpointRef) {
      throw new Error(`McpServer ${mcpServer.metadata.name} is missing spec.endpointRef`);
    }

    const endpoint = endpointByName.get(endpointRef);
    if (!endpoint) {
      throw new Error(`McpServer ${mcpServer.metadata.name} references unknown endpoint: ${endpointRef}`);
    }

    const name = String(spec.name || mcpServer.metadata.name || '').trim();
    if (!name) {
      throw new Error(`McpServer ${mcpServer.metadata.name} resolved to empty name`);
    }

    const transport = String(spec.transport || 'streamable-http').trim();
    if (transport !== 'streamable-http') {
      throw new Error(`McpServer ${mcpServer.metadata.name} has invalid spec.transport: ${transport}`);
    }

    const workerRef = endpoint.ingressWorker
      ?? workloadWorkerRefByName.get(endpoint.targetRef)
      ?? '';
    if (!workerRef) {
      throw new Error(
        `McpServer ${mcpServer.metadata.name} references endpoint ${endpointRef} with no resolvable Cloudflare worker`
      );
    }

    const endpointPath = endpoint.path || '/mcp';

    // Validate authSecretRef references a secretRef resource
    const authSecretRef = spec.authSecretRef ? String(spec.authSecretRef).trim() : undefined;
    if (authSecretRef) {
      const secretResource = resourceByName.get(authSecretRef);
      if (!secretResource) {
        throw new Error(
          `McpServer ${mcpServer.metadata.name} authSecretRef references unknown resource: ${authSecretRef}`
        );
      }
      if (secretResource.type !== 'secretRef') {
        throw new Error(
          `McpServer ${mcpServer.metadata.name} authSecretRef must reference a secretRef resource, got: ${secretResource.type}`
        );
      }
    }

    return {
      name,
      transport: 'streamable-http' as const,
      worker: workerRef,
      endpoint: endpointRef,
      path: endpointPath,
      ...(authSecretRef ? { authSecretRef } : {}),
    };
  });

  const dependenciesRaw = pkgSpec.dependencies;
  const dependencies = Array.isArray(dependenciesRaw)
    ? dependenciesRaw
        .map((entry) => {
          const item = asRecord(entry);
          const repo = String(item.repo || '').trim();
          const depVersion = String(item.version || '').trim();
          return { repo, version: depVersion };
        })
        .filter((entry) => entry.repo && entry.version)
    : undefined;

  const capabilities = asStringArray(pkgSpec.capabilities, 'Package.spec.capabilities');

  const oauth = (() => {
    const oauthSpec = asRecord(pkgSpec.oauth);
    if (Object.keys(oauthSpec).length === 0) {
      return undefined;
    }

    const clientName = String(oauthSpec.clientName || '').trim();
    const redirectUris = asStringArray(oauthSpec.redirectUris, 'Package.spec.oauth.redirectUris');
    const scopes = asStringArray(oauthSpec.scopes, 'Package.spec.oauth.scopes');

    if (!clientName || redirectUris.length === 0 || scopes.length === 0) {
      throw new Error('Package.spec.oauth requires clientName, redirectUris, and scopes');
    }

    const metadata = asRecord(oauthSpec.metadata);

    return {
      clientName,
      redirectUris,
      scopes,
      autoEnv: oauthSpec.autoEnv === true,
      metadata: Object.keys(metadata).length > 0
        ? {
            ...(metadata.logoUri ? { logoUri: String(metadata.logoUri) } : {}),
            ...(metadata.tosUri ? { tosUri: String(metadata.tosUri) } : {}),
            ...(metadata.policyUri ? { policyUri: String(metadata.policyUri) } : {}),
          }
        : undefined,
    };
  })();

  const takos = (() => {
    const takosSpec = asRecord(pkgSpec.takos);
    if (Object.keys(takosSpec).length === 0) {
      return undefined;
    }

    const scopes = asStringArray(takosSpec.scopes, 'Package.spec.takos.scopes');
    if (scopes.length === 0) {
      throw new Error('Package.spec.takos.scopes must contain at least one scope');
    }

    return { scopes };
  })();

  const env = (() => {
    const envSpec = asRecord(pkgSpec.env);
    if (Object.keys(envSpec).length === 0) {
      return undefined;
    }

    const required = asStringArray(envSpec.required, 'Package.spec.env.required');
    return { required };
  })();

  const fileHandlers = (() => {
    const raw = pkgSpec.fileHandlers;
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return raw.map((entry, index) => {
      const item = asRecord(entry);
      const name = String(item.name || '').trim();
      const openPath = String(item.openPath || '').trim();
      if (!name || !openPath) {
        throw new Error(`Package.spec.fileHandlers[${index}] requires name and openPath`);
      }
      const mimeTypes = item.mimeTypes ? asStringArray(item.mimeTypes, `Package.spec.fileHandlers[${index}].mimeTypes`) : undefined;
      const extensions = item.extensions ? asStringArray(item.extensions, `Package.spec.fileHandlers[${index}].extensions`) : undefined;
      if (!mimeTypes?.length && !extensions?.length) {
        throw new Error(`Package.spec.fileHandlers[${index}] requires at least one of mimeTypes or extensions`);
      }
      return { name, mimeTypes, extensions, openPath };
    });
  })();

  const categoryRaw = String(pkgSpec.category || '').trim();
  const category = categoryRaw
    ? (categoryRaw as 'app' | 'service' | 'library' | 'template' | 'social')
    : undefined;

  const manifest: TakopackManifest = {
    manifestVersion: 'vnext-infra-v1alpha1',
    meta: {
      name: pkg.metadata.name,
      appId,
      version,
      ...(pkgSpec.description ? { description: String(pkgSpec.description) } : {}),
      ...(pkgSpec.icon ? { icon: String(pkgSpec.icon) } : {}),
      ...(category ? { category } : {}),
      tags: asStringArray(pkgSpec.tags, 'Package.spec.tags'),
      createdAt: new Date().toISOString(),
      ...(dependencies ? { dependencies } : {}),
    },
    ...(dependencies ? { dependencies } : {}),
    ...(capabilities.length > 0 ? { capabilities } : {}),
    ...((resourcesD1.length > 0
        || resourcesR2.length > 0
        || resourcesKV.length > 0
        || resourcesQueue.length > 0
        || resourcesAnalyticsEngine.length > 0
        || resourcesWorkflow.length > 0
        || resourcesVectorize.length > 0
        || resourcesDurableObject.length > 0)
      ? {
      resources: {
        ...(resourcesD1.length > 0 ? { d1: resourcesD1 } : {}),
        ...(resourcesR2.length > 0 ? { r2: resourcesR2 } : {}),
        ...(resourcesKV.length > 0 ? { kv: resourcesKV } : {}),
        ...(resourcesQueue.length > 0 ? { queue: resourcesQueue } : {}),
        ...(resourcesAnalyticsEngine.length > 0 ? { analyticsEngine: resourcesAnalyticsEngine } : {}),
        ...(resourcesWorkflow.length > 0 ? { workflow: resourcesWorkflow } : {}),
        ...(resourcesVectorize.length > 0 ? { vectorize: resourcesVectorize } : {}),
        ...(resourcesDurableObject.length > 0 ? { durableObject: resourcesDurableObject } : {}),
      },
        }
      : {}),
    ...(oauth ? { oauth } : {}),
    ...(takos ? { takos } : {}),
    ...(env ? { env } : {}),
    ...(workers.length > 0 ? { workers } : {}),
    ...(endpoints.length > 0 ? { endpoints } : {}),
    ...(mcpServers.length > 0 ? { mcpServers } : {}),
    ...(fileHandlers ? { fileHandlers } : {}),
    ...(rolloutObjects.length > 0 ? { rollout: parseRolloutSpec(rolloutObjects[0]) } : {}),
    objects: params.objects,
  };

  applyReport.push(
    ...params.objects.map((obj) => ({
      objectName: obj.metadata.name,
      kind: obj.kind,
      phase: 'planned' as const,
      status: 'success' as const,
    }))
  );

  return {
    manifest,
    applyReport,
  };
}
