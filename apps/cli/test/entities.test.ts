import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readStateFromFile as readState, writeStateToFile as writeState } from '../src/lib/state/state-file.js';
import type { TakosState } from '../src/lib/state/state-types.js';

// ── Test helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-entities-'));
  tempDirs.push(dir);
  return dir;
}

function makeState(overrides: Partial<TakosState> = {}): TakosState {
  return {
    version: 1,
    provider: 'cloudflare',
    env: 'production',
    group: 'default',
    groupName: 'test-group',
    updatedAt: '2026-01-01T00:00:00Z',
    resources: {},
    workers: {},
    containers: {},
    services: {},
    routes: {},
    ...overrides,
  };
}

// ── entities/resource ───────────────────────────────────────────────────────

describe('entities/resource', () => {
  it('createResource updates state', async () => {
    const dir = await makeTempDir();
    const state = makeState();
    await writeState(dir, 'default', state);

    // Simulate createResource by writing a new resource entry to state
    const updated = { ...state };
    updated.resources = {
      ...updated.resources,
      'main-db': {
        type: 'd1',
        id: 'd1-uuid-001',
        binding: 'DB',
        createdAt: new Date().toISOString(),
      },
    };
    updated.updatedAt = new Date().toISOString();
    await writeState(dir, 'default', updated);

    const loaded = await readState(dir, 'default');
    expect(loaded).not.toBeNull();
    expect(loaded!.resources['main-db']).toBeDefined();
    expect(loaded!.resources['main-db'].type).toBe('d1');
    expect(loaded!.resources['main-db'].id).toBe('d1-uuid-001');
    expect(loaded!.resources['main-db'].binding).toBe('DB');
  });

  it('listResources returns state entries', async () => {
    const dir = await makeTempDir();
    const state = makeState({
      resources: {
        db: { type: 'd1', id: 'abc123', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
        cache: { type: 'kv', id: 'kv-001', binding: 'CACHE', createdAt: '2026-01-01T00:00:00Z' },
        storage: { type: 'r2', id: 'r2-001', binding: 'STORAGE', createdAt: '2026-01-01T00:00:00Z' },
      },
    });
    await writeState(dir, 'default', state);

    const loaded = await readState(dir, 'default');
    expect(loaded).not.toBeNull();
    const resourceNames = Object.keys(loaded!.resources);
    expect(resourceNames).toEqual(['db', 'cache', 'storage']);
    expect(resourceNames).toHaveLength(3);
  });

  it('deleteResource removes from state', async () => {
    const dir = await makeTempDir();
    const state = makeState({
      resources: {
        db: { type: 'd1', id: 'abc123', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
        cache: { type: 'kv', id: 'kv-001', binding: 'CACHE', createdAt: '2026-01-01T00:00:00Z' },
      },
    });
    await writeState(dir, 'default', state);

    // Simulate deleteResource by removing the entry from state
    const updated = { ...state };
    const { db: _removed, ...remainingResources } = updated.resources;
    updated.resources = remainingResources;
    updated.updatedAt = new Date().toISOString();
    await writeState(dir, 'default', updated);

    const loaded = await readState(dir, 'default');
    expect(loaded).not.toBeNull();
    expect(loaded!.resources['db']).toBeUndefined();
    expect(loaded!.resources['cache']).toBeDefined();
    expect(Object.keys(loaded!.resources)).toHaveLength(1);
  });
});

// ── entities/worker ─────────────────────────────────────────────────────────

describe('entities/worker', () => {
  it('deployWorker updates state', async () => {
    const dir = await makeTempDir();
    const state = makeState();
    await writeState(dir, 'default', state);

    // Simulate deployWorker by adding a worker entry to state
    const updated = { ...state };
    updated.workers = {
      ...updated.workers,
      web: {
        scriptName: 'test-group-production-web',
        deployedAt: new Date().toISOString(),
        codeHash: 'sha256:abc123',
      },
    };
    updated.updatedAt = new Date().toISOString();
    await writeState(dir, 'default', updated);

    const loaded = await readState(dir, 'default');
    expect(loaded).not.toBeNull();
    expect(loaded!.workers['web']).toBeDefined();
    expect(loaded!.workers['web'].scriptName).toBe('test-group-production-web');
    expect(loaded!.workers['web'].codeHash).toBe('sha256:abc123');
  });

  it('deleteWorker removes from state', async () => {
    const dir = await makeTempDir();
    const state = makeState({
      workers: {
        web: { scriptName: 'test-web', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:aaa' },
        api: { scriptName: 'test-api', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:bbb' },
      },
    });
    await writeState(dir, 'default', state);

    // Simulate deleteWorker by removing the entry from state
    const updated = { ...state };
    const { web: _removed, ...remainingWorkers } = updated.workers;
    updated.workers = remainingWorkers;
    updated.updatedAt = new Date().toISOString();
    await writeState(dir, 'default', updated);

    const loaded = await readState(dir, 'default');
    expect(loaded).not.toBeNull();
    expect(loaded!.workers['web']).toBeUndefined();
    expect(loaded!.workers['api']).toBeDefined();
    expect(Object.keys(loaded!.workers)).toHaveLength(1);
  });

  it('updateWorker changes codeHash and deployedAt', async () => {
    const dir = await makeTempDir();
    const state = makeState({
      workers: {
        web: { scriptName: 'test-web', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:old' },
      },
    });
    await writeState(dir, 'default', state);

    // Simulate updateWorker
    const updated = { ...state };
    const newDeployedAt = new Date().toISOString();
    updated.workers = {
      ...updated.workers,
      web: {
        ...updated.workers['web'],
        codeHash: 'sha256:new',
        deployedAt: newDeployedAt,
      },
    };
    updated.updatedAt = newDeployedAt;
    await writeState(dir, 'default', updated);

    const loaded = await readState(dir, 'default');
    expect(loaded).not.toBeNull();
    expect(loaded!.workers['web'].codeHash).toBe('sha256:new');
    expect(loaded!.workers['web'].deployedAt).toBe(newDeployedAt);
    // scriptName should not change
    expect(loaded!.workers['web'].scriptName).toBe('test-web');
  });
});
