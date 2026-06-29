import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import type {
  KvStoreBinding,
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../../shared/types/bindings.ts";
import type { ResourceCapability } from "../../../shared/types/index.ts";
import { randomHex } from "../../../shared/utils/encoding-utils.ts";
import {
  createPersistentKvStoreBinding,
  createPersistentObjectStore,
  createSchemaScopedPostgresSqlDatabase,
  createSqliteSqlDatabase,
} from "../../../local-platform/persistent-bindings.ts";
import {
  readJsonFile,
  writeJsonFile,
} from "../../../local-platform/persistent-shared.ts";
import {
  resolveLocalDataDir,
  resolvePostgresUrl,
} from "../../../node-platform/resolvers/env-utils.ts";
import { toResourceCapability } from "./capabilities.ts";
import {
  getPortableBackendResolution,
  missingPortableBootstrapRequirementsForBackend,
  normalizePortableBackend,
  resolvePortableQueueReferenceId as resolvePortableBackendQueueReferenceId,
  sanitizeName,
  sanitizeSqlIdentifier,
} from "./portable-runtime-backend-registry.ts";

export type PortableResourceRef = {
  id: string;
  backend_name?: string | null;
  backing_resource_id?: string | null;
  backing_resource_name?: string | null;
  config?: unknown;
};

export type PortableResourceResolutionMode =
  | "backend-backed"
  | "takos-runtime";

export type PortableResourceResolution = {
  mode: PortableResourceResolutionMode;
  backend: string;
  requirements: string[];
  notes?: string[];
};

type PortableManagedResourceHandler = {
  ensure?: (resource: PortableResourceRef) => Promise<void>;
  delete?: (resource: PortableResourceRef) => Promise<void>;
  resolveReferenceId?: (
    resource: PortableResourceRef,
  ) => Promise<string | null>;
};

const sqlCache = new Map<string, Promise<SqlDatabaseBinding>>();
const objectStoreCache = new Map<string, ObjectStoreBinding>();
const kvStoreCache = new Map<string, KvStoreBinding>();
// Process-global pool cache keyed by connection string. Constructing a new
// `pg.Pool(...)` per `ensure*` / `delete*` call was leaking sockets and TLS
// negotiations against the upstream Postgres server -- a tight retry loop
// would exhaust file descriptors. The cache lets the schema-scoped helpers
// reuse a single pool per connection string for the lifetime of the process.
const portablePostgresPoolCache = new Map<string, Pool>();

function getPortablePostgresPool(connectionString: string): Pool {
  const existing = portablePostgresPoolCache.get(connectionString);
  if (existing) return existing;
  const pool = new Pool({ connectionString });
  portablePostgresPoolCache.set(connectionString, pool);
  return pool;
}

function resolvePortableDataDir(): string {
  return resolveLocalDataDir() ?? path.join(os.tmpdir(), "takos-portable-data");
}

function resourceCacheKey(resource: PortableResourceRef): string {
  return `${resource.backend_name ?? "portable"}:${resource.id}:${
    resource.backing_resource_name ?? ""
  }`;
}

function resolveResourceBasePath(
  kind:
    | "sql"
    | "object-store"
    | "kv"
    | "queue"
    | "vector-index"
    | "analytics-store"
    | "workflow-runtime"
    | "durable-namespace"
    | "secret",
  resource: PortableResourceRef,
): string {
  const baseDir = resolvePortableDataDir();
  const fileBase = sanitizeName(resource.backing_resource_name ?? resource.id);
  return path.join(baseDir, "portable-resources", kind, fileBase);
}

function resolveControlMigrationsDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "db",
    "migrations",
  );
}

function resolvePortableSqlSchemaName(resource: PortableResourceRef): string {
  return `resource_${
    sanitizeSqlIdentifier(resource.backing_resource_name ?? resource.id)
  }`;
}

