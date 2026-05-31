/**
 * Test Setup for takos-control
 *
 * This file provides:
 * - Global mocks for SQL, object store, kv store, and message queue bindings
 * - Test utilities and helpers
 * - Environment configuration for testing
 */
import { spy } from "@std/testing/mock";
import { buildWorkersWebPlatform } from "@/platform/adapters/workers.ts";
import type { Env } from "@/types";
import type {
  DurableNamespaceBinding,
  KvStoreBinding,
  KvStoreGetType,
  MessageQueueBinding,
  ObjectStoreBinding,
  ObjectStoreObject,
  ObjectStoreObjectBody,
  SqlDatabaseBinding,
  SqlDatabaseSessionBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
  SqlResultMeta,
  VectorizeIndex,
  VectorizeMatch,
} from "@/shared/types/bindings.ts";

// Re-export typed noop binding stubs so tests can import them via setup.ts.
export {
  noopKvStoreBinding,
  noopMessageQueueBinding,
  noopObjectStoreBinding,
  noopSqlDatabaseBinding,
} from "./binding-stubs.ts";

// ============================================================================
// Mock platform binding types
// ============================================================================

const buildSqlResultMeta = (
  overrides?: Partial<SqlResultMeta>,
): SqlResultMeta => ({
  duration: 0,
  size_after: 0,
  rows_read: 0,
  rows_written: 0,
  last_row_id: 0,
  changed_db: false,
  changes: 0,
  ...overrides,
});

/**
 * Mock SqlDatabaseBinding implementation for testing
 * Simulates SQL database operations
 */
export class MockSqlDatabaseBinding implements SqlDatabaseBinding {
  private data: Map<string, unknown[]> = new Map();

  prepare(query: string): MockSqlPreparedStatement {
    return new MockSqlPreparedStatement(query, this);
  }

  exec(_query: string): Promise<{ count: number; duration: number }> {
    return Promise.resolve({ count: 1, duration: 0 });
  }

  async batch<T = Record<string, unknown>>(
    statements: SqlPreparedStatementBinding[],
  ): Promise<SqlResultBinding<T>[]> {
    const out: SqlResultBinding<T>[] = [];
    for (const s of statements) {
      out.push(await s.all<T>());
    }
    return out;
  }

  withSession(_bookmark?: string): SqlDatabaseSessionBinding {
    return {
      prepare: (query: string) => this.prepare(query),
      batch: <T = Record<string, unknown>>(
        statements: SqlPreparedStatementBinding[],
      ) => this.batch<T>(statements),
      getBookmark: () => null,
    };
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
}

export class MockSqlPreparedStatement implements SqlPreparedStatementBinding {
  private params: unknown[] = [];

  constructor(
    private query: string,
    private db: MockSqlDatabaseBinding,
  ) {}

  bind(...values: unknown[]): MockSqlPreparedStatement {
    this.params = values;
    return this;
  }

  first<T = Record<string, unknown>>(_column?: string): Promise<T | null> {
    return Promise.resolve(null);
  }

  all<T = Record<string, unknown>>(): Promise<SqlResultBinding<T>> {
    return Promise.resolve({
      results: [] as T[],
      success: true as const,
      meta: buildSqlResultMeta(),
    });
  }

  run<T = Record<string, unknown>>(): Promise<SqlResultBinding<T>> {
    return Promise.resolve({
      results: [] as T[],
      success: true as const,
      meta: buildSqlResultMeta({ changes: 1, last_row_id: 1 }),
    });
  }

  raw<T = unknown[]>(
    options: { columnNames: true },
  ): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(
    options?: { columnNames?: boolean },
  ): Promise<T[] | [string[], ...T[]]> {
    if (options?.columnNames) {
      return Promise.resolve([[]] as [string[], ...T[]]);
    }
    return Promise.resolve([] as T[]);
  }
}

/**
 * Mock ObjectStoreBinding implementation for testing
 * Simulates object store operations
 */
export class MockObjectStoreBinding implements ObjectStoreBinding {
  private objects: Map<
    string,
    { body: ArrayBuffer; metadata: Record<string, string> }
  > = new Map();

