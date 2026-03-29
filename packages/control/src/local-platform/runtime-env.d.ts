import type { DurableNamespaceBinding } from '../shared/types/bindings.ts';
import type { LocalFetch } from './runtime-types.ts';
export declare function createRuntimeHostEnvForTests(deps: {
    webFetch: LocalFetch;
}): Promise<{
    RUNTIME_CONTAINER: DurableNamespaceBinding;
    TAKOS_WEB: {
        fetch: (request: Request) => Promise<Response>;
    };
    ADMIN_DOMAIN: string;
    PROXY_BASE_URL: string;
}>;
export declare function createRuntimeHostEnv(): Promise<{
    RUNTIME_CONTAINER: DurableNamespaceBinding;
    TAKOS_WEB: import("./runtime-types.ts").LocalBinding;
    ADMIN_DOMAIN: string;
    PROXY_BASE_URL: string;
}>;
export declare function createExecutorHostEnvForTests(deps: {
    runtimeFetch?: LocalFetch;
    browserFetch?: LocalFetch;
}): Promise<{
    CONTROL_RPC_BASE_URL: string;
    PROXY_BASE_URL: string;
    BROWSER_HOST?: import("../shared/types/env.ts").FetchBinding;
    RUNTIME_HOST?: import("../shared/types/env.ts").FetchBinding;
    EXECUTOR_CONTAINER: DurableNamespaceBinding;
    TAKOS_EGRESS: {
        fetch: (request: Request) => Promise<Response>;
    };
    SERVICE_INTERNAL_JWT_ISSUER?: string;
    SESSION_DO: DurableNamespaceBinding;
    RUN_NOTIFIER: DurableNamespaceBinding;
    NOTIFICATION_NOTIFIER?: DurableNamespaceBinding;
    RATE_LIMITER_DO?: DurableNamespaceBinding;
    ROUTING_DO: DurableNamespaceBinding;
    ROUTING_DO_PHASE?: string;
    GIT_PUSH_LOCK?: DurableNamespaceBinding;
    RUN_QUEUE: import("../shared/types/bindings.ts").QueueBinding<import("../shared/types/queue-messages.ts").RunQueueMessage>;
    INDEX_QUEUE?: import("../shared/types/bindings.ts").QueueBinding<import("../shared/types/queue-messages.ts").IndexJobQueueMessage>;
    WORKFLOW_QUEUE?: import("../shared/types/bindings.ts").QueueBinding<import("../shared/types/queue-messages.ts").WorkflowJobQueueMessage>;
    DEPLOY_QUEUE?: import("../shared/types/bindings.ts").QueueBinding<import("../shared/types/queue-messages.ts").DeploymentQueueMessage>;
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
    HOSTNAME_ROUTING: import("../shared/types/bindings.ts").KvStoreBinding;
    ROLLOUT_HEALTH_KV?: import("../shared/types/bindings.ts").KvStoreBinding;
    ROUTING_STORE?: import("../shared/types/routing.ts").RoutingStore;
    DISPATCHER?: {
        get(name: string): {
            fetch(request: Request): Promise<Response>;
        };
    };
    ASSETS?: import("../shared/types/env.ts").FetchBinding;
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
    ENVIRONMENT?: string;
    DB: import("../shared/types/bindings.ts").SqlDatabaseBinding;
    GIT_OBJECTS?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    TAKOS_OFFLOAD?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    TENANT_SOURCE?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    WORKER_BUNDLES?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    TENANT_BUILDS?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    UI_BUNDLES?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    VECTORIZE?: import("../shared/types/bindings.ts").VectorIndexBinding;
    AI?: import("../shared/types/bindings.ts").AiBinding;
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    GOOGLE_API_KEY?: string;
    SERPER_API_KEY?: string;
    MAX_AGENT_ITERATIONS?: string;
    AGENT_TEMPERATURE?: string;
    AGENT_RATE_LIMIT?: string;
    AGENT_ITERATION_TIMEOUT?: string;
    AGENT_TOTAL_TIMEOUT?: string;
    TOOL_EXECUTION_TIMEOUT?: string;
    LANGGRAPH_TIMEOUT?: string;
    MODEL_CONTEXT_WINDOWS?: string;
    EXECUTOR_HOST?: import("../shared/types/env.ts").FetchBinding;
}>;
export declare function createExecutorHostEnv(): Promise<{
    EXECUTOR_CONTAINER: DurableNamespaceBinding;
    TAKOS_EGRESS: {
        fetch: (request: Request) => Promise<Response>;
    };
    RUNTIME_HOST: import("./runtime-types.ts").LocalBinding;
    BROWSER_HOST: import("./runtime-types.ts").LocalBinding;
    CONTROL_RPC_BASE_URL: string;
    PROXY_BASE_URL: string;
    SERVICE_INTERNAL_JWT_ISSUER?: string;
    SESSION_DO: DurableNamespaceBinding;
    RUN_NOTIFIER: DurableNamespaceBinding;
    NOTIFICATION_NOTIFIER?: DurableNamespaceBinding;
    RATE_LIMITER_DO?: DurableNamespaceBinding;
    ROUTING_DO: DurableNamespaceBinding;
    ROUTING_DO_PHASE?: string;
    GIT_PUSH_LOCK?: DurableNamespaceBinding;
    RUN_QUEUE: import("../shared/types/bindings.ts").QueueBinding<import("../shared/types/queue-messages.ts").RunQueueMessage>;
    INDEX_QUEUE?: import("../shared/types/bindings.ts").QueueBinding<import("../shared/types/queue-messages.ts").IndexJobQueueMessage>;
    WORKFLOW_QUEUE?: import("../shared/types/bindings.ts").QueueBinding<import("../shared/types/queue-messages.ts").WorkflowJobQueueMessage>;
    DEPLOY_QUEUE?: import("../shared/types/bindings.ts").QueueBinding<import("../shared/types/queue-messages.ts").DeploymentQueueMessage>;
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
    HOSTNAME_ROUTING: import("../shared/types/bindings.ts").KvStoreBinding;
    ROLLOUT_HEALTH_KV?: import("../shared/types/bindings.ts").KvStoreBinding;
    ROUTING_STORE?: import("../shared/types/routing.ts").RoutingStore;
    DISPATCHER?: {
        get(name: string): {
            fetch(request: Request): Promise<Response>;
        };
    };
    ASSETS?: import("../shared/types/env.ts").FetchBinding;
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
    ENVIRONMENT?: string;
    DB: import("../shared/types/bindings.ts").SqlDatabaseBinding;
    GIT_OBJECTS?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    TAKOS_OFFLOAD?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    TENANT_SOURCE?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    WORKER_BUNDLES?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    TENANT_BUILDS?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    UI_BUNDLES?: import("../shared/types/bindings.ts").ObjectStoreBinding;
    VECTORIZE?: import("../shared/types/bindings.ts").VectorIndexBinding;
    AI?: import("../shared/types/bindings.ts").AiBinding;
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    GOOGLE_API_KEY?: string;
    SERPER_API_KEY?: string;
    MAX_AGENT_ITERATIONS?: string;
    AGENT_TEMPERATURE?: string;
    AGENT_RATE_LIMIT?: string;
    AGENT_ITERATION_TIMEOUT?: string;
    AGENT_TOTAL_TIMEOUT?: string;
    TOOL_EXECUTION_TIMEOUT?: string;
    LANGGRAPH_TIMEOUT?: string;
    MODEL_CONTEXT_WINDOWS?: string;
    EXECUTOR_HOST?: import("../shared/types/env.ts").FetchBinding;
}>;
export declare function createBrowserHostEnvForTests(): Promise<{
    BROWSER_CONTAINER: DurableNamespaceBinding;
    BROWSER_CHECKPOINTS: undefined;
    TAKOS_EGRESS: {
        fetch: (request: Request) => Promise<Response>;
    };
}>;
export declare function createBrowserHostEnv(): Promise<{
    BROWSER_CONTAINER: DurableNamespaceBinding;
    BROWSER_CHECKPOINTS: undefined;
    TAKOS_EGRESS: {
        fetch: (request: Request) => Promise<Response>;
    };
}>;
//# sourceMappingURL=runtime-env.d.ts.map