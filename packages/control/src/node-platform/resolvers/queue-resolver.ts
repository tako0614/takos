/**
 * Queue resolver — selects SQS/PubSub/Redis/persistent/in-memory per queue.
 */
import path from "node:path";
import { optionalEnv } from "./env-utils.ts";
import {
  createResolverWithRedis,
  type ResolverWithRedisConfig,
} from "./resolver-factory.ts";
import {
  createInMemoryQueue,
} from "../../local-platform/in-memory-bindings.ts";
import {
  createPersistentQueue,
} from "../../local-platform/persistent-bindings.ts";
import { createRedisQueue } from "../../local-platform/redis-bindings.ts";
import {
  LOCAL_QUEUE_NAMES,
  type LocalQueueName,
} from "../../local-platform/queue-runtime.ts";

// ---------------------------------------------------------------------------
// Queue configuration
// ---------------------------------------------------------------------------

export type QueueName = "RUN" | "INDEX" | "WORKFLOW" | "DEPLOY";

const SQS_ENV_MAP: Record<QueueName, string> = {
  RUN: "AWS_SQS_RUN_QUEUE_URL",
  INDEX: "AWS_SQS_INDEX_QUEUE_URL",
  WORKFLOW: "AWS_SQS_WORKFLOW_QUEUE_URL",
  DEPLOY: "AWS_SQS_DEPLOY_QUEUE_URL",
};

const PUBSUB_ENV_MAP: Record<QueueName, string> = {
  RUN: "GCP_PUBSUB_RUN_TOPIC",
  INDEX: "GCP_PUBSUB_INDEX_TOPIC",
  WORKFLOW: "GCP_PUBSUB_WORKFLOW_TOPIC",
  DEPLOY: "GCP_PUBSUB_DEPLOY_TOPIC",
};

const PUBSUB_SUBSCRIPTION_ENV_MAP: Record<QueueName, string> = {
  RUN: "GCP_PUBSUB_RUN_SUBSCRIPTION",
  INDEX: "GCP_PUBSUB_INDEX_SUBSCRIPTION",
  WORKFLOW: "GCP_PUBSUB_WORKFLOW_SUBSCRIPTION",
  DEPLOY: "GCP_PUBSUB_DEPLOY_SUBSCRIPTION",
};

const LOGICAL_QUEUE_NAME_MAP: Record<QueueName, LocalQueueName> = {
  RUN: LOCAL_QUEUE_NAMES.run,
  INDEX: LOCAL_QUEUE_NAMES.index,
  WORKFLOW: LOCAL_QUEUE_NAMES.workflow,
  DEPLOY: LOCAL_QUEUE_NAMES.deployment,
};

const PERSISTENT_QUEUE_MAP: Record<QueueName, string> = {
  RUN: "run-queue.json",
  INDEX: "index-queue.json",
  WORKFLOW: "workflow-queue.json",
  DEPLOY: "deploy-queue.json",
};

// ---------------------------------------------------------------------------
// Per-queue resolver builder
// ---------------------------------------------------------------------------

function queueResolverConfig<T>(
  name: QueueName,
): ResolverWithRedisConfig<unknown> {
  const logicalName = LOGICAL_QUEUE_NAME_MAP[name];
  return {
    cloudAdapters: [
      // SQS
      {
        async tryCreate() {
          const sqsUrl = optionalEnv(SQS_ENV_MAP[name]);
          if (!sqsUrl) return null;
          const { createSqsQueue } = await import(
            "../../adapters/sqs-queue.ts"
          );
          return createSqsQueue<T>({
            region: optionalEnv("AWS_REGION") ?? "us-east-1",
            queueUrl: sqsUrl,
            accessKeyId: optionalEnv("AWS_ACCESS_KEY_ID"),
            secretAccessKey: optionalEnv("AWS_SECRET_ACCESS_KEY"),
            queueName: logicalName,
          });
        },
      },
      // Pub/Sub
      {
        async tryCreate() {
          const pubsubTopic = optionalEnv(PUBSUB_ENV_MAP[name]);
          if (!pubsubTopic) return null;
          const { createPubSubQueue } = await import(
            "../../adapters/pubsub-queue.ts"
          );
          return createPubSubQueue<T>({
            projectId: optionalEnv("GCP_PROJECT_ID"),
            topicName: pubsubTopic,
            keyFilePath: optionalEnv("GOOGLE_APPLICATION_CREDENTIALS"),
            subscriptionName: optionalEnv(PUBSUB_SUBSCRIPTION_ENV_MAP[name]),
            queueName: logicalName,
          });
        },
      },
    ],
    createRedis: (redisUrl) => createRedisQueue<T>(redisUrl, logicalName),
    createPersistent: (dataDir) =>
      createPersistentQueue<T>(
        path.join(dataDir, "queues", PERSISTENT_QUEUE_MAP[name]),
        logicalName,
      ),
    createInMemory: () => createInMemoryQueue<T>(logicalName),
  };
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveQueue<T = unknown>(
  name: QueueName,
  redisUrl: string | null,
  dataDir: string | null,
) {
  return createResolverWithRedis(queueResolverConfig<T>(name))(
    redisUrl,
    dataDir,
  ) as Promise<ReturnType<typeof createInMemoryQueue<T>>>;
}
