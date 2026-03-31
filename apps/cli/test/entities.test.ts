import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readStateFromFile as readState, writeStateToFile as writeState } from '../src/lib/state/state-file.ts';
import type { TakosState } from '../src/lib/state/state-types.ts';

// ── Test helpers ────────────────────────────────────────────────────────────

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';

const tempDirs: string[] = [];
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


  Deno.test('entities/resource - createResource updates state', async () => {
  try {
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
    assertNotEquals(loaded, null);
    assert(loaded!.resources['main-db'] !== undefined);
    assertEquals(loaded!.resources['main-db'].type, 'd1');
    assertEquals(loaded!.resources['main-db'].id, 'd1-uuid-001');
    assertEquals(loaded!.resources['main-db'].binding, 'DB');
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('entities/resource - listResources returns state entries', async () => {
  try {
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
    assertNotEquals(loaded, null);
    const resourceNames = Object.keys(loaded!.resources);
    assertEquals(resourceNames, ['db', 'cache', 'storage']);
    assertEquals(resourceNames.length, 3);
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('entities/resource - deleteResource removes from state', async () => {
  try {
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
    assertNotEquals(loaded, null);
    assertEquals(loaded!.resources['db'], undefined);
    assert(loaded!.resources['cache'] !== undefined);
    assertEquals(Object.keys(loaded!.resources).length, 1);
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
// ── entities/worker ─────────────────────────────────────────────────────────


  Deno.test('entities/worker - deployWorker updates state', async () => {
  try {
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
    assertNotEquals(loaded, null);
    assert(loaded!.workers['web'] !== undefined);
    assertEquals(loaded!.workers['web'].scriptName, 'test-group-production-web');
    assertEquals(loaded!.workers['web'].codeHash, 'sha256:abc123');
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('entities/worker - deleteWorker removes from state', async () => {
  try {
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
    assertNotEquals(loaded, null);
    assertEquals(loaded!.workers['web'], undefined);
    assert(loaded!.workers['api'] !== undefined);
    assertEquals(Object.keys(loaded!.workers).length, 1);
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('entities/worker - updateWorker changes codeHash and deployedAt', async () => {
  try {
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
    assertNotEquals(loaded, null);
    assertEquals(loaded!.workers['web'].codeHash, 'sha256:new');
    assertEquals(loaded!.workers['web'].deployedAt, newDeployedAt);
    // scriptName should not change
    assertEquals(loaded!.workers['web'].scriptName, 'test-web');
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})