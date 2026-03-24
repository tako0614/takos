import { type WorkerBinding, WFPService } from '../../../platform/providers/cloudflare/wfp.ts';
import type { PlatformDeployProviderConfig } from '../../../platform/types.ts';
import type {
  Deployment,
  DeploymentProviderName,
  DeploymentProviderRef,
  DeploymentTarget,
  DeploymentTargetArtifact,
  DeploymentTargetEndpoint,
} from './types';

export type DeploymentProviderDeployInput = {
  deployment: Deployment;
  artifactRef: string;
  bundleContent: string;
  wasmContent: ArrayBuffer | null;
  bindings: WorkerBinding[];
  compatibilityDate: string;
  compatibilityFlags: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
};

export type DeploymentProvider = {
  name: DeploymentProviderName;
  deploy(input: DeploymentProviderDeployInput): Promise<void>;
  assertRollbackTarget(artifactRef: string): Promise<void>;
  cleanupDeploymentArtifact?(artifactRef: string): Promise<void>;
};

export type DeploymentProviderConfigRecord = PlatformDeployProviderConfig;

export type DeploymentProviderRegistryLike = {
  get(name: DeploymentProviderName): DeploymentProviderConfigRecord | undefined;
};

type OciDeploymentOrchestratorConfig = {
  orchestratorUrl?: string;
  orchestratorToken?: string;
  fetchImpl?: typeof fetch;
};

export type CloudflareDeploymentProviderEnv = {
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  WFP_DISPATCH_NAMESPACE?: string;
};

type DeploymentProviderFactoryConfig = OciDeploymentOrchestratorConfig & {
  cloudflareEnv?: CloudflareDeploymentProviderEnv;
  providerRegistry?: DeploymentProviderRegistryLike;
};

type PersistedDeploymentContract = Pick<Deployment, 'provider_name' | 'target_json'>;

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
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
    if (typeof parsed.image_ref === 'string' && parsed.image_ref.length > 0) {
      normalized.image_ref = parsed.image_ref;
    }
    if (typeof parsed.exposed_port === 'number' && Number.isFinite(parsed.exposed_port)) {
      normalized.exposed_port = parsed.exposed_port;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  const normalized: DeploymentTargetArtifact = {};
  return Object.keys(normalized).length > 0 ? normalized : undefined;
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
  const normalized = normalizeDeploymentTarget((options?.target ?? {}) as Record<string, unknown>);
  return {
    providerName: options?.provider?.name ?? 'cloudflare',
    targetJson: JSON.stringify(normalized),
    providerStateJson: '{}',
  };
}

export function createCloudflareDeploymentProvider(wfp: WFPService): DeploymentProvider {
  return {
    name: 'cloudflare',
    async deploy(input) {
      if (input.wasmContent) {
        await wfp.createWorkerWithWasm(
          input.artifactRef,
          input.bundleContent,
          input.wasmContent,
          {
            bindings: input.bindings as Array<{
              type: string;
              name: string;
              id?: string;
              bucket_name?: string;
              namespace_id?: string;
              text?: string;
            }>,
            compatibility_date: input.compatibilityDate,
            compatibility_flags: input.compatibilityFlags,
            limits: input.limits,
          },
        );
        return;
      }

      await wfp.createWorker({
        workerName: input.artifactRef,
        workerScript: input.bundleContent,
        bindings: input.bindings,
        compatibility_date: input.compatibilityDate,
        compatibility_flags: input.compatibilityFlags,
        limits: input.limits,
      });
    },
    async assertRollbackTarget(artifactRef) {
      const exists = await wfp.workerExists(artifactRef);
      if (!exists) {
        throw new Error(`Rollback target artifact not found in WFP: ${artifactRef}`);
      }
    },
    async cleanupDeploymentArtifact(artifactRef) {
      await wfp.deleteWorker(artifactRef);
    },
  };
}

export function createOciDeploymentProvider(
  deployment: PersistedDeploymentContract,
  config?: OciDeploymentOrchestratorConfig,
): DeploymentProvider {
  const target = parseDeploymentTargetConfig(deployment);
  const fetchImpl = config?.fetchImpl ?? fetch;

  return {
    name: 'oci',
    async deploy(input) {
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
      const orchestratorUrl = config?.orchestratorUrl?.trim();
      const imageRef = target.artifact?.image_ref?.trim();

      if (!imageRef) {
        if (externalBaseUrl) {
          return;
        }
        return;
      }

      if (!orchestratorUrl) {
        throw new Error('OCI deployment target requires OCI_ORCHESTRATOR_URL');
      }

      const response = await fetchImpl(orchestratorUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config?.orchestratorToken ? { Authorization: `Bearer ${config.orchestratorToken}` } : {}),
        },
        body: JSON.stringify({
          deployment_id: input.deployment.id,
          space_id: input.deployment.space_id,
          artifact_ref: input.artifactRef,
          target: {
            route_ref: target.route_ref ?? serviceRef,
            endpoint: {
              kind: externalBaseUrl ? 'http-url' : 'service-ref',
              ...(externalBaseUrl ? { base_url: externalBaseUrl } : { ref: serviceRef }),
            },
            artifact: {
              image_ref: imageRef,
              exposed_port: exposedPort ?? undefined,
            },
          },
          runtime: {
            compatibility_date: input.compatibilityDate,
            compatibility_flags: input.compatibilityFlags,
            limits: input.limits ?? null,
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OCI deployment orchestrator failed with ${response.status}: ${body.slice(0, 300)}`);
      }
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
  const registryEntry = config.providerRegistry?.get(deployment.provider_name);

  if (deployment.provider_name === 'oci') {
    return createOciDeploymentProvider(deployment, {
      orchestratorUrl: registryEntry?.name === 'oci'
        ? registryEntry.config.orchestratorUrl
        : config.orchestratorUrl,
      orchestratorToken: registryEntry?.name === 'oci'
        ? registryEntry.config.orchestratorToken
        : config.orchestratorToken,
      fetchImpl: config.fetchImpl,
    });
  }

  const cloudflareEnv = config.cloudflareEnv;
  const accountId = registryEntry?.name === 'cloudflare'
    ? registryEntry.config.accountId
    : cloudflareEnv?.CF_ACCOUNT_ID;
  const apiToken = registryEntry?.name === 'cloudflare'
    ? registryEntry.config.apiToken
    : cloudflareEnv?.CF_API_TOKEN;
  const dispatchNamespace = registryEntry?.name === 'cloudflare'
    ? registryEntry.config.dispatchNamespace
    : cloudflareEnv?.WFP_DISPATCH_NAMESPACE;

  if (!accountId || !apiToken || !dispatchNamespace) {
    throw new Error('Cloudflare deployment target requires WFP environment');
  }

  return createCloudflareDeploymentProvider(new WFPService({
    CF_ACCOUNT_ID: accountId,
    CF_API_TOKEN: apiToken,
    WFP_DISPATCH_NAMESPACE: dispatchNamespace,
  }));
}