function resolvePortableVectorTableName(resource: PortableResourceRef): string {
  return `vector_${
    sanitizeSqlIdentifier(resource.backing_resource_name ?? resource.id)
  }`;
}

function usesPortablePostgres(resource: PortableResourceRef): boolean {
  return !!resolvePostgresUrl() &&
    !!resource.backend_name &&
    resource.backend_name !== "cloudflare" &&
    resource.backend_name !== "local";
}

export function describePortableResourceResolution(
  backendName?: string | null,
  typeOrCapability?: string | null,
): PortableResourceResolution | null {
  const capability = resourceCapability(typeOrCapability);
  if (!capability) return null;
  return getPortableBackendResolution(
    normalizePortableBackend(backendName),
    capability,
  );
}

async function removePath(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

async function ensureJsonStateFile<T>(
  filePath: string,
  initialValue: T,
): Promise<void> {
  const missing = Symbol("missing");
  const current = await readJsonFile<T | typeof missing>(filePath, missing);
  if (current === missing) {
    await writeJsonFile(filePath, initialValue);
  }
}

async function dropPortableSqlSchema(schemaName: string): Promise<void> {
  const postgresUrl = resolvePostgresUrl();
  if (!postgresUrl) return;

  const pool = getPortablePostgresPool(postgresUrl);
  const quotedSchema = `"${schemaName.replace(/"/g, '""')}"`;
  await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
}

function missingPortableBootstrapRequirements(
  resource: PortableResourceRef,
  capability: ResourceCapability,
): string[] {
  const backend = normalizePortableBackend(resource.backend_name);
  return missingPortableBootstrapRequirementsForBackend(backend, capability);
}

function assertPortableBootstrapRequirements(
  resource: PortableResourceRef,
  capability: ResourceCapability,
): void {
  const missing = missingPortableBootstrapRequirements(resource, capability);
  if (missing.length === 0) return;

  const resolution = describePortableResourceResolution(
    resource.backend_name,
    capability,
  );
  const backend = normalizePortableBackend(resource.backend_name);
  throw new Error(
    `${backend} ${capability} requires ${missing.join(", ")}` +
      (resolution ? ` (${resolution.backend})` : ""),
  );
}

async function ensurePortableVectorStore(
  resource: PortableResourceRef,
): Promise<void> {
  assertPortableBootstrapRequirements(resource, "vector_index");

  const postgresUrl = resolvePostgresUrl();
  if (!postgresUrl) return;

  const pool = getPortablePostgresPool(postgresUrl);
  const tableName = `"${
    resolvePortableVectorTableName(resource).replace(/"/g, '""')
  }"`;
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id TEXT PRIMARY KEY,
        embedding vector,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `);
}

async function dropPortableVectorStore(
  resource: PortableResourceRef,
): Promise<void> {
  const postgresUrl = resolvePostgresUrl();
  if (!postgresUrl) return;

  const pool = getPortablePostgresPool(postgresUrl);
  const tableName = `"${
    resolvePortableVectorTableName(resource).replace(/"/g, '""')
  }"`;
  await pool.query(`DROP TABLE IF EXISTS ${tableName}`);
}

async function ensurePortableBackendSecret(
  resource: PortableResourceRef,
): Promise<string> {
  return sanitizeName(resource.backing_resource_name ?? resource.id);
}

async function resolvePortableQueueReferenceId(
  resource: PortableResourceRef,
): Promise<string> {
  return await resolvePortableBackendQueueReferenceId(resource) ??
    sanitizeName(resource.backing_resource_name ?? resource.id);
}

async function ensurePortableQueueResource(
  resource: PortableResourceRef,
): Promise<void> {
  await ensureJsonStateFile(
    `${resolveResourceBasePath("queue", resource)}.json`,
    { messages: [] },
  );
}

async function deletePortableQueueResource(
  resource: PortableResourceRef,
): Promise<void> {
  await removePath(`${resolveResourceBasePath("queue", resource)}.json`);
}

async function ensurePortableObjectStoreResource(
  resource: PortableResourceRef,
): Promise<void> {
  await ensureJsonStateFile(
    `${resolveResourceBasePath("object-store", resource)}.json`,
    {
      objects: {},
      uploads: {},
    },
  );
}

async function ensurePortableKvResource(
  resource: PortableResourceRef,
): Promise<void> {
  assertPortableBootstrapRequirements(resource, "kv");
  await ensureJsonStateFile(
    `${resolveResourceBasePath("kv", resource)}.json`,
    {},
  );
}

async function deletePortableSqlResource(
  resource: PortableResourceRef,
): Promise<void> {
  const key = resourceCacheKey(resource);
  const cached = sqlCache.get(key);
  if (cached) {
    const db = await cached;
    (db as SqlDatabaseBinding & { close?: () => void }).close?.();
  }
  sqlCache.delete(key);
  if (usesPortablePostgres(resource)) {
    await dropPortableSqlSchema(resolvePortableSqlSchemaName(resource));
    return;
  }

  await removePath(`${resolveResourceBasePath("sql", resource)}.sqlite`);
}

async function deletePortableObjectStoreResource(
  resource: PortableResourceRef,
): Promise<void> {
  objectStoreCache.delete(resourceCacheKey(resource));
  await removePath(`${resolveResourceBasePath("object-store", resource)}.json`);
}

async function deletePortableKvResource(
  resource: PortableResourceRef,
): Promise<void> {
  kvStoreCache.delete(resourceCacheKey(resource));
  await removePath(`${resolveResourceBasePath("kv", resource)}.json`);
}

async function deletePortableBackendSecret(
  resource: PortableResourceRef,
): Promise<void> {
  await removePath(
    markerFilePath(markerKindForCapability("secret"), resource),
  );
}

export async function resolvePortableResourceReferenceId(
  resource: PortableResourceRef,
  capability: ResourceCapability,
): Promise<string | null> {
  return await PORTABLE_MANAGED_RESOURCE_HANDLERS[capability]
    ?.resolveReferenceId?.(resource) ?? null;
}

function markerFilePath(kind: string, resource: PortableResourceRef): string {
  switch (kind) {
    case "vector-index":
      return `${resolveResourceBasePath("vector-index", resource)}.json`;
    case "analytics-store":
      return `${resolveResourceBasePath("analytics-store", resource)}.json`;
    case "workflow-runtime":
      return `${resolveResourceBasePath("workflow-runtime", resource)}.json`;
    case "durable-namespace":
      return `${resolveResourceBasePath("durable-namespace", resource)}.json`;
    case "secret":
      return `${resolveResourceBasePath("secret", resource)}.json`;
    default:
      return `${resolveResourceBasePath("secret", resource)}-${
        sanitizeName(kind)
      }.json`;
  }
}

function markerPayload(
  kind: string,
  resource: PortableResourceRef,
): Record<string, unknown> {
  const base = {
    kind,
    resourceId: resource.id,
    backendName: resource.backend_name ?? null,
    backingResourceName: resource.backing_resource_name ?? null,
  };

  switch (kind) {
    case "vector-index":
      return {
        ...base,
        vectors: {},
      };
    case "analytics-store":
      return {
        ...base,
        dataset: resource.backing_resource_name ?? resource.id,
        datapoints: [],
      };
    case "workflow-runtime":
      return {
        ...base,
        workflowName: resource.backing_resource_name ?? resource.id,
        instances: {},
      };
    case "durable-namespace":
      return {
        ...base,
        namespaces: {},
      };
    case "secret":
      return {
        ...base,
        value: randomHex(32),
      };
    default:
      return base;
  }
}

function markerKindForCapability(capability: ResourceCapability): string {
  switch (capability) {
    case "vector_index":
      return "vector-index";
    case "analytics_store":
      return "analytics-store";
    case "workflow_runtime":
      return "workflow-runtime";
    case "durable_namespace":
      return "durable-namespace";
    case "secret":
      return "secret";
    default:
      return capability;
  }
}

export async function getPortableSecretValue(
  resource: PortableResourceRef,
): Promise<string> {
  const secretPath = markerFilePath("secret", resource);
  const existing = await readJsonFile<Record<string, unknown> | null>(
    secretPath,
    null,
  );
  if (typeof existing?.value === "string" && existing.value.length > 0) {
    return existing.value;
  }

  const payload = markerPayload("secret", resource);
  await writeJsonFile(secretPath, payload);
  return payload.value as string;
}

export function isPortableResourceBackend(
  backendName?: string | null,
): boolean {
  return !!backendName && backendName !== "cloudflare";
}

export async function getPortableSqlDatabase(
  resource: PortableResourceRef,
): Promise<SqlDatabaseBinding> {
  const key = resourceCacheKey(resource);
  const existing = sqlCache.get(key);
  if (existing) return existing;

  const postgresUrl = resolvePostgresUrl();
  if (
    resource.backend_name && resource.backend_name !== "cloudflare" &&
    resource.backend_name !== "local" && !postgresUrl
  ) {
    throw new Error(
      `${resource.backend_name} sql requires POSTGRES_URL or DATABASE_URL (postgres-schema-d1-adapter)`,
    );
  }

  let created;
  if (usesPortablePostgres(resource)) {
    if (!postgresUrl) {
      throw new Error(
        "portable postgres sql invariant violated: postgresUrl must be set when usesPortablePostgres is true",
      );
    }
    created = createSchemaScopedPostgresSqlDatabase(
      postgresUrl,
      resolvePortableSqlSchemaName(resource),
    );
  } else {
    created = createSqliteSqlDatabase(
      `${resolveResourceBasePath("sql", resource)}.sqlite`,
      resolveControlMigrationsDir(),
    );
  }
  sqlCache.set(key, created);
  return created;
}

export function createPrefixedKvNamespace(
  base: KvStoreBinding,
  prefix: string,
): KvStoreBinding {
  const prefixValue = `${prefix}:`;
  const withPrefix = (key: string) => `${prefixValue}${key}`;
  const stripPrefix = (key: string) =>
    key.startsWith(prefixValue) ? key.slice(prefixValue.length) : key;

  const namespace = {
    async get(key: string, type?: "text" | "json" | "arrayBuffer" | "stream") {
      return base.get(withPrefix(key), type);
    },
    async getWithMetadata(
      key: string,
      type?: "text" | "json" | "arrayBuffer" | "stream",
    ) {
      return base.getWithMetadata(withPrefix(key), type);
    },
    async put(
      key: string,
      value: string | ArrayBuffer | ReadableStream,
      options?: {
        expirationTtl?: number;
        expiration?: number;
        metadata?: Record<string, string>;
      },
    ) {
      await base.put(withPrefix(key), value, options);
    },
    async delete(key: string) {
      await base.delete(withPrefix(key));
    },
    async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
      const result = await base.list({
        limit: options?.limit,
        cursor: options?.cursor,
        prefix: withPrefix(options?.prefix ?? ""),
      });
      return {
        ...result,
        keys: (result.keys ?? [])
          .filter((entry: { name: string }) =>
            entry.name.startsWith(prefixValue)
          )
          .map((entry: { name: string }) => ({
            ...entry,
            name: stripPrefix(entry.name),
          })),
      };
    },
  };

  return namespace as KvStoreBinding;
}

