/**
 * CF-compatible interface definitions for use in Node.js environments
 * (e.g., the takos-executor container).
 *
 * These are intentionally structural and a little more permissive than the
 * official Workers types because the proxy stubs emulate the binding contract
 * over HTTP rather than inside the Workers runtime.
 */

// ---------------------------------------------------------------------------
// D1 Database
// ---------------------------------------------------------------------------

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export type D1RawOptions = { columnNames: true } | { columnNames?: false };

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

// ---------------------------------------------------------------------------
// R2 Storage
// ---------------------------------------------------------------------------

export interface R2ObjectMetadata {
  key: string;
  size: number;
  etag: string;
  httpEtag: string;
  checksums: Record<string, string>;
  uploaded: Date;
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

export interface R2Object extends R2ObjectMetadata {
  body: ReadableStream;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob>;
}

export interface R2PutOptions {
  httpMetadata?: Record<string, string>;
  customMetadata?: Record<string, string>;
}

export interface R2ListOptions {
  prefix?: string;
  delimiter?: string;
  cursor?: string;
  limit?: number;
}

export interface R2Objects {
  objects: R2ObjectMetadata[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

export interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null,
    options?: R2PutOptions,
  ): Promise<R2ObjectMetadata>;
  delete(key: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
  head(key: string): Promise<R2ObjectMetadata | null>;
}

// ---------------------------------------------------------------------------
// Durable Objects
// ---------------------------------------------------------------------------

export interface DurableObjectId {
  toString(): string;
  equals(other: DurableObjectId): boolean;
  readonly name?: string;
}

export interface DurableObjectStub {
  id: DurableObjectId;
  name?: string;
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  newUniqueId(): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

// ---------------------------------------------------------------------------
// Vectorize
// ---------------------------------------------------------------------------

export interface VectorizeVector {
  id: string;
  values?: number[];
  metadata?: Record<string, string | number | boolean>;
  namespace?: string;
}

export interface VectorizeMatch {
  id: string;
  score: number;
  values?: number[];
  metadata?: Record<string, string | number | boolean>;
}

export interface VectorizeQueryResult {
  matches: VectorizeMatch[];
  count: number;
}

export interface VectorizeQueryOptions {
  topK?: number;
  namespace?: string;
  filter?: Record<string, string | number | boolean | Array<string | number | boolean>>;
  returnValues?: boolean;
  returnMetadata?: 'none' | 'indexed' | 'all';
}

export interface VectorizeIndex {
  query(vector: number[], options?: VectorizeQueryOptions): Promise<VectorizeQueryResult>;
  insert(vectors: VectorizeVector[]): Promise<{ count: number; ids: string[] }>;
  upsert(vectors: VectorizeVector[]): Promise<{ count: number; ids: string[] }>;
  deleteByIds(ids: string[]): Promise<{ count: number; ids: string[] }>;
  getByIds(ids: string[]): Promise<VectorizeVector[]>;
  describe(): Promise<{ name: string; config: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// CF AI
// ---------------------------------------------------------------------------

export interface Ai {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// CF Queue
// ---------------------------------------------------------------------------

export interface QueueSendOptions {
  contentType?: 'text' | 'bytes' | 'json' | 'v8';
  delaySeconds?: number;
}

export interface Queue<T = unknown> {
  send(message: T, options?: QueueSendOptions): Promise<void>;
  sendBatch(messages: { body: T; options?: QueueSendOptions }[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Generic service binding fetcher
// ---------------------------------------------------------------------------

export interface Fetcher {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

// ---------------------------------------------------------------------------
// KV Namespace (minimal — for Env compatibility if needed)
// ---------------------------------------------------------------------------

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  get(key: string, options: { type: 'text' }): Promise<string | null>;
  get<T = unknown>(key: string, options: { type: 'json' }): Promise<T | null>;
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  get(key: string, options: { type: 'stream' }): Promise<ReadableStream | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: { expirationTtl?: number; expiration?: number; metadata?: unknown },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ keys: { name: string; expiration?: number; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
}
