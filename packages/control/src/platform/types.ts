import type { DeploymentProviderName } from '../application/services/deployment/types.ts';
import type {
  ResolvedRouting,
  RoutingStore,
  RoutingTarget,
  WeightedDeploymentTarget,
} from '../application/services/routing/types.ts';
import type {
  AiBinding,
  DurableNamespaceBinding,
  KvStoreBinding,
  ObjectStoreBinding,
  PlatformExecutionContext,
  QueueBinding,
  SqlDatabaseBinding,
  VectorIndexBinding,
} from '../shared/types/bindings.ts';

export type PlatformSource = 'cloudflare' | 'local' | 'aws' | 'gcp' | 'kubernetes';

export type PlatformServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type CloudflarePlatformDeployProviderConfig = {
  name: 'cloudflare';
  config: {
    accountId: string;
    apiToken: string;
    dispatchNamespace: string;
    zoneId?: string;
  };
};

export type OciPlatformDeployProviderConfig = {
  name: 'oci';
  config: {
    orchestratorUrl: string;
    orchestratorToken?: string;
  };
};

export type EcsPlatformDeployProviderConfig = {
  name: 'ecs';
  config: {
    region: string;
    clusterArn: string;
    taskDefinitionFamily: string;
    serviceArn?: string;
    ecrRepositoryUri?: string;
  };
};

export type CloudRunPlatformDeployProviderConfig = {
  name: 'cloud-run';
  config: {
    projectId: string;
    region: string;
    serviceId?: string;
    artifactRegistryRepo?: string;
  };
};

export type KubernetesPlatformDeployProviderConfig = {
  name: 'kubernetes';
  config: {
    namespace: string;
    deploymentName?: string;
    imageRegistry?: string;
  };
};

export type PlatformDeployProviderConfig =
  | CloudflarePlatformDeployProviderConfig
  | OciPlatformDeployProviderConfig
  | EcsPlatformDeployProviderConfig
  | CloudRunPlatformDeployProviderConfig
  | KubernetesPlatformDeployProviderConfig;

export type PlatformDeployProviderRegistry = {
  defaultName?: DeploymentProviderName;
  list(): PlatformDeployProviderConfig[];
  get(name: DeploymentProviderName): PlatformDeployProviderConfig | undefined;
};

export type PlatformConfig = {
  adminDomain: string;
  tenantBaseDomain: string;
  environment?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  platformPrivateKey?: string;
  platformPublicKey?: string;
  encryptionKey?: string;
  serviceInternalJwtIssuer?: string;
};

export type PlatformRoutingService = {
  resolveHostname(hostname: string, executionContext: PlatformExecutionContext): Promise<ResolvedRouting>;
  selectDeploymentTarget(target: RoutingTarget, pathname: string, method: string): WeightedDeploymentTarget | null;
  selectRouteRef(target: RoutingTarget, pathname: string, method: string): string | null;
};

export type PlatformQueues = {
  runs?: QueueBinding;
  index?: QueueBinding;
  workflow?: QueueBinding;
  deployment?: QueueBinding;
};

export type PlatformObjects = {
  gitObjects?: ObjectStoreBinding;
  offload?: ObjectStoreBinding;
  tenantSource?: ObjectStoreBinding;
  workerBundles?: ObjectStoreBinding;
  tenantBuilds?: ObjectStoreBinding;
  uiBundles?: ObjectStoreBinding;
};

export type PlatformServices = {
  sql?: { binding?: SqlDatabaseBinding };
  routing: PlatformRoutingService;
  routingStore?: RoutingStore;
  hostnameRouting?: KvStoreBinding;
  queues: PlatformQueues;
  objects: PlatformObjects;
  notifications: {
    runNotifier?: DurableNamespaceBinding;
    sessionStore?: DurableNamespaceBinding;
    notificationNotifier?: DurableNamespaceBinding;
  };
  locks: {
    gitPushLock?: DurableNamespaceBinding;
    rateLimiter?: DurableNamespaceBinding;
  };
  hosts: {
    runtimeHost?: PlatformServiceBinding;
    executorHost?: PlatformServiceBinding;
    browserHost?: PlatformServiceBinding;
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
    get(name: string, options?: { deploymentId?: string }): PlatformServiceBinding;
  };
  deploymentProviders?: PlatformDeployProviderRegistry;
};

export type ControlPlatform<TBindings = unknown> = {
  source: PlatformSource;
  bindings: TBindings;
  config: PlatformConfig;
  services: PlatformServices;
};