export function getPortableObjectStore(
  resource: PortableResourceRef,
): ObjectStoreBinding {
  const key = resourceCacheKey(resource);
  const existing = objectStoreCache.get(key);
  if (existing) return existing;

  const bucket = createPersistentObjectStore(
    `${resolveResourceBasePath("object-store", resource)}.json`,
  );
  objectStoreCache.set(key, bucket);
  return bucket;
}

export function getPortableKvStore(
  resource: PortableResourceRef,
): KvStoreBinding {
  const key = resourceCacheKey(resource);
  const existing = kvStoreCache.get(key);
  if (existing) return existing;

  const kv = createPersistentKvStoreBinding(
    `${resolveResourceBasePath("kv", resource)}.json`,
  );
  kvStoreCache.set(key, kv);
  return kv;
}

async function ensurePortableSqlResource(
  resource: PortableResourceRef,
): Promise<void> {
  assertPortableBootstrapRequirements(resource, "sql");
  await getPortableSqlDatabase(resource);
}

async function ensurePortableSecretResource(
  resource: PortableResourceRef,
): Promise<void> {
  assertPortableBootstrapRequirements(resource, "secret");
  await getPortableSecretValue(resource);
}

async function deletePortableMarkerResource(
  resource: PortableResourceRef,
  capability: ResourceCapability,
): Promise<void> {
  await removePath(
    markerFilePath(markerKindForCapability(capability), resource),
  );
}

