import type {
  AiBinding,
  DurableNamespaceBinding,
  KvStoreBinding,
  ObjectStoreBinding,
  QueueBinding,
  SqlDatabaseBinding,
  VectorIndexBinding,
} from "./bindings.ts";
import type {
  DeploymentQueueMessage,
  IndexJobQueueMessage,
  RunQueueMessage,
  WorkflowJobQueueMessage,
} from "./queue-messages.ts";
import type { RoutingStore } from "./routing.ts";

// ---------------------------------------------------------------------------
// Env fragments — each groups related bindings by concern.
// Workers that need only a subset can compose from these fragments
// instead of depending on the full Env.
// ---------------------------------------------------------------------------

export interface DbEnv {
  DB: SqlDatabaseBinding;
}

export interface StorageEnv {
  GIT_OBJECTS?: ObjectStoreBinding;
  TAKOS_OFFLOAD?: ObjectStoreBinding;
  TENANT_SOURCE?: ObjectStoreBinding;
  WORKER_BUNDLES?: ObjectStoreBinding;
  TENANT_BUILDS?: ObjectStoreBinding;
}

export interface AiEnv {
  VECTORIZE?: VectorIndexBinding;
  AI?: AiBinding;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  SERPER_API_KEY?: string;
}

export interface AgentConfigEnv {
  MAX_AGENT_ITERATIONS?: string;
  AGENT_TEMPERATURE?: string;
  AGENT_RATE_LIMIT?: string;
  AGENT_ITERATION_TIMEOUT?: string;
  AGENT_TOTAL_TIMEOUT?: string;
  TOOL_EXECUTION_TIMEOUT?: string;
  LANGGRAPH_TIMEOUT?: string;
  APP_DEPLOY_REMOTE_MAX_PACKFILE_BYTES?: string;
  APP_DEPLOY_REMOTE_MAX_OBJECTS?: string;
  APP_DEPLOY_REMOTE_MAX_INFLATED_TOTAL_BYTES?: string;
  APP_DEPLOY_REMOTE_MAX_OBJECT_INFLATED_BYTES?: string;
  APP_DEPLOY_REMOTE_MAX_DELTA_RESULT_BYTES?: string;
  APP_DEPLOY_REMOTE_MAX_DELTA_CHAIN_DEPTH?: string;
  APP_DEPLOY_REMOTE_MAX_ARCHIVE_BYTES?: string;
  /** JSON object mapping model IDs to context window sizes, e.g. {"gpt-5.4":200} */
  MODEL_CONTEXT_WINDOWS?: string;
}

export type FetchBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export interface ContainerHostEnv {
  RUNTIME_HOST?: FetchBinding;
  EXECUTOR_HOST?: FetchBinding;
  /**
   * Egress proxy used by the web tool (`application/tools/custom/web.ts`) and
   * the executor host (`runtime/container-hosts/executor-host.ts` /
   * `executor-utils.ts`). Bound to the `takos-worker` service in production via
   * `apps/control/wrangler.toml [[services]] binding = "TAKOS_EGRESS"`.
   * Optional because local-platform tests substitute a passthrough fetch.
   */
  TAKOS_EGRESS?: FetchBinding;
}

// ---------------------------------------------------------------------------
// Narrow Env types — used by individual worker entrypoints that only need a
// subset of the full Env bindings.
// ---------------------------------------------------------------------------

export type RunnerEnv = DbEnv & {
  EXECUTOR_HOST?: FetchBinding;
  RUN_QUEUE: QueueBinding<RunQueueMessage>;
  RUN_NOTIFIER: DurableNamespaceBinding;
  TAKOS_OFFLOAD?: ObjectStoreBinding;
};

export type IndexerEnv = DbEnv & {
  AI?: AiBinding;
  VECTORIZE?: VectorIndexBinding;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GIT_OBJECTS?: ObjectStoreBinding;
  TAKOS_OFFLOAD?: ObjectStoreBinding;
  TENANT_SOURCE?: ObjectStoreBinding;
  INDEX_QUEUE?: QueueBinding<IndexJobQueueMessage>;
};

