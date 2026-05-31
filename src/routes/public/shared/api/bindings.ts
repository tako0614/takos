import type {
  AiBinding,
  DurableNamespaceBinding,
  MessageQueueBinding,
  ObjectStoreBinding,
  RunQueueMessage,
  SqlDatabaseBinding,
  VectorIndexBinding,
} from "takos-api-contract/shared/types";

export type ApiBindings = {
  DB?: SqlDatabaseBinding;
  TAKOS_OFFLOAD?: ObjectStoreBinding;
  RUN_NOTIFIER?: DurableNamespaceBinding;
  RUN_QUEUE?: MessageQueueBinding<RunQueueMessage>;
  GIT_OBJECTS?: ObjectStoreBinding;
  ADMIN_DOMAIN?: string;
  TAKOS_INTERNAL_API_SECRET?: string;
  OIDC_DISCOVERY_URL?: string;
  OIDC_ISSUER_URL?: string;
  TAKOS_DEFAULT_APP_DISTRIBUTION_JSON?: string;
  TAKOS_DEFAULT_APP_REPOSITORIES_JSON?: string;
  TAKOS_DEFAULT_APP_PREINSTALL_ENABLED?: string;
  TAKOSUMI_ACCOUNTS_INTERNAL_URL?: string;
  TAKOSUMI_ACCOUNTS_TOKEN?: string;
  TAKOSUMI_ACCOUNTS_URL?: string;
  AI?: AiBinding;
  VECTORIZE?: VectorIndexBinding;
};
