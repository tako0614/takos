import type { AiBinding, DurableNamespaceBinding, KvStoreBinding, ObjectStoreBinding, QueueBinding, SqlDatabaseBinding, VectorIndexBinding } from './bindings';
import type { RunQueueMessage, IndexJobQueueMessage, WorkflowJobQueueMessage, DeploymentQueueMessage } from './queue-messages';
import type { RoutingStore } from './routing';
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
    /** JSON object mapping model IDs to context window sizes, e.g. {"gpt-5.4":200} */
    MODEL_CONTEXT_WINDOWS?: string;
}
export type FetchBinding = {
    fetch(request: Request): Promise<Response>;
};
export interface ContainerHostEnv {
    RUNTIME_HOST?: FetchBinding;
    EXECUTOR_HOST?: FetchBinding;
    BROWSER_HOST?: FetchBinding;
}
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
export interface Env extends DbEnv, StorageEnv, AiEnv, AgentConfigEnv, ContainerHostEnv {
    SERVICE_INTERNAL_JWT_ISSUER?: string;
    SESSION_DO: DurableNamespaceBinding;
    RUN_NOTIFIER: DurableNamespaceBinding;
    NOTIFICATION_NOTIFIER?: DurableNamespaceBinding;
    RATE_LIMITER_DO?: DurableNamespaceBinding;
    ROUTING_DO: DurableNamespaceBinding;
    ROUTING_DO_PHASE?: string;
    GIT_PUSH_LOCK?: DurableNamespaceBinding;
    RUN_QUEUE: QueueBinding<RunQueueMessage>;
    INDEX_QUEUE?: QueueBinding<IndexJobQueueMessage>;
    WORKFLOW_QUEUE?: QueueBinding<WorkflowJobQueueMessage>;
    DEPLOY_QUEUE?: QueueBinding<DeploymentQueueMessage>;
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
        get(name: string): {
            fetch(request: Request): Promise<Response>;
        };
    };
    ASSETS?: FetchBinding;
    BROWSER?: {
        connect(): Promise<{
            webSocketDebuggerUrl: string;
        }>;
    };
    ENCRYPTION_KEY?: string;
    AUDIT_IP_HASH_KEY?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_PLUS_PRICE_ID?: string;
    STRIPE_PRO_TOPUP_PACKS_JSON?: string;
    TURNSTILE_SECRET_KEY?: string;
    /** Set to "development" to bypass HTTPS enforcement (operator-controlled, not client-controlled) */
    ENVIRONMENT?: string;
}
//# sourceMappingURL=env.d.ts.map