async function deletePortableVectorIndexResource(
  resource: PortableResourceRef,
): Promise<void> {
  await dropPortableVectorStore(resource);
  await deletePortableMarkerResource(resource, "vector_index");
}

const PORTABLE_MANAGED_RESOURCE_HANDLERS: Partial<
  Record<ResourceCapability, PortableManagedResourceHandler>
> = {
  sql: {
    ensure: ensurePortableSqlResource,
    delete: deletePortableSqlResource,
  },
  object_store: {
    ensure: ensurePortableObjectStoreResource,
    delete: deletePortableObjectStoreResource,
  },
  kv: {
    ensure: ensurePortableKvResource,
    delete: deletePortableKvResource,
  },
  queue: {
    ensure: async (resource) => {
      assertPortableBootstrapRequirements(resource, "queue");
      await ensurePortableQueueResource(resource);
    },
    delete: deletePortableQueueResource,
    resolveReferenceId: resolvePortableQueueReferenceId,
  },
  vector_index: {
    ensure: ensurePortableVectorStore,
    delete: deletePortableVectorIndexResource,
  },
  analytics_store: {
    delete: async (resource) => {
      await deletePortableMarkerResource(resource, "analytics_store");
    },
  },
  workflow_runtime: {
    delete: async (resource) => {
      await deletePortableMarkerResource(resource, "workflow_runtime");
    },
  },
  durable_namespace: {
    delete: async (resource) => {
      await deletePortableMarkerResource(resource, "durable_namespace");
    },
  },
  secret: {
    ensure: ensurePortableSecretResource,
    delete: deletePortableBackendSecret,
    resolveReferenceId: ensurePortableBackendSecret,
  },
};

function resourceCapability(
  typeOrCapability?: string | null,
): ResourceCapability | null {
  return toResourceCapability(typeOrCapability);
}

export async function ensurePortableManagedResource(
  resource: PortableResourceRef,
  typeOrCapability?: string | null,
): Promise<void> {
  const capability = resourceCapability(typeOrCapability);
  if (!capability) return;
  await PORTABLE_MANAGED_RESOURCE_HANDLERS[capability]?.ensure?.(resource);
}

export async function deletePortableManagedResource(
  resource: PortableResourceRef,
  typeOrCapability?: string | null,
): Promise<void> {
  const capability = resourceCapability(typeOrCapability);
  if (!capability) return;
  await PORTABLE_MANAGED_RESOURCE_HANDLERS[capability]?.delete?.(resource);
}

export function resetPortableResourceRuntimeCachesForTests(): void {
  sqlCache.clear();
  objectStoreCache.clear();
  kvStoreCache.clear();
  for (const pool of portablePostgresPoolCache.values()) {
    void pool.end().catch(() =>
      undefined /* best-effort: pool may already be closed in test teardown */
    );
  }
  portablePostgresPoolCache.clear();
}
