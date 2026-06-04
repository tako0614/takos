import type {
  ResolvedRouting,
  RoutingStore,
  RoutingTarget,
  WeightedDeploymentTarget,
} from "../application/services/routing/routing-models.ts";
import type {
  AiBinding,
  DurableNamespaceBinding,
  KvStoreBinding,
  MessageQueueBinding,
  ObjectStoreBinding,
  PlatformExecutionContext,
  SqlDatabaseBinding,
  VectorIndexBinding,
} from "../shared/types/bindings.ts";

export type PlatformSource = "workers" | "node";

export type PlatformServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type WorkersDispatchDeployBackendConfig = {
  name: "workers-dispatch";
  config: {
    accountId: string;
    apiToken: string;
    dispatchNamespace: string;
    zoneId?: string;
  };
};

export type PlatformDeployBackendConfig = WorkersDispatchDeployBackendConfig;

export type PlatformDeployBackendRegistry = {
  defaultName: PlatformDeployBackendConfig["name"];
  list(): PlatformDeployBackendConfig[];
  get(name: string): PlatformDeployBackendConfig | undefined;
};

export type PlatformConfig = {
  adminDomain: string;
  tenantBaseDomain: string;
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

export type PlatformRoutingService = {
  resolveHostname(
    hostname: string,
    executionContext: PlatformExecutionContext,
  ): Promise<ResolvedRouting>;
  selectDeploymentTarget(
    target: RoutingTarget,
    pathname: string,
    method: string,
  ): WeightedDeploymentTarget | null;
  selectRouteRef(
    target: RoutingTarget,
    pathname: string,
    method: string,
  ): string | null;
};

export type PlatformQueues = {
  runs?: MessageQueueBinding;
  index?: MessageQueueBinding;
  workflow?: MessageQueueBinding;
  deployment?: MessageQueueBinding;
};

export type PlatformObjects = {
  gitObjects?: ObjectStoreBinding;
  offload?: ObjectStoreBinding;
  tenantSource?: ObjectStoreBinding;
  workerBundles?: ObjectStoreBinding;
  tenantBuilds?: ObjectStoreBinding;
};

export type PlatformServices = {
  sql?: { binding?: SqlDatabaseBinding };
  routing: PlatformRoutingService;
  routingStore?: RoutingStore;
  hostnameRouting?: KvStoreBinding;
  deploymentBackends?: PlatformDeployBackendRegistry;
  queues: PlatformQueues;
  objects: PlatformObjects;
  notifications: {
    runNotifier?: DurableNamespaceBinding;
    sessionStore?: DurableNamespaceBinding;
    notificationNotifier?: DurableNamespaceBinding;
  };
  locks: {
    rateLimiter?: DurableNamespaceBinding;
  };
  hosts: {
    runtimeHost?: PlatformServiceBinding;
    executorHost?: PlatformServiceBinding;
  };
  ai: {
    binding?: AiBinding;
    vectorize?: VectorIndexBinding;
    openAiApiKey?: string;
    anthropicApiKey?: string;
    googleApiKey?: string;
  };
  assets: {
    binding?: PlatformServiceBinding;
  };
  documents: {
    renderPdf?: (html: string) => Promise<ArrayBuffer>;
  };
  serviceRegistry?: {
    get(
      name: string,
      options?: { deploymentId?: string },
    ): PlatformServiceBinding;
  };
  /** SSE-based event notifier for Node.js environments (WebSocket alternative). */
  sseNotifier?: {
    emit(
      channel: string,
      event: { type: string; data: unknown; event_id?: number },
    ): void;
    subscribe(
      channel: string,
      lastEventId?: number,
    ): ReadableStream<Uint8Array>;
  };
};

export type ControlPlatform<TBindings = unknown> = {
  source: PlatformSource;
  bindings: TBindings;
  config: PlatformConfig;
  services: PlatformServices;
};