  async put(
    key: string,
    value:
      | ReadableStream
      | ArrayBuffer
      | ArrayBufferView
      | string
      | Blob
      | null,
    options?: Record<string, unknown>,
  ): Promise<ObjectStoreObject | null> {
    if (value === null) {
      this.objects.delete(key);
      return null;
    }
    let body: ArrayBuffer;
    if (typeof value === "string") {
      body = new TextEncoder().encode(value).buffer as ArrayBuffer;
    } else if (value instanceof ArrayBuffer) {
      body = value;
    } else if (value instanceof Blob) {
      body = await value.arrayBuffer();
    } else if (ArrayBuffer.isView(value)) {
      body = value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      ) as ArrayBuffer;
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

    const customMetadata = (options?.customMetadata as
      | Record<string, string>
      | undefined) || {};
    this.objects.set(key, { body, metadata: customMetadata });
    return new MockObjectStoreObject(key, body, customMetadata);
  }

  async get(
    key: string,
    _options?: Record<string, unknown>,
  ): Promise<ObjectStoreObjectBody | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return new MockObjectStoreObjectBody(key, obj.body, obj.metadata);
  }

  async head(key: string): Promise<ObjectStoreObject | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;
    return new MockObjectStoreObject(key, obj.body, obj.metadata);
  }

  async delete(key: string | string[]): Promise<void> {
    if (Array.isArray(key)) {
      key.forEach((k) => this.objects.delete(k));
    } else {
      this.objects.delete(key);
    }
  }

  async list(
    options?: Record<string, unknown>,
  ): Promise<{
    objects: ObjectStoreObject[];
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes: string[];
  }> {
    let objects: ObjectStoreObject[] = Array.from(this.objects.entries())
      .map(([key, { body, metadata }]) =>
        new MockObjectStoreObject(key, body, metadata)
      );

    const prefix = options?.prefix as string | undefined;
    const limit = options?.limit as number | undefined;
    if (prefix) {
      objects = objects.filter((obj) => obj.key.startsWith(prefix));
    }

    if (limit) {
      objects = objects.slice(0, limit);
    }

    return { objects, truncated: false, delimitedPrefixes: [] };
  }
}

export class MockObjectStoreObject implements ObjectStoreObject {
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
    this.etag = "mock-etag";
    this.httpEtag = '"mock-etag"';
    this.uploaded = new Date();
  }
}

export class MockObjectStoreObjectBody extends MockObjectStoreObject
  implements ObjectStoreObjectBody {
  bodyUsed = false;
  httpMetadata?: import("@/shared/types/bindings.ts").ObjectStoreHttpMetadata;

  constructor(
    key: string,
    private _body: ArrayBuffer,
    customMetadata: Record<string, string>,
    httpMetadata?: import("@/shared/types/bindings.ts").ObjectStoreHttpMetadata,
  ) {
    super(key, _body, customMetadata);
    this.httpMetadata = httpMetadata;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this._body);
  }

  text(): Promise<string> {
    return Promise.resolve(new TextDecoder().decode(this._body));
  }

  async json<T = unknown>(): Promise<T> {
    return JSON.parse(await this.text());
  }

  blob(): Promise<Blob> {
    return Promise.resolve(new Blob([this._body]));
  }

  bytes(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(this._body));
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
 * Factory for an `ObjectStoreObjectBody` suitable for tests that need to mock
 * `ObjectStoreBinding["get"]` results. Accepts either a string or an ArrayBuffer
 * as the body content. Optional `httpMetadata` is forwarded so callers can set
 * `contentType` etc.
 */
export function makeObjectStoreObjectBody(
  content: string | ArrayBuffer,
  options: {
    key?: string;
    customMetadata?: Record<string, string>;
    httpMetadata?: import("@/shared/types/bindings.ts").ObjectStoreHttpMetadata;
  } = {},
): ObjectStoreObjectBody {
  const body = typeof content === "string"
    ? (new TextEncoder().encode(content).buffer as ArrayBuffer)
    : content;
  return new MockObjectStoreObjectBody(
    options.key ?? "mock-key",
    body,
    options.customMetadata ?? {},
    options.httpMetadata,
  );
}

/**
 * Mock KvStoreBinding implementation for testing
 * Simulates kv store operations.
 *
 * The stored value is always a `string` (see `put`). The `get` / `getWithMetadata`
 * generic `T` defaults to `string`, and callers that override it (e.g. asking
 * for `json`) get a narrow assertion bridging `string` -> `T`. We use a single
 * `as T` rather than `as unknown as T` because the storage shape is a known
 * invariant of the mock and the assertion is the standard contract bridge.
 */
