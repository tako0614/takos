import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RoutingRecord, RoutingStore, RoutingTarget } from '../application/services/routing/types.ts';

type RoutingState = Record<string, RoutingRecord>;

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function cloneRecord(record: RoutingRecord | null): RoutingRecord | null {
  return record ? JSON.parse(JSON.stringify(record)) as RoutingRecord : null;
}

export function createInMemoryRoutingStore(): RoutingStore {
  const records = new Map<string, RoutingRecord>();

  return {
    async getRecord(hostname: string): Promise<RoutingRecord | null> {
      return cloneRecord(records.get(normalizeHostname(hostname)) ?? null);
    },
    async putRecord(hostname: string, target: RoutingTarget, updatedAt: number): Promise<RoutingRecord> {
      const key = normalizeHostname(hostname);
      const current = records.get(key);
      const next: RoutingRecord = {
        hostname: key,
        target,
        version: (current?.version ?? 0) + 1,
        updatedAt,
      };
      records.set(key, next);
      return cloneRecord(next)!;
    },
    async deleteRecord(hostname: string, tombstoneTtlMs: number, updatedAt: number): Promise<RoutingRecord> {
      const key = normalizeHostname(hostname);
      const current = records.get(key);
      const next: RoutingRecord = {
        hostname: key,
        target: null,
        version: (current?.version ?? 0) + 1,
        updatedAt,
        tombstoneUntil: updatedAt + tombstoneTtlMs,
      };
      records.set(key, next);
      return cloneRecord(next)!;
    },
  };
}

async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

async function readState(filePath: string): Promise<RoutingState> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as RoutingState;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeState(filePath: string, state: RoutingState): Promise<void> {
  await ensureParentDirectory(filePath);
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function createPersistentRoutingStore(filePath: string): RoutingStore {
  let cache: RoutingState | null = null;

  async function loadState(): Promise<RoutingState> {
    if (cache) return cache;
    cache = await readState(filePath);
    return cache;
  }

  async function flushState(): Promise<void> {
    if (!cache) return;
    await writeState(filePath, cache);
  }

  return {
    async getRecord(hostname: string): Promise<RoutingRecord | null> {
      const state = await loadState();
      return cloneRecord(state[normalizeHostname(hostname)] ?? null);
    },
    async putRecord(hostname: string, target: RoutingTarget, updatedAt: number): Promise<RoutingRecord> {
      const state = await loadState();
      const key = normalizeHostname(hostname);
      const current = state[key];
      const next: RoutingRecord = {
        hostname: key,
        target,
        version: (current?.version ?? 0) + 1,
        updatedAt,
      };
      state[key] = next;
      await flushState();
      return cloneRecord(next)!;
    },
    async deleteRecord(hostname: string, tombstoneTtlMs: number, updatedAt: number): Promise<RoutingRecord> {
      const state = await loadState();
      const key = normalizeHostname(hostname);
      const current = state[key];
      const next: RoutingRecord = {
        hostname: key,
        target: null,
        version: (current?.version ?? 0) + 1,
        updatedAt,
        tombstoneUntil: updatedAt + tombstoneTtlMs,
      };
      state[key] = next;
      await flushState();
      return cloneRecord(next)!;
    },
  };
}
