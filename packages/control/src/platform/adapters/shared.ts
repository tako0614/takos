import {
  resolveHostnameRouting,
  selectRouteRefFromHttpEndpointSet,
  selectRouteRefFromRoutingTarget,
} from '../../application/services/routing/index.ts';
import type { RoutingBindings, RoutingStore, RoutingTarget } from '../../application/services/routing/types.ts';
import type {
  ControlPlatform,
  PlatformConfig,
  PlatformDeployProviderConfig,
  PlatformDeployProviderRegistry,
  PlatformObjects,
  PlatformQueues,
  PlatformServiceBinding,
  PlatformServices,
  PlatformSource,
} from '../types.ts';
import type {
  AiBinding,
  DurableNamespaceBinding,
  KvStoreBinding,
  ObjectStoreBinding,
  QueueBinding,
  SqlDatabaseBinding,
  VectorIndexBinding,
} from '../../shared/types/bindings.ts';

type PlatformConfigInput = {
  adminDomain?: string;
  tenantBaseDomain?: string;
  environment?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  platformPrivateKey?: string;
  platformPublicKey?: string;
  encryptionKey?: string;
  serviceInternalJwtIssuer?: string;
};

type PlatformServiceInputs = {
  routingBindings: RoutingBindings;
  sqlBinding?: SqlDatabaseBinding;
  routingStore?: RoutingStore;
  hostnameRouting?: KvStoreBinding;
  queues?: PlatformQueues;
  objects?: PlatformObjects;
  notifications?: PlatformServices['notifications'];
  locks?: PlatformServices['locks'];
  hosts?: PlatformServices['hosts'];
  ai?: {
    binding?: AiBinding;
    vectorize?: VectorIndexBinding;
    openAiApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
  };
  assets?: {
    binding?: PlatformServiceBinding;
  };
  documents?: PlatformServices['documents'];
  serviceRegistry?: {
    get(name: string): PlatformServiceBinding;
  };
  deploymentProviders?: PlatformDeployProviderRegistry;
};

export function createPlatformConfig(input: PlatformConfigInput): PlatformConfig {
  return {
    adminDomain: input.adminDomain ?? '',
    tenantBaseDomain: input.tenantBaseDomain ?? '',
    environment: input.environment,
    googleClientId: input.googleClientId,
    googleClientSecret: input.googleClientSecret,
    platformPrivateKey: input.platformPrivateKey,
    platformPublicKey: input.platformPublicKey,
    encryptionKey: input.encryptionKey,
    serviceInternalJwtIssuer: input.serviceInternalJwtIssuer,
  };
}

export function createDeploymentProviderRegistry(
  providers: PlatformDeployProviderConfig[],
  defaultName?: PlatformDeployProviderRegistry['defaultName'],
): PlatformDeployProviderRegistry | undefined {
  if (providers.length === 0) {
    return undefined;
  }

  return {
    defaultName,
    list() {
      return [...providers];
    },
    get(name) {
      return providers.find((provider) => provider.name === name);
    },
  };
}

export function createRoutingService(bindings: RoutingBindings): PlatformServices['routing'] {
  const selectRouteRef = (target: RoutingTarget, pathname: string, method: string) => {
    if (target.type === 'http-endpoint-set') {
      return selectRouteRefFromHttpEndpointSet(target.endpoints, pathname, method);
    }
    return selectRouteRefFromRoutingTarget(target);
  };

  return {
    resolveHostname(hostname, executionContext) {
      return resolveHostnameRouting({
        env: bindings,
        hostname,
        executionCtx: executionContext,
      });
    },
    selectRouteRef,
  };
}

export function createPlatformServices(input: PlatformServiceInputs): PlatformServices {
  return {
    sql: {
      binding: input.sqlBinding,
    },
    routing: createRoutingService(input.routingBindings),
    routingStore: input.routingStore,
    hostnameRouting: input.hostnameRouting,
    queues: input.queues ?? {},
    objects: input.objects ?? {},
    notifications: input.notifications ?? {},
    locks: input.locks ?? {},
    hosts: input.hosts ?? {},
    ai: input.ai ?? {},
    assets: input.assets ?? {},
    documents: input.documents ?? {},
    serviceRegistry: input.serviceRegistry,
    deploymentProviders: input.deploymentProviders,
  };
}

export function buildPlatform<TBindings extends object>(
  source: PlatformSource,
  bindings: TBindings,
  config: PlatformConfig,
  services: PlatformServices,
): ControlPlatform<TBindings> {
  return {
    source,
    bindings,
    config,
    services,
  };
}
