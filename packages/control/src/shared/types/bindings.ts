import type {
  Ai as CompatAi,
  D1Database as CompatD1Database,
  D1PreparedStatement as CompatD1PreparedStatement,
  D1Result as CompatD1Result,
  DurableObjectStub as CompatDurableObjectStub,
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

export type SqlDatabaseBinding = CompatD1Database;
export type SqlPreparedStatementBinding = CompatD1PreparedStatement;
export type SqlResultBinding<T = unknown> = CompatD1Result<any>;
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
export type StoredObjectBinding = CompatR2Object;
export type ObjectBodyBinding = CompatR2ObjectBody;
export type AiBinding = CompatAi;
export type QueueBinding<T = unknown> = CompatQueue<T>;
export type QueueMessageBatch<T = unknown> = CompatMessageBatch<T>;
export type VectorIndexBinding = CompatVectorizeIndex;
export type ServiceBindingFetcher = CompatFetcher;
export type PlatformExecutionContext = CompatExecutionContext;
export type PlatformScheduledEvent = CompatScheduledEvent;
export type PlatformScheduledController = CompatScheduledController;
export type D1DatabaseBinding = SqlDatabaseBinding;
export type D1PreparedStatementBinding = SqlPreparedStatementBinding;
export type D1ResultBinding<T = unknown> = SqlResultBinding<T>;
export type KVNamespaceBinding = KvStoreBinding;
export type DurableObjectNamespaceBinding<T = unknown> = DurableNamespaceBinding<T>;
export type DurableObjectStubCompatBinding<T = unknown> = DurableObjectStubBinding<T>;
export type R2BucketBinding = ObjectStoreBinding;
export type R2ObjectBinding = StoredObjectBinding;
export type R2ObjectBodyBinding = ObjectBodyBinding;
export type FetcherBinding = ServiceBindingFetcher;

// Compatibility re-exports so canonical modules can stop importing the compat package directly.
export type D1Database = SqlDatabaseBinding;
export type D1PreparedStatement = SqlPreparedStatementBinding;
export type D1Result<T = unknown> = SqlResultBinding<T>;
export type KVNamespace = KvStoreBinding;
export type DurableObjectNamespace<T = unknown> = DurableNamespaceBinding<T>;
export type DurableObjectStub<T = unknown> = DurableObjectStubBinding<T>;
export type R2Bucket = ObjectStoreBinding;
export type R2Object = StoredObjectBinding;
export type R2ObjectBody = ObjectBodyBinding;
export type Fetcher = ServiceBindingFetcher;
export type MessageBatch<T = unknown> = QueueMessageBatch<T>;
export type Queue<T = unknown> = QueueBinding<T>;
export type ExecutionContext = CompatExecutionContext;
export type ScheduledEvent = CompatScheduledEvent;
export type ScheduledController = CompatScheduledController;
export type VectorizeIndex = VectorIndexBinding;
export type Ai = AiBinding;
