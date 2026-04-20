import type {
  Ai as CfAi,
  KVNamespace as CfKVNamespace,
  MessageBatch as CfMessageBatch,
  Queue as CfQueue,
  R2Bucket as CfR2Bucket,
  R2Object as CfR2Object,
  R2ObjectBody as CfR2ObjectBody,
  ScheduledController as CfScheduledController,
  ScheduledEvent as CfScheduledEvent,
  VectorizeIndex as CfVectorizeIndex,
} from "@cloudflare/workers-types";
import type { ExecutionContext as CfExecutionContext } from "hono";

// ---------------------------------------------------------------------------
// Cloudflare-idiomatic exports (canonical names matching the CF platform API).
// These are the primary definitions; semantic aliases below reference them.
// ---------------------------------------------------------------------------

export type Ai = CfAi;
export type D1Meta = {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
  served_by?: string;
  [key: string]: unknown;
};
export type D1Result<T = unknown> = {
  results: T[];
  success: true;
  meta: D1Meta;
};
export type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options: { columnNames: true }): Promise<
    [string[], ...T[]]
  >;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
};
export type D1DatabaseSession = {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
  getBookmark(): string | null;
};
export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  withSession(bookmark?: string): D1DatabaseSession;
  dump(): Promise<ArrayBuffer>;
};
export type ExecutionContext = CfExecutionContext;
export type Fetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};
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
export type DurableObjectNamespace<TStub = DurableObjectStub> = {
  idFromName(name: string): unknown;
  get(id: unknown): TStub;
  getByName?(name: string): TStub;
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
export type DurableNamespaceBinding<TStub = DurableObjectStub> =
  DurableObjectNamespace<TStub>;
export type ObjectStoreBinding = R2Bucket;
export type AiBinding = Ai;
export type QueueBinding<T = unknown> = Queue<T>;
export type QueueMessageBatch<T = unknown> = MessageBatch<T>;
export type VectorIndexBinding = VectorizeIndex;
export type ServiceBindingFetcher = Fetcher;
export type PlatformExecutionContext = ExecutionContext;
export type PlatformScheduledEvent = ScheduledEvent;
export type PlatformScheduledController = CfScheduledController;
