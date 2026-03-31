import { WFPService, type WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import { logWarn } from '../../../shared/utils/logger.ts';
import type {
  ArtifactKind,
  Deployment,
  DeploymentProviderName,
  DeploymentProviderRef,
  DeploymentTarget,
  DeploymentTargetArtifact,
  DeploymentTargetEndpoint,
} from './models.ts';

export type DeploymentProviderDeployResult = {
  resolvedEndpoint?: { kind: 'http-url'; base_url: string };
  logsRef?: string;
};

export type DeploymentProviderRuntimeInput = {
  profile: 'workers' | 'container-service';
  bindings?: WorkerBinding[];
  config?: {
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
  };
};

export type DeploymentProviderDeployInput = {
  deployment: Deployment;
  artifactRef: string;
  bundleContent?: string;
  wasmContent: ArrayBuffer | null;
  runtime: DeploymentProviderRuntimeInput;
};

export type DeploymentProvider = {
  name: DeploymentProviderName;
  deploy(input: DeploymentProviderDeployInput): Promise<DeploymentProviderDeployResult | void>;
  assertRollbackTarget(artifactRef: string): Promise<void>;
  cleanupDeploymentArtifact?(artifactRef: string): Promise<void>;
};

export type WfpDeploymentProviderEnv = {
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  WFP_DISPATCH_NAMESPACE?: string;
};

type OciDeploymentOrchestratorConfig = {
  orchestratorUrl?: string;
  orchestratorToken?: string;
  fetchImpl?: typeof fetch;
};

type DeploymentProviderRegistryEntry = {
  name: DeploymentProviderName;
  config?: Record<string, unknown>;
};

type DeploymentProviderFactoryConfig = OciDeploymentOrchestratorConfig & {
  cloudflareEnv?: WfpDeploymentProviderEnv;
  awsRegion?: string;
  awsEcsClusterArn?: string;
  awsEcsTaskDefinitionFamily?: string;
  awsEcsServiceArn?: string;
  awsEcsServiceName?: string;
  awsEcsContainerName?: string;
  awsEcsSubnetIds?: string;
  awsEcsSecurityGroupIds?: string;
  awsEcsAssignPublicIp?: string;
  awsEcsLaunchType?: string;
  awsEcsDesiredCount?: string;
  awsEcsBaseUrl?: string;
  awsEcsHealthUrl?: string;
  awsEcrRepositoryUri?: string;
  gcpProjectId?: string;
  gcpRegion?: string;
  gcpCloudRunServiceId?: string;
  gcpCloudRunServiceAccount?: string;
  gcpCloudRunIngress?: string;
  gcpCloudRunAllowUnauthenticated?: string;
  gcpCloudRunBaseUrl?: string;
  gcpCloudRunDeleteOnRemove?: string;
  gcpArtifactRegistryRepo?: string;
  k8sNamespace?: string;
  k8sDeploymentName?: string;
  k8sImageRegistry?: string;
  providerRegistry?: {
    get(name: DeploymentProviderName): DeploymentProviderRegistryEntry | undefined;
  };
};

type PersistedDeploymentContract = Pick<Deployment, 'provider_name' | 'target_json'>;
type OrchestratedDeploymentProviderName = 'oci' | 'ecs' | 'cloud-run' | 'k8s';

type OrchestratedDeploymentProviderConfig = OciDeploymentOrchestratorConfig & {
  providerName: OrchestratedDeploymentProviderName;
  providerConfig?: Record<string, unknown>;
};

function normalizeDeployRuntime(input: DeploymentProviderDeployInput): {
  profile: 'workers' | 'container-service';
  bindings: WorkerBinding[];
  compatibilityDate: string;
  compatibilityFlags: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
} {
  const runtime = input.runtime;
  return {
    profile: runtime.profile,
    bindings: runtime.bindings ?? [],
    compatibilityDate: runtime.config?.compatibility_date ?? '2024-01-01',
    compatibilityFlags: runtime.config?.compatibility_flags ?? [],
    limits: runtime.config?.limits,
  };
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function compactRecord<T extends Record<string, unknown>>(value: T): T | undefined {
  const filtered = Object.entries(value).filter(([, entry]) => {
    if (entry == null) return false;
    if (typeof entry === 'string') return entry.trim().length > 0;
    return true;
  });
  if (filtered.length === 0) {
    return undefined;
  }
  return Object.fromEntries(filtered) as T;
}

function normalizeTargetEndpoint(raw: Record<string, unknown>): DeploymentTargetEndpoint | undefined {
  const endpoint = raw.endpoint;
  if (endpoint && typeof endpoint === 'object') {
    const parsed = endpoint as Record<string, unknown>;
    if (parsed.kind === 'service-ref' && typeof parsed.ref === 'string' && parsed.ref.length > 0) {
      return {
        kind: 'service-ref',
        ref: parsed.ref,
      };
    }
    if (parsed.kind === 'http-url' && typeof parsed.base_url === 'string' && parsed.base_url.length > 0) {
      return {
        kind: 'http-url',
        base_url: parsed.base_url,
      };
    }
  }
  return undefined;
}

function normalizeTargetArtifact(raw: Record<string, unknown>): DeploymentTargetArtifact | undefined {
  const artifact = raw.artifact;
  if (artifact && typeof artifact === 'object') {
    const parsed = artifact as Record<string, unknown>;
    const normalized: DeploymentTargetArtifact = {};
    if (parsed.kind === 'worker-bundle' || parsed.kind === 'container-image') {
      normalized.kind = parsed.kind as ArtifactKind;
    }
    if (typeof parsed.image_ref === 'string' && parsed.image_ref.length > 0) {
      normalized.image_ref = parsed.image_ref;
    }
    if (typeof parsed.exposed_port === 'number' && Number.isFinite(parsed.exposed_port)) {
      normalized.exposed_port = parsed.exposed_port;
    }
    if (typeof parsed.health_path === 'string' && parsed.health_path.length > 0) {
      normalized.health_path = parsed.health_path;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  return undefined;
}

function targetContainsContainerImage(target: DeploymentTarget): boolean {
  return target.artifact?.kind === 'container-image'
    && typeof target.artifact.image_ref === 'string'
    && target.artifact.image_ref.trim().length > 0;
}

function normalizeDeploymentTarget(raw: Record<string, unknown>): DeploymentTarget {
  const endpoint = normalizeTargetEndpoint(raw);
  const routeRef = typeof raw.route_ref === 'string' && raw.route_ref.length > 0
    ? raw.route_ref
    : endpoint?.kind === 'service-ref'
      ? endpoint.ref
      : undefined;
  const artifact = normalizeTargetArtifact(raw);

  return {
    ...(routeRef ? { route_ref: routeRef } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(artifact ? { artifact } : {}),
  };
}

export function parseDeploymentTargetConfig(
  deployment: PersistedDeploymentContract,
): DeploymentTarget {
  const parsed = safeJsonParse<Record<string, unknown>>(deployment.target_json, {});
  return normalizeDeploymentTarget(parsed);
}

export function serializeDeploymentTarget(options?: {
  provider?: DeploymentProviderRef;
  target?: DeploymentTarget;
}): {
  providerName: Deployment['provider_name'];
  targetJson: string;
  providerStateJson: string;
} {
  const target = options?.target;
  // Build a plain object that preserves all artifact fields (kind, health_path, etc.)
  const raw: Record<string, unknown> = {};
  if (target?.route_ref) raw.route_ref = target.route_ref;
  if (target?.endpoint) raw.endpoint = target.endpoint;
  if (target?.artifact) {
    const artifactRaw: Record<string, unknown> = {};
    if (target.artifact.kind) artifactRaw.kind = target.artifact.kind;
    if (target.artifact.image_ref) artifactRaw.image_ref = target.artifact.image_ref;
    if (target.artifact.exposed_port != null) artifactRaw.exposed_port = target.artifact.exposed_port;
    if (target.artifact.health_path) artifactRaw.health_path = target.artifact.health_path;
    if (Object.keys(artifactRaw).length > 0) raw.artifact = artifactRaw;
  }

  const normalized = normalizeDeploymentTarget(raw);
  return {
    providerName: options?.provider?.name ?? 'workers-dispatch',
    targetJson: JSON.stringify(normalized),
    providerStateJson: '{}',
  };
}

export function createWorkersDispatchDeploymentProvider(wfp: WFPService): DeploymentProvider {
  return {
    name: 'workers-dispatch',
    async deploy(input) {
      const runtime = normalizeDeployRuntime(input);
      if (input.wasmContent) {
        await wfp.workers.createWorkerWithWasm(
          input.artifactRef,
          input.bundleContent || '',
          input.wasmContent,
          {
            bindings: runtime.bindings as Array<{
              type: string;
              name: string;
              id?: string;
              bucket_name?: string;
              namespace_id?: string;
              text?: string;
            }>,
            compatibility_date: runtime.compatibilityDate,
            compatibility_flags: runtime.compatibilityFlags,
            limits: runtime.limits,
          },
        );
        return;
      }

      await wfp.workers.createWorker({
        workerName: input.artifactRef,
        workerScript: input.bundleContent || '',
        bindings: runtime.bindings,
        compatibility_date: runtime.compatibilityDate,
        compatibility_flags: runtime.compatibilityFlags,
        limits: runtime.limits,
      });
    },
    async assertRollbackTarget(artifactRef) {
      const exists = await wfp.workers.workerExists(artifactRef);
      if (!exists) {
        throw new Error(`Rollback target artifact not found in WFP: ${artifactRef}`);
      }
    },
    async cleanupDeploymentArtifact(artifactRef) {
      await wfp.workers.deleteWorker(artifactRef);
    },
  };
}

export function createRuntimeHostDeploymentProvider(): DeploymentProvider {
  return {
    name: 'runtime-host',
    async deploy(input) {
      const runtime = normalizeDeployRuntime(input);
      if (runtime.profile !== 'workers') {
        throw new Error('runtime-host provider only supports workers runtime profiles');
      }
      if (!input.bundleContent || input.bundleContent.trim().length === 0) {
        throw new Error('runtime-host deployment requires a worker bundle');
      }
      // runtime-host resolves active deployments lazily from DB + WORKER_BUNDLES.
      // Creating the deployment row and storing the bundle is sufficient here.
    },
    async assertRollbackTarget(_artifactRef) {
      // runtime-host loads rollback targets from Takos-managed deployment records.
    },
  };
}

export function createOciDeploymentProvider(
  deployment: PersistedDeploymentContract,
  config?: OciDeploymentOrchestratorConfig,
): DeploymentProvider {
  return createOrchestratedDeploymentProvider(deployment, {
    providerName: 'oci',
    orchestratorUrl: config?.orchestratorUrl,
    orchestratorToken: config?.orchestratorToken,
    fetchImpl: config?.fetchImpl,
  });
}

function readRegistryString(
  entry: DeploymentProviderRegistryEntry | undefined,
  key: string,
): string | undefined {
  const value = entry?.config?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readConfigString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readConfigBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return undefined;
}

function readConfigNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readConfigStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const entries = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : undefined;
  }
  if (typeof value === 'string') {
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : undefined;
  }
  return undefined;
}

function resolveRegistryProviderConfig(
  entry: DeploymentProviderRegistryEntry | undefined,
): Record<string, unknown> | undefined {
  if (!entry?.config || typeof entry.config !== 'object' || Array.isArray(entry.config)) {
    return undefined;
  }

  const providerConfig = Object.fromEntries(
    Object.entries(entry.config)
      .filter(([key]) => key !== 'orchestratorUrl' && key !== 'orchestratorToken'),
  );

  return Object.keys(providerConfig).length > 0 ? providerConfig : undefined;
}

function resolveEnvProviderConfig(
  providerName: OrchestratedDeploymentProviderName,
  config: DeploymentProviderFactoryConfig,
): Record<string, unknown> | undefined {
  switch (providerName) {
    case 'ecs':
      return compactRecord({
        region: readConfigString(config.awsRegion),
        clusterArn: readConfigString(config.awsEcsClusterArn),
        taskDefinitionFamily: readConfigString(config.awsEcsTaskDefinitionFamily),
        serviceArn: readConfigString(config.awsEcsServiceArn),
        serviceName: readConfigString(config.awsEcsServiceName),
        containerName: readConfigString(config.awsEcsContainerName),
        subnetIds: readConfigStringList(config.awsEcsSubnetIds),
        securityGroupIds: readConfigStringList(config.awsEcsSecurityGroupIds),
        assignPublicIp: readConfigBoolean(config.awsEcsAssignPublicIp),
        launchType: readConfigString(config.awsEcsLaunchType),
        desiredCount: readConfigNumber(config.awsEcsDesiredCount),
        baseUrl: readConfigString(config.awsEcsBaseUrl),
        healthUrl: readConfigString(config.awsEcsHealthUrl),
        ecrRepositoryUri: readConfigString(config.awsEcrRepositoryUri),
      });
    case 'cloud-run':
      return compactRecord({
        projectId: readConfigString(config.gcpProjectId),
        region: readConfigString(config.gcpRegion),
        serviceId: readConfigString(config.gcpCloudRunServiceId),
        serviceAccount: readConfigString(config.gcpCloudRunServiceAccount),
        ingress: readConfigString(config.gcpCloudRunIngress),
        allowUnauthenticated: readConfigBoolean(config.gcpCloudRunAllowUnauthenticated),
        baseUrl: readConfigString(config.gcpCloudRunBaseUrl),
        deleteOnRemove: readConfigBoolean(config.gcpCloudRunDeleteOnRemove),
        artifactRegistryRepo: readConfigString(config.gcpArtifactRegistryRepo),
      });
    case 'k8s':
      return compactRecord({
        namespace: readConfigString(config.k8sNamespace),
        deploymentName: readConfigString(config.k8sDeploymentName),
        imageRegistry: readConfigString(config.k8sImageRegistry),
      });
    case 'oci':
    default:
      return undefined;
  }
}

function createOrchestratedDeploymentProvider(
  deployment: PersistedDeploymentContract,
  config: OrchestratedDeploymentProviderConfig,
): DeploymentProvider {
  const target = parseDeploymentTargetConfig(deployment);
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    name: config.providerName,
    async deploy(input) {
      const runtime = normalizeDeployRuntime(input);
      const serviceRef = target.endpoint?.kind === 'service-ref'
        ? target.endpoint.ref.trim()
        : target.route_ref?.trim() || input.artifactRef;
      if (!serviceRef) {
        throw new Error('OCI deployment target requires route_ref or service-ref endpoint');
      }

      const exposedPort = target.artifact?.exposed_port;
      if (exposedPort != null && (!Number.isFinite(exposedPort) || exposedPort <= 0)) {
        throw new Error('OCI deployment target exposed_port must be a positive integer');
      }

      const externalBaseUrl = target.endpoint?.kind === 'http-url'
        ? target.endpoint.base_url
        : null;
      const orchestratorUrl = config.orchestratorUrl?.trim();
      const imageRef = target.artifact?.image_ref?.trim();
      const healthPath = target.artifact?.health_path?.trim() || '/health';

      if (!imageRef) {
        if (externalBaseUrl) {
          return { resolvedEndpoint: { kind: 'http-url' as const, base_url: externalBaseUrl } };
        }
        return;
      }

      if (!orchestratorUrl) {
        throw new Error('OCI deployment target requires OCI_ORCHESTRATOR_URL');
      }

      const deployUrl = orchestratorUrl.endsWith('/') ? `${orchestratorUrl}deploy` : `${orchestratorUrl}/deploy`;

      const providerPayload = config.providerName === 'oci' && !config.providerConfig
        ? undefined
        : {
            name: config.providerName,
            ...(config.providerConfig ? { config: config.providerConfig } : {}),
          };

      const response = await fetchImpl(deployUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.orchestratorToken ? { Authorization: `Bearer ${config.orchestratorToken}` } : {}),
        },
        body: JSON.stringify({
          deployment_id: input.deployment.id,
          space_id: input.deployment.space_id,
          artifact_ref: input.artifactRef,
          ...(providerPayload ? { provider: providerPayload } : {}),
          target: {
            route_ref: target.route_ref ?? serviceRef,
            endpoint: {
              kind: externalBaseUrl ? 'http-url' : 'service-ref',
              ...(externalBaseUrl ? { base_url: externalBaseUrl } : { ref: serviceRef }),
            },
            artifact: {
              image_ref: imageRef,
              exposed_port: exposedPort ?? undefined,
              health_path: healthPath,
            },
          },
          runtime: {
            profile: runtime.profile,
            compatibility_date: runtime.compatibilityDate,
            compatibility_flags: runtime.compatibilityFlags,
            limits: runtime.limits ?? null,
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch((err) => {
          logWarn('Failed to read error response body', { module: 'oci-provider', error: err instanceof Error ? err.message : String(err) });
          return '';
        });
        throw new Error(`OCI deployment orchestrator failed with ${response.status}: ${body.slice(0, 300)}`);
      }

      const responseBody = await response.json().catch((err) => {
        logWarn('Failed to parse deployment orchestrator JSON response', { module: 'oci-provider', error: err instanceof Error ? err.message : String(err) });
        return null;
      }) as {
        resolved_endpoint?: { kind: string; base_url: string };
        logs_ref?: string;
      } | null;

      if (responseBody?.resolved_endpoint?.base_url) {
        return {
          resolvedEndpoint: {
            kind: 'http-url' as const,
            base_url: responseBody.resolved_endpoint.base_url,
          },
          logsRef: responseBody.logs_ref,
        };
      }
      return;
    },
    async assertRollbackTarget(_artifactRef) {
      // OCI rollback validity is external to Takos; routing can still point at the artifact ref.
    },
  };
}

export function createDeploymentProvider(
  deployment: PersistedDeploymentContract,
  config: DeploymentProviderFactoryConfig = {},
): DeploymentProvider {
  const deploymentTarget = parseDeploymentTargetConfig(deployment);
  const hasImageRef = targetContainsContainerImage(deploymentTarget);
  const registryEntry = config.providerRegistry?.get(deployment.provider_name);
  const registryOrchestratorUrl = readRegistryString(registryEntry, 'orchestratorUrl');
  const registryOrchestratorToken = readRegistryString(registryEntry, 'orchestratorToken');
  const registryProviderConfig = resolveRegistryProviderConfig(registryEntry);

  switch (deployment.provider_name) {
    case 'ecs':
    case 'cloud-run':
    case 'k8s':
    case 'oci':
      if (hasImageRef && !((registryOrchestratorUrl ?? config.orchestratorUrl)?.trim())) {
        throw new Error('OCI deployment target requires OCI_ORCHESTRATOR_URL');
      }
      return createOrchestratedDeploymentProvider(deployment, {
        providerName: deployment.provider_name,
        providerConfig: registryProviderConfig ?? resolveEnvProviderConfig(deployment.provider_name, config),
        orchestratorUrl: registryOrchestratorUrl ?? config.orchestratorUrl,
        orchestratorToken: registryOrchestratorToken ?? config.orchestratorToken,
        fetchImpl: config.fetchImpl,
      });

    case 'workers-dispatch': {
      const wfpEnv = config.cloudflareEnv;
      const accountId = wfpEnv?.CF_ACCOUNT_ID;
      const apiToken = wfpEnv?.CF_API_TOKEN;
      const dispatchNamespace = wfpEnv?.WFP_DISPATCH_NAMESPACE;

      if (!accountId || !apiToken || !dispatchNamespace) {
        throw new Error('workers-dispatch deployment requires WFP environment');
      }

      return createWorkersDispatchDeploymentProvider(new WFPService({
        CF_ACCOUNT_ID: accountId,
        CF_API_TOKEN: apiToken,
        WFP_DISPATCH_NAMESPACE: dispatchNamespace,
      }));
    }

    case 'runtime-host':
      return createRuntimeHostDeploymentProvider();

    default:
      throw new Error(`Unknown deployment provider: ${deployment.provider_name}`);
  }
}
