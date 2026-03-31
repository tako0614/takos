import type {
  Ai as CfAi,
  D1Database as CfD1Database,
  D1PreparedStatement as CfD1PreparedStatement,
  D1Result as CfD1Result,
  Fetcher as CfFetcher,
  KVNamespace as CfKVNamespace,
  MessageBatch as CfMessageBatch,
  Queue as CfQueue,
  R2Bucket as CfR2Bucket,
  R2Object as CfR2Object,
  R2ObjectBody as CfR2ObjectBody,
  ScheduledController as CfScheduledController,
  ScheduledEvent as CfScheduledEvent,
  VectorizeIndex as CfVectorizeIndex,
} from '@cloudflare/workers-types';
import type { ExecutionContext as CfExecutionContext } from 'hono';

// ---------------------------------------------------------------------------
// Cloudflare-idiomatic exports (canonical names matching the CF platform API).
// These are the primary definitions; semantic aliases below reference them.
// ---------------------------------------------------------------------------

export type Ai = CfAi;
export type D1Database = CfD1Database;
export type D1PreparedStatement = CfD1PreparedStatement;
export type D1Result<T = unknown> = CfD1Result<T>;
export type ExecutionContext = CfExecutionContext;
export type Fetcher = CfFetcher;
export type KVNamespace = CfKVNamespace;
export type MessageBatch<T = unknown> = CfMessageBatch<T>;
export type Queue<T = unknown> = CfQueue<T>;
export type R2Bucket = CfR2Bucket;
export type R2Object = CfR2Object;
export type R2ObjectBody = CfR2ObjectBody;
export type ScheduledEvent = CfScheduledEvent;
export type VectorizeIndex = CfVectorizeIndex;

// ---------------------------------------------------------------------------
// Durable Object structural types (no direct compat equivalent).
// ---------------------------------------------------------------------------

export type DurableObjectStub<T = unknown> = {
  fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
};
export type DurableObjectNamespace<T = unknown> = {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub<T>;
  getByName?(name: string): DurableObjectStub<T>;
};

// ---------------------------------------------------------------------------
// Semantic aliases used in the platform / infrastructure layer.
// Each resolves to the canonical CF-idiomatic type above.
// ---------------------------------------------------------------------------

export type SqlDatabaseBinding = D1Database;
export type SqlPreparedStatementBinding = D1PreparedStatement;
export type SqlResultBinding<T = unknown> = D1Result<T>;
export type KvStoreBinding = KVNamespace;
export type DurableObjectStubBinding<T = unknown> = DurableObjectStub<T>;
export type DurableNamespaceBinding<T = unknown> = DurableObjectNamespace<T>;
export type ObjectStoreBinding = R2Bucket;
export type AiBinding = Ai;
export type QueueBinding<T = unknown> = Queue<T>;
export type QueueMessageBatch<T = unknown> = MessageBatch<T>;
export type VectorIndexBinding = VectorizeIndex;
export type ServiceBindingFetcher = Fetcher;
export type PlatformExecutionContext = ExecutionContext;
export type PlatformScheduledEvent = ScheduledEvent;
export type PlatformScheduledController = CfScheduledController;
