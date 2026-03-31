/**
 * Adapters barrel — re-exports all cloud-provider adapter bindings
 * and worker-emulation layer for use as `takos-control/bindings`.
 */

// --- Cloud KV stores ---
export { createDynamoKvStore } from './dynamo-kv-store.ts';
export type { DynamoKvStoreConfig } from './dynamo-kv-store.ts';
export { createFirestoreKvStore } from './firestore-kv-store.ts';
export type { FirestoreKvStoreConfig } from './firestore-kv-store.ts';

// --- Cloud object stores ---
export { createGcsObjectStore } from './gcs-object-store.ts';
export type { GcsObjectStoreConfig } from './gcs-object-store.ts';
export { createS3ObjectStore } from './s3-object-store.ts';
export type { S3ObjectStoreConfig } from './s3-object-store.ts';

// --- Cloud queues ---
export { createPubSubQueue } from './pubsub-queue.ts';
export type { PubSubQueueConfig } from './pubsub-queue.ts';
export { createSqsQueue } from './sqs-queue.ts';
export type { SqsQueueConfig } from './sqs-queue.ts';

// --- AI / vector ---
export { createOpenAiAiBinding } from './openai-binding.ts';
export type { OpenAiAiBindingConfig } from './openai-binding.ts';
export { createPgVectorStore } from './pgvector-store.ts';
export type { PgVectorStoreConfig } from './pgvector-store.ts';

// --- Worker emulation (Redis-backed DO / SSE) ---
export {
  createRedisDurableObjectNamespace,
  createRedisDurableObjectStorage,
  disposeRedisDurableObjectClient,
} from '../worker-emulation/redis-durable-object.ts';
export type { RedisDurableObjectStorage } from '../worker-emulation/redis-durable-object.ts';
export { createSseNotifierService } from '../worker-emulation/sse-notifier.ts';
export type { SseNotifierService } from '../worker-emulation/sse-notifier.ts';
