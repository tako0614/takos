import type {
  Ai,
  DurableObjectNamespace,
  KVNamespace,
  Queue,
  R2Bucket,
  VectorizeIndex,
} from '../../shared/types/bindings.ts';
import type {
  DbEnv,
  DeploymentQueueMessage,
  IndexJobQueueMessage,
  RunQueueMessage,
  WorkflowJobQueueMessage,
} from '../../shared/types/index.ts';

/**
 * Unified Env for takos-worker.
 * Union of runner + indexer + workflow-runner + egress bindings.
 */
export type WorkerEnv = DbEnv & {
  // --- runner ---
  EXECUTOR_HOST?: { fetch(request: Request): Promise<Response> };
  RUN_QUEUE: Queue<RunQueueMessage>;
  RUN_NOTIFIER: DurableObjectNamespace;
  TAKOS_OFFLOAD?: R2Bucket;

  // --- indexer ---
  AI?: Ai;
  VECTORIZE?: VectorizeIndex;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GIT_OBJECTS?: R2Bucket;
  TENANT_SOURCE?: R2Bucket;
  INDEX_QUEUE?: Queue<IndexJobQueueMessage>;

  // --- workflow-runner ---
  RUNTIME_HOST?: { fetch(request: Request): Promise<Response> };
  ENCRYPTION_KEY?: string;
  ADMIN_DOMAIN: string;
  TENANT_BASE_DOMAIN: string;
  WFP_DISPATCH_NAMESPACE?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  WORKER_BUNDLES?: R2Bucket;
  TENANT_BUILDS?: R2Bucket;
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
  HOSTNAME_ROUTING: KVNamespace;
  ROUTING_DO?: DurableObjectNamespace;
  ROUTING_DO_PHASE?: string;
  SERVICE_INTERNAL_JWT_ISSUER?: string;
  WORKFLOW_QUEUE?: Queue<WorkflowJobQueueMessage>;
  DEPLOY_QUEUE?: Queue<DeploymentQueueMessage>;

  // --- egress ---
  RATE_LIMITER_DO?: DurableObjectNamespace;
  EGRESS_MAX_REQUESTS?: string;
  EGRESS_WINDOW_MS?: string;
  EGRESS_RATE_LIMIT_ALGORITHM?: string;
  EGRESS_RATE_LIMIT_SHADOW_SAMPLE_RATE?: string;
  EGRESS_MAX_RESPONSE_BYTES?: string;
  EGRESS_TIMEOUT_MS?: string;
};
