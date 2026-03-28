import { type WorkerBinding, WFPService } from '../../../platform/providers/cloudflare/wfp.ts';
import type { PlatformDeployProviderConfig } from '../../../platform/platform-config.ts';
import { logWarn } from '../../../shared/utils/logger.ts';
import type {
  ArtifactKind,
  Deployment,
  DeploymentProviderName,
  DeploymentProviderRef,
  DeploymentTarget,
  DeploymentTargetArtifact,
  DeploymentTargetEndpoint,
} from './models';

export type DeploymentProviderDeployResult = {
  resolvedEndpoint?: { kind: 'http-url'; base_url: string };
  logsRef?: string;
};

export type DeploymentProviderDeployInput = {
  deployment: Deployment;
  artifactRef: string;
  bundleContent?: string;
  wasmContent: ArrayBuffer | null;
  bindings: WorkerBinding[];
  compatibilityDate: string;
  compatibilityFlags: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
};

export type DeploymentProvider = {
  name: DeploymentProviderName;
  deploy(input: DeploymentProviderDeployInput): Promise<DeploymentProviderDeployResult | void>;
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

export type WfpDeploymentProviderEnv = {
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  WFP_DISPATCH_NAMESPACE?: string;
};

type DeploymentProviderFactoryConfig = OciDeploymentOrchestratorConfig & {
  cloudflareEnv?: WfpDeploymentProviderEnv;
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
      if (input.wasmContent) {
        await wfp.workers.createWorkerWithWasm(
          input.artifactRef,
          input.bundleContent || '',
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

      await wfp.workers.createWorker({
        workerName: input.artifactRef,
        workerScript: input.bundleContent || '',
        bindings: input.bindings,
        compatibility_date: input.compatibilityDate,
        compatibility_flags: input.compatibilityFlags,
        limits: input.limits,
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

      const response = await fetchImpl(deployUrl, {
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
              health_path: healthPath,
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

  if (deployment.provider_name === 'oci'
    || deployment.provider_name === 'ecs'
    || deployment.provider_name === 'cloud-run'
    || deployment.provider_name === 'k8s') {
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

  const wfpEnv = config.cloudflareEnv;
  const accountId = registryEntry?.name === 'workers-dispatch'
    ? registryEntry.config.accountId
    : wfpEnv?.CF_ACCOUNT_ID;
  const apiToken = registryEntry?.name === 'workers-dispatch'
    ? registryEntry.config.apiToken
    : wfpEnv?.CF_API_TOKEN;
  const dispatchNamespace = registryEntry?.name === 'workers-dispatch'
    ? registryEntry.config.dispatchNamespace
    : wfpEnv?.WFP_DISPATCH_NAMESPACE;

  if (!accountId || !apiToken || !dispatchNamespace) {
    throw new Error('workers-dispatch deployment requires WFP environment');
  }

  return createWorkersDispatchDeploymentProvider(new WFPService({
    CF_ACCOUNT_ID: accountId,
    CF_API_TOKEN: apiToken,
    WFP_DISPATCH_NAMESPACE: dispatchNamespace,
  }));
}
