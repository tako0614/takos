import {
  selectDeploymentTargetFromRoutingTarget,
  selectRouteRefFromHttpEndpointSet,
  selectRouteRefFromRoutingTarget,
} from "../../application/services/routing/service.ts";
import type {
  RoutingStore,
  RoutingTarget,
} from "../../application/services/routing/routing-models.ts";
import type {
  ControlPlatform,
  PlatformConfig,
  PlatformDeployBackendRegistry,
  PlatformServiceBinding,
  PlatformServices,
  PlatformSource,
} from "../platform-config.ts";

/**
 * The adapters read wrangler-style bindings by string key (e.g., `env.DB`,
 * `env.RUN_QUEUE`). Intersecting a concrete env interface with this index
 * signature lets the generic builder read those keys without per-property
 * casts. The concrete public wrappers still pin `TBindings` to a specific
 * env type so callers see the right return shape.
 */
export type PlatformEnvIndex = Record<string, unknown>;

export function getString(env: object, key: string): string | undefined {
  const value = Reflect.get(env, key);
  return typeof value === "string" ? value : undefined;
}

export function getServiceRegistry(env: object) {
  const dispatcher = Reflect.get(env, "DISPATCHER");
  if (!dispatcher || typeof dispatcher !== "object") {
    return undefined;
  }
  return {
    get(name: string, options?: { deploymentId?: string }) {
      return (dispatcher as {
        get(
          name: string,
          options?: { deploymentId?: string },
        ): PlatformServiceBinding;
      }).get(name, options);
    },
  };
}

type PlatformConfigInput = {
  adminDomain?: string;
  tenantBaseDomain?: string;
  environment?: string;
  oidcIssuerUrl?: string;
  oidcDiscoveryUrl?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  oidcRedirectUri?: string;
  platformPrivateKey?: string;
  platformPublicKey?: string;
  encryptionKey?: string;
  serviceInternalJwtIssuer?: string;
};

type PlatformServiceInputs = {
  routing: PlatformServices["routing"];
  sqlBinding?: NonNullable<PlatformServices["sql"]>["binding"];
  routingStore?: RoutingStore;
  hostnameRouting?: PlatformServices["hostnameRouting"];
  deploymentBackends?: PlatformDeployBackendRegistry;
  queues?: PlatformServices["queues"];
  objects?: PlatformServices["objects"];
  notifications?: PlatformServices["notifications"];
  locks?: PlatformServices["locks"];
  hosts?: PlatformServices["hosts"];
  ai?: PlatformServices["ai"];
  assets?: PlatformServices["assets"];
  documents?: PlatformServices["documents"];
  serviceRegistry?: {
    get(
      name: string,
      options?: { deploymentId?: string },
    ): PlatformServiceBinding;
  };
  sseNotifier?: PlatformServices["sseNotifier"];
};

export function createPlatformConfig(
  input: PlatformConfigInput,
): PlatformConfig {
  return {
    adminDomain: input.adminDomain ?? "",
    tenantBaseDomain: input.tenantBaseDomain ?? "",
    environment: input.environment,
    oidcIssuerUrl: input.oidcIssuerUrl,
    oidcDiscoveryUrl: input.oidcDiscoveryUrl,
    oidcClientId: input.oidcClientId,
    oidcClientSecret: input.oidcClientSecret,
    oidcRedirectUri: input.oidcRedirectUri,
    platformPrivateKey: input.platformPrivateKey,
    platformPublicKey: input.platformPublicKey,
    encryptionKey: input.encryptionKey,
    serviceInternalJwtIssuer: input.serviceInternalJwtIssuer,
  };
}

export function createRoutingService(options: {
  resolveHostname: PlatformServices["routing"]["resolveHostname"];
}): PlatformServices["routing"] {
  const selectDeploymentTarget = (
    target: RoutingTarget,
    pathname: string,
    method: string,
  ) => {
    if (target.type === "http-endpoint-set") {
      const routeRef = selectRouteRefFromHttpEndpointSet(
        target.endpoints,
        pathname,
        method,
      );
      return routeRef
        ? { routeRef, weight: 100, status: "active" as const }
        : null;
    }
    return selectDeploymentTargetFromRoutingTarget(target);
  };
  const selectRouteRef = (
    target: RoutingTarget,
    pathname: string,
    method: string,
  ) => {
    return selectDeploymentTarget(target, pathname, method)?.routeRef ??
      (target.type === "http-endpoint-set"
        ? selectRouteRefFromHttpEndpointSet(target.endpoints, pathname, method)
        : selectRouteRefFromRoutingTarget(target));
  };

  return {
    resolveHostname: options.resolveHostname,
    selectDeploymentTarget,
    selectRouteRef,
  };
}

export function createPlatformServices(
  input: PlatformServiceInputs,
): PlatformServices {
  return {
    sql: {
      binding: input.sqlBinding,
    },
    routing: input.routing,
    routingStore: input.routingStore,
    hostnameRouting: input.hostnameRouting,
    deploymentBackends: input.deploymentBackends,
    queues: input.queues ?? {},
    objects: input.objects ?? {},
    notifications: input.notifications ?? {},
    locks: input.locks ?? {},
    hosts: input.hosts ?? {},
    ai: input.ai ?? {},
    assets: input.assets ?? {},
    documents: input.documents ?? {},
    serviceRegistry: input.serviceRegistry,
    sseNotifier: input.sseNotifier,
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
