import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { D1Database, KVNamespace, R2Bucket } from '../../../shared/types/bindings.ts';
import { createPersistentKVNamespace, createPersistentR2Bucket, createSqliteD1Database } from '../../../local-platform/persistent-bindings.ts';
import { resolveLocalDataDir } from '../../../node-platform/resolvers/env-utils.ts';

type PortableResourceRef = {
  id: string;
  provider_name?: string | null;
  provider_resource_name?: string | null;
};

const sqlCache = new Map<string, Promise<D1Database>>();
const objectStoreCache = new Map<string, R2Bucket>();
const kvStoreCache = new Map<string, KVNamespace>();

function sanitizeName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return sanitized || 'resource';
}

function resolvePortableDataDir(): string {
  return resolveLocalDataDir() ?? path.join(os.tmpdir(), 'takos-portable-data');
}

function resolveResourceBasePath(kind: 'sql' | 'object-store' | 'kv', resource: PortableResourceRef): string {
  const baseDir = resolvePortableDataDir();
  const fileBase = sanitizeName(resource.provider_resource_name ?? resource.id);
  return path.join(baseDir, 'managed-resources', kind, fileBase);
}

function resolveControlMigrationsDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
    'db',
    'migrations',
  );
}

export function isPortableResourceProvider(providerName?: string | null): boolean {
  return !!providerName && providerName !== 'cloudflare';
}

export async function getPortableSqlDatabase(resource: PortableResourceRef): Promise<D1Database> {
  const key = resource.id;
  const existing = sqlCache.get(key);
  if (existing) return existing;

  const databasePath = `${resolveResourceBasePath('sql', resource)}.sqlite`;
  const created = createSqliteD1Database(databasePath, resolveControlMigrationsDir());
  sqlCache.set(key, created);
  return created;
}

export function getPortableObjectStore(resource: PortableResourceRef): R2Bucket {
  const key = resource.id;
  const existing = objectStoreCache.get(key);
  if (existing) return existing;

  const bucket = createPersistentR2Bucket(`${resolveResourceBasePath('object-store', resource)}.json`);
  objectStoreCache.set(key, bucket);
  return bucket;
}

export function getPortableKvStore(resource: PortableResourceRef): KVNamespace {
  const key = resource.id;
  const existing = kvStoreCache.get(key);
  if (existing) return existing;

  const kv = createPersistentKVNamespace(`${resolveResourceBasePath('kv', resource)}.json`);
  kvStoreCache.set(key, kv);
  return kv;
}
