import {
  resolveHostnameRouting,
  selectDeploymentTargetFromRoutingTarget,
  selectRouteRefFromHttpEndpointSet,
  selectRouteRefFromRoutingTarget,
} from "../../application/services/routing/service.ts";
import type {
  RoutingStore,
  RoutingTarget,
} from "../../application/services/routing/routing-models.ts";
import type { Env } from "../../shared/types/index.ts";
import type {
  ControlPlatform,
  PlatformConfig,
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

/**
 * Single home for the platform config map + service wiring that the node and
 * workers adapters previously duplicated byte-for-byte. Each adapter now passes
 * only its genuine differences: the source label, the (already-resolved)
 * runtime/executor host bindings, and the Node-only SSE notifier. "Add a
 * binding" is now a one-line change here instead of a lockstep edit across both
 * builders.
 */
export function buildPlatformFromEnv<TBindings extends object>(
  bindings: TBindings & PlatformEnvIndex,
  options: {
    source: PlatformSource;
    runtimeHost: PlatformServiceBinding | undefined;
    executorHost: PlatformServiceBinding | undefined;
    sseNotifier?: PlatformServices["sseNotifier"];
  },
): ControlPlatform<TBindings> {
  const config = createPlatformConfig({
    adminDomain: getString(bindings, "ADMIN_DOMAIN"),
    tenantBaseDomain: getString(bindings, "TENANT_BASE_DOMAIN"),
    environment: getString(bindings, "ENVIRONMENT"),
    oidcIssuerUrl: getString(bindings, "OIDC_ISSUER_URL"),
    oidcDiscoveryUrl: getString(bindings, "OIDC_DISCOVERY_URL"),
    oidcClientId: getString(bindings, "OIDC_CLIENT_ID"),
    oidcClientSecret: getString(bindings, "OIDC_CLIENT_SECRET"),
    oidcRedirectUri: getString(bindings, "OIDC_REDIRECT_URI"),
    platformPrivateKey: getString(bindings, "PLATFORM_PRIVATE_KEY"),
    platformPublicKey: getString(bindings, "PLATFORM_PUBLIC_KEY"),
    encryptionKey: getString(bindings, "ENCRYPTION_KEY"),
    serviceInternalJwtIssuer: getString(bindings, "SERVICE_INTERNAL_JWT_ISSUER"),
  });

  const services = createPlatformServices({
    routing: createRoutingService({
      resolveHostname(hostname, executionContext) {
        return resolveHostnameRouting({
          env: bindings,
          hostname,
          executionCtx: executionContext,
        });
      },
    }),
    sqlBinding: bindings.DB as Env["DB"] | undefined,
    routingStore: bindings.ROUTING_STORE as Env["ROUTING_STORE"] | undefined,
    hostnameRouting: bindings.HOSTNAME_ROUTING as
      | Env["HOSTNAME_ROUTING"]
      | undefined,
    queues: {
      runs: bindings.RUN_QUEUE as Env["RUN_QUEUE"] | undefined,
      index: bindings.INDEX_QUEUE as Env["INDEX_QUEUE"] | undefined,
      workflow: bindings.WORKFLOW_QUEUE as Env["WORKFLOW_QUEUE"] | undefined,
      deployment: bindings.DEPLOY_QUEUE as Env["DEPLOY_QUEUE"] | undefined,
    },
    objects: {
      gitObjects: bindings.GIT_OBJECTS as Env["GIT_OBJECTS"] | undefined,
      offload: bindings.TAKOS_OFFLOAD as Env["TAKOS_OFFLOAD"] | undefined,
      tenantSource: bindings.TENANT_SOURCE as Env["TENANT_SOURCE"] | undefined,
      workerBundles: bindings.WORKER_BUNDLES as Env["WORKER_BUNDLES"] | undefined,
      tenantBuilds: bindings.TENANT_BUILDS as Env["TENANT_BUILDS"] | undefined,
    },
    notifications: {
      runNotifier: bindings.RUN_NOTIFIER as Env["RUN_NOTIFIER"] | undefined,
      sessionStore: bindings.SESSION_DO as Env["SESSION_DO"] | undefined,
      notificationNotifier: bindings.NOTIFICATION_NOTIFIER as
        | Env["NOTIFICATION_NOTIFIER"]
        | undefined,
    },
    locks: {
      rateLimiter: bindings.RATE_LIMITER_DO as
        | Env["RATE_LIMITER_DO"]
        | undefined,
    },
    hosts: {
      runtimeHost: options.runtimeHost,
      executorHost: options.executorHost,
    },
    ai: {
      binding: bindings.AI as Env["AI"] | undefined,
      vectorize: bindings.VECTORIZE as Env["VECTORIZE"] | undefined,
      openAiApiKey: getString(bindings, "OPENAI_API_KEY"),
      anthropicApiKey: getString(bindings, "ANTHROPIC_API_KEY"),
      googleApiKey: getString(bindings, "GOOGLE_API_KEY"),
    },
    assets: {
      binding: bindings.ASSETS as PlatformServiceBinding | undefined,
    },
    documents: {},
    serviceRegistry: getServiceRegistry(bindings),
    sseNotifier: options.sseNotifier,
  });

  return buildPlatform(options.source, bindings, config, services);
}