// ---------------------------------------------------------------------------
// Full Env — union of all fragments plus remaining bindings.
// Structurally identical to the previous monolithic definition,
// so all existing code continues to type-check without changes.
// ---------------------------------------------------------------------------

export interface Env
  extends DbEnv, StorageEnv, AiEnv, AgentConfigEnv, ContainerHostEnv {
  // Internal service config
  SERVICE_INTERNAL_JWT_ISSUER?: string;
  // DO bindings
  SESSION_DO: DurableNamespaceBinding;
  RUN_NOTIFIER: DurableNamespaceBinding;
  NOTIFICATION_NOTIFIER?: DurableNamespaceBinding;
  RATE_LIMITER_DO?: DurableNamespaceBinding;
  ROUTING_DO: DurableNamespaceBinding;
  ROUTING_DO_PHASE?: string;
  GIT_PUSH_LOCK?: DurableNamespaceBinding;
  // Queues
  RUN_QUEUE: QueueBinding<RunQueueMessage>;
  INDEX_QUEUE?: QueueBinding<IndexJobQueueMessage>;
  WORKFLOW_QUEUE?: QueueBinding<WorkflowJobQueueMessage>;
  DEPLOY_QUEUE?: QueueBinding<DeploymentQueueMessage>;
  // Platform config
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ADMIN_DOMAIN: string;
  /**
   * Optional operator-controlled origin for server-to-server calls from tenant
   * workers back into Takos. ADMIN_DOMAIN remains the public OAuth issuer.
   */
  TAKOS_INTERNAL_API_URL?: string;
  TENANT_BASE_DOMAIN: string;
  PLATFORM_PRIVATE_KEY: string;
  PLATFORM_PUBLIC_KEY: string;
  /** Compatibility override for runtime-service JWT verification; prefer PLATFORM_PUBLIC_KEY. */
  JWT_PUBLIC_KEY?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  WFP_DISPATCH_NAMESPACE?: string;
  CF_ZONE_ID?: string;
  /**
   * Custom domain TLS provider for operator-managed hostnames.
   * Defaults to "cloudflare" when CF_ZONE_ID is present, otherwise "none".
   */
  TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER?: string;
  OCI_ORCHESTRATOR_URL?: string;
  OCI_ORCHESTRATOR_TOKEN?: string;
  AWS_REGION?: string;
  AWS_ECS_REGION?: string;
  AWS_ECS_CLUSTER_ARN?: string;
  AWS_ECS_TASK_DEFINITION_FAMILY?: string;
  AWS_ECS_SERVICE_ARN?: string;
  AWS_ECS_SERVICE_NAME?: string;
  AWS_ECS_CONTAINER_NAME?: string;
  AWS_ECS_SUBNET_IDS?: string;
  AWS_ECS_SECURITY_GROUP_IDS?: string;
  AWS_ECS_ASSIGN_PUBLIC_IP?: string;
  AWS_ECS_LAUNCH_TYPE?: string;
  AWS_ECS_DESIRED_COUNT?: string;
  AWS_ECS_BASE_URL?: string;
  AWS_ECS_HEALTH_URL?: string;
  AWS_ECR_REPOSITORY_URI?: string;
  GCP_PROJECT_ID?: string;
  GCP_REGION?: string;
  GCP_CLOUD_RUN_REGION?: string;
  GCP_CLOUD_RUN_SERVICE_ID?: string;
  GCP_CLOUD_RUN_SERVICE_ACCOUNT?: string;
  GCP_CLOUD_RUN_INGRESS?: string;
  GCP_CLOUD_RUN_ALLOW_UNAUTHENTICATED?: string;
  GCP_CLOUD_RUN_BASE_URL?: string;
  GCP_CLOUD_RUN_DELETE_ON_REMOVE?: string;
  GCP_ARTIFACT_REGISTRY_REPO?: string;
  K8S_NAMESPACE?: string;
  K8S_DEPLOYMENT_NAME?: string;
  K8S_IMAGE_REGISTRY?: string;
  TAKOS_APP_DEPLOY_REMOTE_PACKFILE_MAX_BYTES?: string;
  TAKOS_APP_DEPLOY_REMOTE_OBJECTS_MAX?: string;
  TAKOS_APP_DEPLOY_REMOTE_INFLATED_TOTAL_MAX_BYTES?: string;
  TAKOS_APP_DEPLOY_REMOTE_OBJECT_MAX_BYTES?: string;
  TAKOS_APP_DEPLOY_REMOTE_DELTA_RESULT_MAX_BYTES?: string;
  TAKOS_APP_DEPLOY_REMOTE_DELTA_CHAIN_MAX_DEPTH?: string;
  TAKOS_APP_DEPLOY_REMOTE_BLOB_PACKFILE_MAX_BYTES?: string;
  TAKOS_APP_DEPLOY_REMOTE_BLOB_OBJECTS_MAX?: string;
  TAKOS_APP_DEPLOY_REMOTE_BLOB_INFLATED_TOTAL_MAX_BYTES?: string;
  TAKOS_APP_DEPLOY_REMOTE_BLOB_OBJECT_MAX_BYTES?: string;
  TAKOS_APP_DEPLOY_REMOTE_BLOB_DELTA_RESULT_MAX_BYTES?: string;
  TAKOS_APP_DEPLOY_REMOTE_BLOB_DELTA_CHAIN_MAX_DEPTH?: string;
  TAKOS_APP_DEPLOY_REMOTE_ARCHIVE_MAX_BYTES?: string;
  /** Operator-replaceable default app distribution JSON; wins over DB config. */
  TAKOS_DEFAULT_APP_DISTRIBUTION_JSON?: string;
  /** Operator-replaceable default app repository list JSON; wins over DB config. */
  TAKOS_DEFAULT_APP_REPOSITORIES_JSON?: string;
  /** Set to "false" to skip default app preinstall on new spaces. */
  TAKOS_DEFAULT_APPS_PREINSTALL?: string;
  /** Default git ref for preinstalled default app repositories. */
  TAKOS_DEFAULT_APP_REF?: string;
  TAKOS_DEFAULT_APP_REF_TYPE?: string;
  TAKOS_DEFAULT_APP_BACKEND?: string;
  TAKOS_DEFAULT_APP_ENV?: string;
  TAKOS_DEFAULT_DOCS_APP_REPOSITORY_URL?: string;
  TAKOS_DEFAULT_EXCEL_APP_REPOSITORY_URL?: string;
  TAKOS_DEFAULT_SLIDE_APP_REPOSITORY_URL?: string;
  TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL?: string;
  TAKOS_DEFAULT_YURUCOMMU_APP_REPOSITORY_URL?: string;
  HOSTNAME_ROUTING: KvStoreBinding;
  ROLLOUT_HEALTH_KV?: KvStoreBinding;
  ROUTING_STORE?: RoutingStore;
  DISPATCHER?: {
    get(name: string): { fetch(request: Request): Promise<Response> };
  };
  // Assets
  ASSETS?: FetchBinding;
  // Security
  ENCRYPTION_KEY?: string;
  /** Shared secret for non-loopback internal HTTP endpoints on control-web. */
  TAKOS_INTERNAL_API_SECRET?: string;
  /** Shared secret for takos-executor-host -> takos internal executor RPC. */
  EXECUTOR_PROXY_SECRET?: string;
  AUDIT_IP_HASH_KEY?: string;
  // Billing
  /** Active payment processor name. Defaults to 'stripe'. */
  BILLING_PROCESSOR?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PLUS_PRICE_ID?: string;
  STRIPE_PRO_TOPUP_PACKS_JSON?: string;
  // Bot protection
  TURNSTILE_SECRET_KEY?: string;
  // Misc
  /** Set to "development" to bypass HTTPS enforcement (operator-controlled, not client-controlled) */
  ENVIRONMENT?: string;
}
