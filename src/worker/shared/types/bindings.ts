import type { ExecutionContext as HonoExecutionContext } from "hono";

// ---------------------------------------------------------------------------
// Platform binding contracts.
//
// These structural contracts intentionally model the subset of binding behavior
// Takos uses instead of importing provider-native SDK types. Provider adapters
// may still pass native bindings when they are structurally compatible, but
// public app/control contracts must remain provider-neutral.
// ---------------------------------------------------------------------------

export type Ai = {
  run(model: string, inputs?: unknown, options?: unknown): Promise<unknown>;
};
export type SqlResultMeta = {
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
export type SqlResultBinding<T = unknown> = {
  results: T[];
  success: true;
  meta: SqlResultMeta;
};
export type SqlPreparedStatementBinding = {
  bind(...values: unknown[]): SqlPreparedStatementBinding;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<SqlResultBinding<T>>;
  all<T = Record<string, unknown>>(): Promise<SqlResultBinding<T>>;
  raw<T = unknown[]>(options: { columnNames: true }): Promise<
    [string[], ...T[]]
  >;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
};
export type SqlDatabaseSessionBinding = {
  prepare(query: string): SqlPreparedStatementBinding;
  batch<T = Record<string, unknown>>(
    statements: SqlPreparedStatementBinding[],
  ): Promise<SqlResultBinding<T>[]>;
  getBookmark(): string | null;
};
/**
 * Statement surface that runs exclusively on a transaction's dedicated
 * connection, handed to the callback of {@link SqlDatabaseBinding.withTransaction}.
 *
 * This is the subset transactional callers need (prepare / batch / exec). Every
 * statement issued through it lands on the single client the transaction owns,
 * so it never leaks onto the pool or into another caller's session.
 */
export type SqlTransactionSessionBinding = {
  prepare(query: string): SqlPreparedStatementBinding;
  batch<T = Record<string, unknown>>(
    statements: SqlPreparedStatementBinding[],
  ): Promise<SqlResultBinding<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
};
export type SqlDatabaseBinding = {
  prepare(query: string): SqlPreparedStatementBinding;
  batch<T = Record<string, unknown>>(
    statements: SqlPreparedStatementBinding[],
  ): Promise<SqlResultBinding<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  withSession(bookmark?: string): SqlDatabaseSessionBinding;
  dump(): Promise<ArrayBuffer>;
  /**
   * Run `cb` inside an atomic transaction bound to a single dedicated
   * connection. The binding holds an exclusive serialization gate for the whole
   * callback, so no concurrent caller can interleave statements into the open
   * transaction (the isolation/atomicity guarantee the flag-routed path could
   * not provide). On any throw the transaction is rolled back and the error is
   * rethrown.
   *
   * Optional: real Cloudflare D1 cannot compose BEGIN/COMMIT across its
   * stateless prepared-statement round-trips, so it does not implement this.
   * Callers must feature-detect (`typeof db.withTransaction === "function"`)
   * and fall back to their compensation / batch strategy when it is absent.
   */
  withTransaction?<T>(
    cb: (tx: SqlTransactionSessionBinding) => Promise<T>,
  ): Promise<T>;
};
export type ExecutionContext = HonoExecutionContext;
export type Fetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};
export type KvStoreGetType = "text" | "json" | "arrayBuffer" | "stream";
export type KvStoreListOptions = {
  prefix?: string;
  limit?: number;
  cursor?: string;
};
export type KvStoreBinding = {
  get<T = string>(key: string, type?: KvStoreGetType): Promise<T | null>;
  get<T = string>(
    key: string,
    options?: { type?: KvStoreGetType },
  ): Promise<T | null>;
  getWithMetadata<T = string>(
    key: string,
    type?: KvStoreGetType,
  ): Promise<
    { value: T | null; metadata: unknown; cacheStatus?: string | null }
  >;
  getWithMetadata<T = string>(
    key: string,
    options?: { type?: KvStoreGetType },
  ): Promise<
    { value: T | null; metadata: unknown; cacheStatus?: string | null }
  >;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: Record<string, unknown>,
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: KvStoreListOptions): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }>;
};
export type MessageQueueSendOptions = {
  contentType?: string;
  delaySeconds?: number;
};
export type MessageQueueMessage<T = unknown> = {
  id: string;
  timestamp: Date;
  attempts: number;
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};
export type MessageQueueBatch<T = unknown> = {
  queue: string;
  messages: MessageQueueMessage<T>[];
  ackAll?(): void;
  retryAll?(options?: { delaySeconds?: number }): void;
};
export type MessageQueueBinding<T = unknown> = {
  send(message: T, options?: MessageQueueSendOptions): Promise<void>;
  sendBatch(
    messages: Array<{ body: T; contentType?: string; delaySeconds?: number }>,
  ): Promise<void>;
};
export type ObjectStoreHttpMetadata = {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
};
export type ObjectStoreObject = {
  key: string;
  version?: string;
  size: number;
  etag: string;
  httpEtag: string;
  uploaded: Date;
  checksums?: unknown;
  httpMetadata?: ObjectStoreHttpMetadata;
  customMetadata?: Record<string, string>;
  range?: { offset: number; length?: number };
  storageClass?: string;
  writeHttpMetadata?(headers: Headers): void;
};
export type ObjectStoreObjectBody = ObjectStoreObject & {
  body: ReadableStream;
  bodyUsed: boolean;
  writeHttpMetadata?(headers: Headers): void;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  blob(): Promise<Blob>;
  bytes?(): Promise<Uint8Array>;
};
export type ObjectStoreBinding = {
  get(
    key: string,
    options?: Record<string, unknown>,
  ): Promise<ObjectStoreObjectBody | null>;
  head(key: string): Promise<ObjectStoreObject | null>;
  put(
    key: string,
    value:
      | ReadableStream
      | ArrayBuffer
      | ArrayBufferView
      | string
      | Blob
      | null,
    options?: Record<string, unknown>,
  ): Promise<ObjectStoreObject | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: Record<string, unknown>): Promise<{
    objects: ObjectStoreObject[];
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes: string[];
  }>;
  createMultipartUpload?(
    key: string,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  resumeMultipartUpload?(key: string, uploadId: string): unknown;
};
export type DurableObjectStorageBinding = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean | void>;
  delete(keys: string[]): Promise<number | void>;
  list<T = unknown>(options?: Record<string, unknown>): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
};
export type DurableObjectStateBinding<T = unknown> = {
  storage: DurableObjectStorageBinding;
  blockConcurrencyWhile<R>(callback: () => Promise<R>): Promise<R>;
  waitUntil?(promise: Promise<unknown>): void;
  getWebSockets(): WebSocket[];
  getTags(webSocket: WebSocket): string[];
  acceptWebSocket(webSocket: WebSocket, tags?: string[]): void;
  exports?: T;
};
export type ScheduledController = {
  scheduledTime: number;
  cron: string;
  noRetry?(): void;
};
export type ScheduledEvent = ScheduledController & {
  waitUntil(promise: Promise<unknown>): void;
};
export type PlatformHandler<TEnv = unknown> = {
  fetch?(
    request: Request,
    env: TEnv,
    ctx: PlatformExecutionContext,
  ): Response | Promise<Response>;
  scheduled?(
    event: PlatformScheduledEvent,
    env: TEnv,
    ctx: PlatformExecutionContext,
  ): void | Promise<void>;
  queue?(
    batch: MessageQueueBatch<unknown>,
    env: TEnv,
    ctx: PlatformExecutionContext,
  ): void | Promise<void>;
};

export type VectorizeMatch = {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
  values?: number[];
};
export type VectorizeIndex = {
  query(
    vector: number[] | Float32Array,
    options?: unknown,
  ): Promise<{ matches: VectorizeMatch[] }>;
  insert(vectors: unknown[]): Promise<unknown>;
  upsert(vectors: unknown[]): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
  getByIds?(ids: string[]): Promise<unknown>;
};

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

export type DurableObjectStubBinding<T = unknown> = DurableObjectStub<T>;
export type DurableNamespaceBinding<TStub = DurableObjectStub> =
  DurableObjectNamespace<TStub>;
export type AiBinding = Ai;
export type VectorIndexBinding = VectorizeIndex;
export type ServiceBindingFetcher = Fetcher;
export type PlatformExecutionContext = ExecutionContext;
export type PlatformScheduledEvent = ScheduledEvent;
export type PlatformScheduledController = ScheduledController;
