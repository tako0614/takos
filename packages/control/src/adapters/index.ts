/**
 * Adapters barrel — re-exports all cloud-provider adapter bindings
 * and worker-emulation layer for use as `takos-control/bindings`.
 */

// --- Cloud KV stores ---
export { createDynamoKvStore } from './dynamo-kv-store';
export type { DynamoKvStoreConfig } from './dynamo-kv-store';
export { createFirestoreKvStore } from './firestore-kv-store';
export type { FirestoreKvStoreConfig } from './firestore-kv-store';

// --- Cloud object stores ---
export { createGcsObjectStore } from './gcs-object-store';
export type { GcsObjectStoreConfig } from './gcs-object-store';
export { createS3ObjectStore } from './s3-object-store';
export type { S3ObjectStoreConfig } from './s3-object-store';

// --- Cloud queues ---
export { createPubSubQueue } from './pubsub-queue';
export type { PubSubQueueConfig } from './pubsub-queue';
export { createSqsQueue } from './sqs-queue';
export type { SqsQueueConfig } from './sqs-queue';

// --- AI / vector ---
export { createOpenAiAiBinding } from './openai-binding';
export type { OpenAiAiBindingConfig } from './openai-binding';
export { createPgVectorStore } from './pgvector-store';
export type { PgVectorStoreConfig } from './pgvector-store';

// --- Worker emulation (Redis-backed DO / SSE) ---
export {
  createRedisDurableObjectNamespace,
  createRedisDurableObjectStorage,
  disposeRedisDurableObjectClient,
} from '../worker-emulation/redis-durable-object';
export type { RedisDurableObjectStorage } from '../worker-emulation/redis-durable-object';
export { createSseNotifierService } from '../worker-emulation/sse-notifier';
export type { SseNotifierService } from '../worker-emulation/sse-notifier';
