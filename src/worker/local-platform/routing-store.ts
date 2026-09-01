import type {
  RoutingRecord,
  RoutingStore,
  RoutingTarget,
} from "../application/services/routing/routing-models.ts";
import { readJsonFile, writeJsonFile } from "./persistent-shared.ts";
import { cloneRecord, normalizeHostname } from "./routing-record.ts";

type RoutingState = Record<string, RoutingRecord>;

export function createInMemoryRoutingStore(): RoutingStore {
  const records = new Map<string, RoutingRecord>();

  return {
    async getRecord(hostname: string): Promise<RoutingRecord | null> {
      return cloneRecord(records.get(normalizeHostname(hostname)) ?? null);
    },
    async putRecord(
      hostname: string,
      target: RoutingTarget,
      updatedAt: number,
    ): Promise<RoutingRecord> {
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
    async deleteRecord(
      hostname: string,
      tombstoneTtlMs: number,
      updatedAt: number,
    ): Promise<RoutingRecord> {
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

export function createPersistentRoutingStore(filePath: string): RoutingStore {
  let cache: RoutingState | null = null;

  async function loadState(): Promise<RoutingState> {
    if (cache) return cache;
    cache = await readJsonFile<RoutingState>(filePath, {});
    return cache;
  }

  async function flushState(): Promise<void> {
    if (!cache) return;
    await writeJsonFile(filePath, cache);
  }

  return {
    async getRecord(hostname: string): Promise<RoutingRecord | null> {
      const state = await loadState();
      return cloneRecord(state[normalizeHostname(hostname)] ?? null);
    },
    async putRecord(
      hostname: string,
      target: RoutingTarget,
      updatedAt: number,
    ): Promise<RoutingRecord> {
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
    async deleteRecord(
      hostname: string,
      tombstoneTtlMs: number,
      updatedAt: number,
    ): Promise<RoutingRecord> {
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
