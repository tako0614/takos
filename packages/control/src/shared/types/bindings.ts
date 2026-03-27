import type {
  Ai as CompatAi,
  D1Database as CompatD1Database,
  D1PreparedStatement as CompatD1PreparedStatement,
  D1Result as CompatD1Result,
  ExecutionContext as CompatExecutionContext,
  Fetcher as CompatFetcher,
  KVNamespace as CompatKVNamespace,
  MessageBatch as CompatMessageBatch,
  Queue as CompatQueue,
  R2Bucket as CompatR2Bucket,
  R2Object as CompatR2Object,
  R2ObjectBody as CompatR2ObjectBody,
  ScheduledController as CompatScheduledController,
  ScheduledEvent as CompatScheduledEvent,
  VectorizeIndex as CompatVectorizeIndex,
} from '@takos/cloudflare-compat';

// Semantic binding aliases used throughout the codebase.
export type SqlDatabaseBinding = CompatD1Database;
export type SqlPreparedStatementBinding = CompatD1PreparedStatement;
export type SqlResultBinding<T = unknown> = CompatD1Result<T>;
export type KvStoreBinding = CompatKVNamespace;
export type DurableObjectStubBinding<T = unknown> = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};
export type DurableNamespaceBinding<T = unknown> = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubBinding<T>;
  getByName?(name: string): DurableObjectStubBinding<T>;
};
export type ObjectStoreBinding = CompatR2Bucket;
export type AiBinding = CompatAi;
export type QueueBinding<T = unknown> = CompatQueue<T>;
export type QueueMessageBatch<T = unknown> = CompatMessageBatch<T>;
export type VectorIndexBinding = CompatVectorizeIndex;
export type ServiceBindingFetcher = CompatFetcher;
export type PlatformExecutionContext = CompatExecutionContext;
export type PlatformScheduledEvent = CompatScheduledEvent;
export type PlatformScheduledController = CompatScheduledController;

// Cloudflare-idiomatic re-exports so canonical modules can use familiar names.
export type D1Database = CompatD1Database;
export type D1PreparedStatement = CompatD1PreparedStatement;
export type D1Result<T = unknown> = CompatD1Result<T>;
export type KVNamespace = CompatKVNamespace;
export type DurableObjectNamespace<T = unknown> = DurableNamespaceBinding<T>;
export type DurableObjectStub<T = unknown> = DurableObjectStubBinding<T>;
export type R2Bucket = CompatR2Bucket;
export type R2Object = CompatR2Object;
export type R2ObjectBody = CompatR2ObjectBody;
export type Fetcher = CompatFetcher;
export type MessageBatch<T = unknown> = CompatMessageBatch<T>;
export type Queue<T = unknown> = CompatQueue<T>;
export type ExecutionContext = CompatExecutionContext;
export type ScheduledEvent = CompatScheduledEvent;
export type VectorizeIndex = CompatVectorizeIndex;
export type Ai = CompatAi;
