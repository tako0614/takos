/**
 * Test Setup for takos-control
 *
 * This file provides:
 * - Global mocks for Cloudflare Workers bindings (D1, R2, KV, etc.)
 * - Test utilities and helpers
 * - Environment configuration for testing
 */
import { spy } from 'jsr:@std/testing/mock';
import { buildWorkersWebPlatform } from '@/platform/adapters/workers';

// ============================================================================
// Mock Cloudflare Workers Types
// ============================================================================

/**
 * Mock D1Database implementation for testing
 * Simulates Cloudflare D1 database operations
 */
export class MockD1Database {
  private data: Map<string, unknown[]> = new Map();

  prepare(query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(query, this);
  }

  exec(query: string): Promise<{ count: number; duration: number }> {
    return Promise.resolve({ count: 1, duration: 0 });
  }

  batch<T>(statements: MockD1PreparedStatement[]): Promise<T[]> {
    return Promise.all(statements.map((s) => s.run())) as Promise<T[]>;
  }

  withSession(): {
    prepare(query: string): MockD1PreparedStatement;
    batch<T>(statements: MockD1PreparedStatement[]): Promise<T[]>;
    getBookmark(): string | null;
  } {
    return {
      prepare: (query: string) => this.prepare(query),
      batch: <T>(statements: MockD1PreparedStatement[]) => this.batch<T>(statements),
      getBookmark: () => null,
    };
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
}

export class MockD1PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private query: string,
    private db: MockD1Database,
  ) {}

  bind(...values: unknown[]): MockD1PreparedStatement {
    this.params = values;
    return this;
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    return null as T | null;
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
    return { results: [], success: true, meta: {} };
  }

  async run(): Promise<{ success: boolean; meta: { changes: number; last_row_id: number; duration: number } }> {
    return { success: true, meta: { changes: 1, last_row_id: 1, duration: 0 } };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return [];
  }
}

/**
 * Mock R2Bucket implementation for testing
 * Simulates Cloudflare R2 object storage
 */
export class MockR2Bucket {
  private objects: Map<string, { body: ArrayBuffer; metadata: Record<string, string> }> = new Map();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string> },
  ): Promise<MockR2Object> {
    let body: ArrayBuffer;
    if (typeof value === 'string') {
      body = new TextEncoder().encode(value).buffer as ArrayBuffer;
    } else if (value instanceof ArrayBuffer) {
      body = value;
    } else if (ArrayBuffer.isView(value)) {
      body = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
    } else {
      // ReadableStream
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      body = combined.buffer as ArrayBuffer;
    }

    this.objects.set(key, { body, metadata: options?.customMetadata || {} });
    return new MockR2Object(key, body, options?.customMetadata || {});
  }

  async get(key: string): Promise<MockR2ObjectBody | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return new MockR2ObjectBody(key, obj.body, obj.metadata);
  }

  async head(key: string): Promise<MockR2Object | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return new MockR2Object(key, obj.body, obj.metadata);
  }

  async delete(key: string | string[]): Promise<void> {
    if (Array.isArray(key)) {
      key.forEach((k) => this.objects.delete(k));
    } else {
      this.objects.delete(key);
    }
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    objects: MockR2Object[];
    truncated: boolean;
    cursor?: string;
  }> {
    let objects = Array.from(this.objects.entries()).map(
      ([key, { body, metadata }]) => new MockR2Object(key, body, metadata),
    );

    if (options?.prefix) {
      objects = objects.filter((obj) => obj.key.startsWith(options.prefix!));
    }

    if (options?.limit) {
      objects = objects.slice(0, options.limit);
    }

    return { objects, truncated: false };
  }
}

export class MockR2Object {
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date;

  constructor(
    readonly key: string,
    body: ArrayBuffer,
    readonly customMetadata: Record<string, string>,
  ) {
    this.size = body.byteLength;
    this.etag = 'mock-etag';
    this.httpEtag = '"mock-etag"';
    this.uploaded = new Date();
  }
}

export class MockR2ObjectBody extends MockR2Object {
  constructor(
    key: string,
    private _body: ArrayBuffer,
    customMetadata: Record<string, string>,
  ) {
    super(key, _body, customMetadata);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this._body;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(this._body);
  }

  async json<T>(): Promise<T> {
    return JSON.parse(await this.text());
  }

  get body(): ReadableStream {
    return new ReadableStream({
      start: (controller) => {
        controller.enqueue(new Uint8Array(this._body));
        controller.close();
      },
    });
  }
}

/**
 * Mock KVNamespace implementation for testing
 * Simulates Cloudflare Workers KV
 */
export class MockKVNamespace {
  private store: Map<string, { value: string; metadata?: unknown; expiration?: number }> = new Map();

