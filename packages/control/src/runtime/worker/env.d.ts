import type { Ai, DurableObjectNamespace, KVNamespace, Queue, R2Bucket, VectorizeIndex } from '../../shared/types/bindings.ts';
import type { DbEnv, DeploymentQueueMessage, IndexJobQueueMessage, RunQueueMessage, WorkflowJobQueueMessage } from '../../shared/types';
/**
 * Unified Env for takos-worker.
 * Union of runner + indexer + workflow-runner + egress bindings.
 */
export type WorkerEnv = DbEnv & {
    EXECUTOR_HOST?: {
        fetch(request: Request): Promise<Response>;
    };
    RUN_QUEUE: Queue<RunQueueMessage>;
    RUN_NOTIFIER: DurableObjectNamespace;
    TAKOS_OFFLOAD?: R2Bucket;
    AI?: Ai;
    VECTORIZE?: VectorizeIndex;
    OPENAI_API_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    GOOGLE_API_KEY?: string;
    GIT_OBJECTS?: R2Bucket;
    TENANT_SOURCE?: R2Bucket;
    INDEX_QUEUE?: Queue<IndexJobQueueMessage>;
    RUNTIME_HOST?: {
        fetch(request: Request): Promise<Response>;
    };
    ENCRYPTION_KEY?: string;
    ADMIN_DOMAIN: string;
    TENANT_BASE_DOMAIN: string;
    WFP_DISPATCH_NAMESPACE?: string;
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
    WORKER_BUNDLES?: R2Bucket;
    TENANT_BUILDS?: R2Bucket;
    HOSTNAME_ROUTING: KVNamespace;
    ROUTING_DO?: DurableObjectNamespace;
    ROUTING_DO_PHASE?: string;
    SERVICE_INTERNAL_JWT_ISSUER?: string;
    WORKFLOW_QUEUE?: Queue<WorkflowJobQueueMessage>;
    DEPLOY_QUEUE?: Queue<DeploymentQueueMessage>;
    RATE_LIMITER_DO?: DurableObjectNamespace;
    EGRESS_MAX_REQUESTS?: string;
    EGRESS_WINDOW_MS?: string;
    EGRESS_RATE_LIMIT_ALGORITHM?: string;
    EGRESS_RATE_LIMIT_SHADOW_SAMPLE_RATE?: string;
    EGRESS_MAX_RESPONSE_BYTES?: string;
    EGRESS_TIMEOUT_MS?: string;
};
//# sourceMappingURL=env.d.ts.map