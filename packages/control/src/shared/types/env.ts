import type {
  AiBinding,
  DurableNamespaceBinding,
  KvStoreBinding,
  ObjectStoreBinding,
  QueueBinding,
  SqlDatabaseBinding,
  VectorIndexBinding,
} from './bindings';
import type {
  RunQueueMessage,
  IndexJobQueueMessage,
  WorkflowJobQueueMessage,
  DeploymentQueueMessage,
} from './queue-messages';
import type { RoutingStore } from '../../application/services/routing/types';

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
  UI_BUNDLES?: ObjectStoreBinding;
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
}

export interface ContainerHostEnv {
  RUNTIME_HOST?: { fetch(request: Request): Promise<Response> };
  EXECUTOR_HOST?: { fetch(request: Request): Promise<Response> };
  BROWSER_HOST?: { fetch(request: Request): Promise<Response> };
}

// ---------------------------------------------------------------------------
// Narrow Env types — used by individual worker entrypoints that only need a
// subset of the full Env bindings.
// ---------------------------------------------------------------------------

export type RunnerEnv = DbEnv & {
  EXECUTOR_HOST?: { fetch(request: Request): Promise<Response> };
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

export interface Env extends
  DbEnv, StorageEnv, AiEnv,
  AgentConfigEnv, ContainerHostEnv {
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
  TENANT_BASE_DOMAIN: string;
  PLATFORM_PRIVATE_KEY: string;
  PLATFORM_PUBLIC_KEY: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  WFP_DISPATCH_NAMESPACE?: string;
  CF_ZONE_ID?: string;
  OCI_ORCHESTRATOR_URL?: string;
  OCI_ORCHESTRATOR_TOKEN?: string;
  HOSTNAME_ROUTING: KvStoreBinding;
  ROLLOUT_HEALTH_KV?: KvStoreBinding;
  ROUTING_STORE?: RoutingStore;
  DISPATCHER?: {
    get(name: string): { fetch(request: Request): Promise<Response> };
  };
  // Assets & Browser
  ASSETS?: { fetch(request: Request): Promise<Response> };
  BROWSER?: {
    connect(): Promise<{ webSocketDebuggerUrl: string }>;
  };
  // Security
  ENCRYPTION_KEY?: string;
  AUDIT_IP_HASH_KEY?: string;
  // Billing
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