  async get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiration && item.expiration < Date.now() / 1000) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async getWithMetadata<T = unknown>(
    key: string,
  ): Promise<{ value: string | null; metadata: T | null }> {
    const item = this.store.get(key);
    if (!item) return { value: null, metadata: null };
    return { value: item.value, metadata: (item.metadata as T) || null };
  }

  async put(
    key: string,
    value: string,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown },
  ): Promise<void> {
    let expiration: number | undefined;
    if (options?.expiration) {
      expiration = options.expiration;
    } else if (options?.expirationTtl) {
      expiration = Math.floor(Date.now() / 1000) + options.expirationTtl;
    }
    this.store.set(key, { value, metadata: options?.metadata, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: { name: string; expiration?: number; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }> {
    let keys = Array.from(this.store.entries())
      .filter(([name]) => !options?.prefix || name.startsWith(options.prefix))
      .map(([name, { expiration, metadata }]) => ({ name, expiration, metadata }));

    if (options?.limit) {
      keys = keys.slice(0, options.limit);
    }

    return { keys, list_complete: true };
  }
}

/**
 * Mock Queue implementation for testing
 */
export class MockQueue<T = unknown> {
  private messages: Array<{ body: T; id: string }> = [];

  async send(body: T): Promise<void> {
    this.messages.push({ body, id: crypto.randomUUID() });
  }

  async sendBatch(messages: Array<{ body: T }>): Promise<void> {
    messages.forEach((m) => this.messages.push({ body: m.body, id: crypto.randomUUID() }));
  }

  // Test helper methods
  getMessages(): Array<{ body: T; id: string }> {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }
}

/**
 * Mock DurableObjectNamespace implementation for testing
 */
export class MockDurableObjectNamespace {
  private instances: Map<string, MockDurableObjectStub> = new Map();

  idFromName(name: string): MockDurableObjectId {
    return new MockDurableObjectId(name);
  }

  idFromString(id: string): MockDurableObjectId {
    return new MockDurableObjectId(id);
  }

  get(id: MockDurableObjectId): MockDurableObjectStub {
    const key = id.toString();
    if (!this.instances.has(key)) {
      this.instances.set(key, new MockDurableObjectStub(id));
    }
    return this.instances.get(key)!;
  }

  getByName(name: string): MockDurableObjectStub {
    return this.get(this.idFromName(name));
  }
}

export class MockDurableObjectId {
  constructor(private id: string) {}

  toString(): string {
    return this.id;
  }
}

export class MockDurableObjectStub {
  constructor(private id: MockDurableObjectId) {}

  async fetch(request: Request): Promise<Response> {
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Mock VectorizeIndex implementation for testing
 */
export class MockVectorizeIndex {
  private vectors: Map<string, { id: string; values: number[]; metadata?: Record<string, unknown> }> = new Map();

  async insert(
    vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>,
  ): Promise<void> {
    vectors.forEach((v) => this.vectors.set(v.id, v));
  }

  async upsert(
    vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>,
  ): Promise<void> {
    vectors.forEach((v) => this.vectors.set(v.id, v));
  }

  async query(
    vector: number[],
    options?: { topK?: number; filter?: Record<string, unknown>; returnValues?: boolean; returnMetadata?: boolean },
  ): Promise<{
    matches: Array<{ id: string; score: number; values?: number[]; metadata?: Record<string, unknown> }>;
  }> {
    const topK = options?.topK || 10;
    const matches = Array.from(this.vectors.values())
      .slice(0, topK)
      .map((v) => ({
        id: v.id,
        score: 0.9,
        ...(options?.returnValues ? { values: v.values } : {}),
        ...(options?.returnMetadata ? { metadata: v.metadata } : {}),
      }));
    return { matches };
  }

  async deleteByIds(ids: string[]): Promise<void> {
    ids.forEach((id) => this.vectors.delete(id));
  }
}

// ============================================================================
// Global Test Environment Setup
// ============================================================================

/**
 * Create a mock Env object for testing
 */
export function createMockEnv(overrides: Partial<Record<string, unknown>> = {}) {
  const env = {
    DB: new MockD1Database(),
    HOSTNAME_ROUTING: new MockKVNamespace(),
    ROUTING_DO: new MockDurableObjectNamespace(),
    SESSION_DO: new MockDurableObjectNamespace(),
    RUN_NOTIFIER: new MockDurableObjectNamespace(),
    RUN_QUEUE: new MockQueue(),
    RUN_DLQ: new MockQueue(),
    INDEX_QUEUE: new MockQueue(),
    WORKER_BUNDLES: new MockR2Bucket(),
    TENANT_BUILDS: new MockR2Bucket(),
    TENANT_SOURCE: new MockR2Bucket(),
    GIT_OBJECTS: new MockR2Bucket(),
    VECTORIZE: new MockVectorizeIndex(),
    // Billing (enabled by default in tests so billing gates behave as expected)
    BILLING_ENABLED: 'true',
    // Secrets and configuration
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    ADMIN_DOMAIN: 'test.takos.jp',
    TENANT_BASE_DOMAIN: 'app.test.takos.jp',
    PLATFORM_PRIVATE_KEY: 'test-private-key',
    PLATFORM_PUBLIC_KEY: 'test-public-key',
    CF_ACCOUNT_ID: 'test-account-id',
    CF_API_TOKEN: 'test-api-token',
    WFP_DISPATCH_NAMESPACE: 'takos-tenants',
    OPENAI_API_KEY: 'test-openai-key',
    RUNTIME_HOST: { fetch: spy() },
    ...overrides,
  };

  if (!('PLATFORM' in env)) {
    Object.assign(env, {
      PLATFORM: buildWorkersWebPlatform(env as never),
    });
  }

  return env;
}

// ============================================================================
// Re-export test utilities
// ============================================================================

export * from './helpers/factories';
export * from './helpers/api';