export class MockKvStoreBinding implements KvStoreBinding {
  private store: Map<
    string,
    { value: string; metadata?: unknown; expiration?: number }
  > = new Map();

  get<T = string>(key: string, type?: KvStoreGetType): Promise<T | null>;
  get<T = string>(
    key: string,
    options?: { type?: KvStoreGetType },
  ): Promise<T | null>;
  get<T = string>(
    key: string,
    _typeOrOptions?: KvStoreGetType | { type?: KvStoreGetType },
  ): Promise<T | null> {
    const item = this.store.get(key);
    if (!item) return Promise.resolve(null);
    if (item.expiration && item.expiration < Date.now() / 1000) {
      this.store.delete(key);
      return Promise.resolve(null);
    }
    // Stored values are always strings. The generic `T` defaults to `string`
    // for callers that don't override it; for callers asking for `json` etc.
    // the mock is intentionally narrow and just hands the text back as `T`.
    return Promise.resolve(item.value as T);
  }

  getWithMetadata<T = string>(
    key: string,
    type?: KvStoreGetType,
  ): Promise<{ value: T | null; metadata: unknown }>;
  getWithMetadata<T = string>(
    key: string,
    options?: { type?: KvStoreGetType },
  ): Promise<{ value: T | null; metadata: unknown }>;
  getWithMetadata<T = string>(
    key: string,
    _typeOrOptions?: KvStoreGetType | { type?: KvStoreGetType },
  ): Promise<{ value: T | null; metadata: unknown }> {
    const item = this.store.get(key);
    if (!item) return Promise.resolve({ value: null, metadata: null });
    return Promise.resolve({
      value: item.value as T,
      metadata: item.metadata ?? null,
    });
  }

  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: Record<string, unknown>,
  ): Promise<void> {
    let expiration: number | undefined;
    const expirationOpt = options?.expiration as number | undefined;
    const expirationTtl = options?.expirationTtl as number | undefined;
    if (expirationOpt) {
      expiration = expirationOpt;
    } else if (expirationTtl) {
      expiration = Math.floor(Date.now() / 1000) + expirationTtl;
    }
    const stringValue = typeof value === "string"
      ? value
      : new TextDecoder().decode(
        value instanceof ArrayBuffer
          ? new Uint8Array(value)
          : ArrayBuffer.isView(value)
          ? new Uint8Array(
            value.buffer,
            value.byteOffset,
            value.byteLength,
          )
          : new Uint8Array(0),
      );
    this.store.set(key, {
      value: stringValue,
      metadata: options?.metadata,
      expiration,
    });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  list(options?: {
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
      .map(([name, { expiration, metadata }]) => ({
        name,
        expiration,
        metadata,
      }));

    if (options?.limit) {
      keys = keys.slice(0, options.limit);
    }

    return Promise.resolve({ keys, list_complete: true });
  }
}

/**
 * Mock message queue implementation for testing
 */
export class MockQueue<T = unknown> implements MessageQueueBinding<T> {
  private messages: Array<{ body: T; id: string }> = [];

  send(
    body: T,
    _options?: { contentType?: string; delaySeconds?: number },
  ): Promise<void> {
    this.messages.push({ body, id: crypto.randomUUID() });
    return Promise.resolve();
  }

  sendBatch(
    messages: Array<{ body: T; contentType?: string; delaySeconds?: number }>,
  ): Promise<void> {
    messages.forEach((m) =>
      this.messages.push({ body: m.body, id: crypto.randomUUID() })
    );
    return Promise.resolve();
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
export class MockDurableObjectNamespace
  implements DurableNamespaceBinding<MockDurableObjectStub> {
  private instances: Map<string, MockDurableObjectStub> = new Map();

  idFromName(name: string): MockDurableObjectId {
    return new MockDurableObjectId(name);
  }

  idFromString(id: string): MockDurableObjectId {
    return new MockDurableObjectId(id);
  }

  get(id: unknown): MockDurableObjectStub {
    const key = String(id);
    if (!this.instances.has(key)) {
      this.instances.set(
        key,
        new MockDurableObjectStub(new MockDurableObjectId(key)),
      );
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

  fetch(
    _input: Request | URL | string,
    _init?: RequestInit,
  ): Promise<Response> {
    return Promise.resolve(
      new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
}

/**
 * Mock VectorizeIndex implementation for testing
 */
type MockVectorRecord = {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
};

export class MockVectorizeIndex implements VectorizeIndex {
  private vectors: Map<string, MockVectorRecord> = new Map();

  insert(vectors: unknown[]): Promise<unknown> {
    (vectors as MockVectorRecord[]).forEach((v) => this.vectors.set(v.id, v));
    return Promise.resolve();
  }

  upsert(vectors: unknown[]): Promise<unknown> {
    (vectors as MockVectorRecord[]).forEach((v) => this.vectors.set(v.id, v));
    return Promise.resolve();
  }

  query(
    _vector: number[] | Float32Array,
    options?: unknown,
  ): Promise<{ matches: VectorizeMatch[] }> {
    const opts = (options ?? {}) as {
      topK?: number;
      returnValues?: boolean;
      returnMetadata?: boolean;
    };
    const topK = opts.topK || 10;
    const matches: VectorizeMatch[] = Array.from(this.vectors.values())
      .slice(0, topK)
      .map((v) => ({
        id: v.id,
        score: 0.9,
        ...(opts.returnValues ? { values: v.values } : {}),
        ...(opts.returnMetadata ? { metadata: v.metadata } : {}),
      }));
    return Promise.resolve({ matches });
  }

  deleteByIds(ids: string[]): Promise<unknown> {
    ids.forEach((id) => this.vectors.delete(id));
    return Promise.resolve();
  }
}

// ============================================================================
// Global Test Environment Setup
// ============================================================================

/**
 * Create a mock Env object for testing.
 *
 * Returns a value typed as `Env` so tests don't need to re-cast. The
 * Mock* binding classes are structural subsets of the runtime binding
 * interfaces — they implement the surface the routes under test
 * exercise. A single internal `satisfies`-style coercion bridges the
 * gap so each test site can pass `env` directly to `app.fetch`.
 */
export function createMockEnv(
  overrides: Partial<Record<string, unknown>> = {},
): Env {
  const env = {
    DB: new MockSqlDatabaseBinding(),
    HOSTNAME_ROUTING: new MockKvStoreBinding(),
    ROUTING_DO: new MockDurableObjectNamespace(),
    SESSION_DO: new MockDurableObjectNamespace(),
    RUN_NOTIFIER: new MockDurableObjectNamespace(),
    RUN_QUEUE: new MockQueue(),
    RUN_DLQ: new MockQueue(),
    INDEX_QUEUE: new MockQueue(),
    WORKER_BUNDLES: new MockObjectStoreBinding(),
    TENANT_BUILDS: new MockObjectStoreBinding(),
    TENANT_SOURCE: new MockObjectStoreBinding(),
    GIT_OBJECTS: new MockObjectStoreBinding(),
    VECTORIZE: new MockVectorizeIndex(),
    // Secrets and configuration
    OIDC_ISSUER_URL: "https://accounts.example.test",
    OIDC_CLIENT_ID: "test-oidc-client-id",
    OIDC_CLIENT_SECRET: "test-oidc-client-secret",
    OIDC_REDIRECT_URI: "https://test.takos.jp/auth/oidc/callback",
    ADMIN_DOMAIN: "test.takos.jp",
    TENANT_BASE_DOMAIN: "app.test.takos.jp",
    PLATFORM_PRIVATE_KEY: "test-private-key",
    PLATFORM_PUBLIC_KEY: "test-public-key",
    EXECUTOR_PROXY_SECRET: "test-executor-proxy-secret",
    CF_ACCOUNT_ID: "test-account-id",
    CF_API_TOKEN: "test-api-token",
    WFP_DISPATCH_NAMESPACE: "takos-tenants",
    OPENAI_API_KEY: "test-openai-key",
    RUNTIME_HOST: { fetch: spy() },
    ...overrides,
  };

  if (!("PLATFORM" in env)) {
    Object.assign(env, {
      PLATFORM: buildWorkersWebPlatform(asEnv(env)),
    });
  }

  return asEnv(env);
}

function asEnv(value: object): Env {
  return value as Env;
}

// ============================================================================
// Re-export test utilities
// ============================================================================

export * from "./helpers/factories.ts";
export * from "./helpers/api.ts";
