import {
  selectDeploymentTargetFromRoutingTarget,
  selectRouteRefFromHttpEndpointSet,
  selectRouteRefFromRoutingTarget,
} from '../../application/services/routing/index.ts';
import type { RoutingStore, RoutingTarget } from '../../application/services/routing/types.ts';
import type {
  ControlPlatform,
  PlatformConfig,
  PlatformDeployProviderConfig,
  PlatformDeployProviderRegistry,
  PlatformServiceBinding,
  PlatformServices,
  PlatformSource,
} from '../types.ts';

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
  routing: PlatformServices['routing'];
  sqlBinding?: NonNullable<PlatformServices['sql']>['binding'];
  routingStore?: RoutingStore;
  hostnameRouting?: PlatformServices['hostnameRouting'];
  queues?: PlatformServices['queues'];
  objects?: PlatformServices['objects'];
  notifications?: PlatformServices['notifications'];
  locks?: PlatformServices['locks'];
  hosts?: PlatformServices['hosts'];
  ai?: PlatformServices['ai'];
  assets?: PlatformServices['assets'];
  documents?: PlatformServices['documents'];
  serviceRegistry?: {
    get(name: string, options?: { deploymentId?: string }): PlatformServiceBinding;
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

export function createRoutingService(options: {
  resolveHostname: PlatformServices['routing']['resolveHostname'];
}): PlatformServices['routing'] {
  const selectDeploymentTarget = (target: RoutingTarget, pathname: string, method: string) => {
    if (target.type === 'http-endpoint-set') {
      const routeRef = selectRouteRefFromHttpEndpointSet(target.endpoints, pathname, method);
      return routeRef ? { routeRef, weight: 100, status: 'active' as const } : null;
    }
    return selectDeploymentTargetFromRoutingTarget(target);
  };
  const selectRouteRef = (target: RoutingTarget, pathname: string, method: string) => {
    return selectDeploymentTarget(target, pathname, method)?.routeRef
      ?? (target.type === 'http-endpoint-set'
        ? selectRouteRefFromHttpEndpointSet(target.endpoints, pathname, method)
        : selectRouteRefFromRoutingTarget(target));
  };

  return {
    resolveHostname: options.resolveHostname,
    selectDeploymentTarget,
    selectRouteRef,
  };
}

export function createPlatformServices(input: PlatformServiceInputs): PlatformServices {
  return {
    sql: {
      binding: input.sqlBinding,
    },
    routing: input.routing,
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
