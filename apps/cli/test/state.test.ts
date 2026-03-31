import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from 'jsr:@std/assert';
import type { AppManifest } from '../src/lib/app-manifest.ts';
import { computeDiff, computeWorkerDiff } from '../src/lib/state/diff.ts';
import { formatPlan } from '../src/lib/state/plan.ts';
import { readStateFromFile as readState, writeStateToFile as writeState } from '../src/lib/state/state-file.ts';
import type { TakosState } from '../src/lib/state/state-types.ts';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-state-'));
  tempDirs.push(dir);
  return dir;
}

async function cleanupTempDirs(): Promise<void> {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
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

function makeManifest(spec: Partial<AppManifest['spec']> = {}): AppManifest {
  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'App',
    metadata: { name: 'test-app' },
    spec: {
      version: '1.0.0',
      workers: {
        web: {
          build: {
            fromWorkflow: {
              path: '.takos/workflows/build.yml',
              job: 'build',
              artifact: 'dist',
              artifactPath: 'dist/',
            },
          },
        },
      },
      ...spec,
    },
  };
}

Deno.test('state-file - readState returns null when state file does not exist', async () => {
  try {
    const dir = await makeTempDir();
    const result = await readState(dir, 'default');
    assertEquals(result, null);
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('state-file - writeState + readState roundtrip', async () => {
  try {
    const dir = await makeTempDir();
    const state = makeState({
      resources: {
        db: { type: 'd1', id: 'abc123', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
      },
      workers: {
        web: { scriptName: 'test-web', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:aaa' },
      },
    });

    await writeState(dir, 'default', state);
    const loaded = await readState(dir, 'default');
    assertEquals(loaded, state);
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('state-file - writeState creates directory if missing', async () => {
  try {
    const dir = await makeTempDir();
    const nested = path.join(dir, 'nested', 'deep');
    const state = makeState();

    await writeState(nested, 'default', state);
    const loaded = await readState(nested, 'default');
    assertEquals(loaded, state);
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('state-file - readState propagates non-ENOENT errors', async () => {
  try {
    const dir = await makeTempDir();
    const stateFilePath = path.join(dir, 'state.default.json');
    await fs.mkdir(stateFilePath, { recursive: true });

    await assertRejects(() => readState(dir, 'default'));
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('computeDiff - initial deploy (current = null) marks everything as create', async () => {
  try {
    const manifest = makeManifest({
      resources: {
        db: { type: 'd1', binding: 'DB' },
        cache: { type: 'kv' },
      },
    });

    const result = computeDiff(manifest, null);

    assertEquals(result.hasChanges, true);
    assertEquals(result.summary.create, 3);
    assertEquals(result.summary.update, 0);
    assertEquals(result.summary.delete, 0);
    assertEquals(result.summary.unchanged, 0);

    assertEquals(result.entries.find((e) => e.name === 'db'), {
      name: 'db',
      category: 'resource',
      action: 'create',
      type: 'd1',
      reason: 'new',
    });

    assertEquals(result.entries.find((e) => e.name === 'web'), {
      name: 'web',
      category: 'worker',
      action: 'create',
      type: 'worker',
      reason: 'new',
    });
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('computeDiff - unchanged resources and workers', async () => {
  try {
    const manifest = makeManifest({
      resources: {
        db: { type: 'd1', binding: 'DB' },
      },
    });

    const current = makeState({
      resources: {
        db: { type: 'd1', id: 'abc', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
      },
      workers: {
        web: { scriptName: 'web', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:aaa' },
      },
    });

    const result = computeDiff(manifest, current);

    assertEquals(result.hasChanges, false);
    assertEquals(result.summary.unchanged, 2);
    assertEquals(result.entries.every((e) => e.action === 'unchanged'), true);
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('computeDiff - detects deleted resources and workers', async () => {
  try {
    const manifest = makeManifest({
      resources: {},
      workers: {},
    });

    const current = makeState({
      resources: {
        db: { type: 'd1', id: 'abc', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
      },
      workers: {
        old: { scriptName: 'old', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:xxx' },
      },
    });

    const result = computeDiff(manifest, current);

    assertEquals(result.hasChanges, true);
    assertEquals(result.summary.delete, 2);

    assertEquals(result.entries.find((e) => e.name === 'db')?.action, 'delete');
    assertEquals(result.entries.find((e) => e.name === 'db')?.reason, 'removed from manifest');
    assertEquals(result.entries.find((e) => e.name === 'old')?.action, 'delete');
    assertEquals(result.entries.find((e) => e.name === 'old')?.reason, 'removed from manifest');
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('computeDiff - throws on resource type change', async () => {
  try {
    const manifest = makeManifest({
      resources: {
        db: { type: 'r2' },
      },
    });

    const current = makeState({
      resources: {
        db: { type: 'd1', id: 'abc', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
      },
    });

    assertThrows(
      () => computeDiff(manifest, current),
      Error,
      'Resource "db" type changed from "d1" to "r2"',
    );
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('computeDiff - handles mixed create, unchanged, delete', async () => {
  try {
    const manifest = makeManifest({
      resources: {
        db: { type: 'd1', binding: 'DB' },
        newcache: { type: 'kv' },
      },
      workers: {
        web: {
          build: {
            fromWorkflow: {
              path: '.takos/workflows/build.yml',
              job: 'build',
              artifact: 'dist',
              artifactPath: 'dist/',
            },
          },
        },
        api: {
          build: {
            fromWorkflow: {
              path: '.takos/workflows/build.yml',
              job: 'build-api',
              artifact: 'api-dist',
              artifactPath: 'api-dist/',
            },
          },
        },
      },
    });

    const current = makeState({
      resources: {
        db: { type: 'd1', id: 'abc', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
        oldqueue: { type: 'queue', id: 'q1', binding: 'Q', createdAt: '2026-01-01T00:00:00Z' },
      },
      workers: {
        web: { scriptName: 'web', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:aaa' },
      },
    });

    const result = computeDiff(manifest, current);

    assertEquals(result.hasChanges, true);
    assertEquals(result.summary, { create: 2, update: 0, delete: 1, unchanged: 2 });
    assertEquals(result.entries.find((e) => e.name === 'newcache')?.action, 'create');
    assertEquals(result.entries.find((e) => e.name === 'api')?.action, 'create');
    assertEquals(result.entries.find((e) => e.name === 'oldqueue')?.action, 'delete');
    assertEquals(result.entries.find((e) => e.name === 'db')?.action, 'unchanged');
    assertEquals(result.entries.find((e) => e.name === 'web')?.action, 'unchanged');
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('computeDiff - handles containers and services in extended manifest', async () => {
  try {
    const manifest = makeManifest();
    manifest.spec.containers = { runner: { dockerfile: 'Dockerfile' } as any };
    manifest.spec.services = { backend: { dockerfile: 'Dockerfile' } as any };

    const result = computeDiff(manifest, null);

    assertEquals(result.entries.find((e) => e.name === 'runner'), {
      name: 'runner',
      category: 'container',
      action: 'create',
      type: 'container',
      reason: 'new',
    });
    assertEquals(result.entries.find((e) => e.name === 'backend'), {
      name: 'backend',
      category: 'service',
      action: 'create',
      type: 'service',
      reason: 'new',
    });
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('computeDiff - detects deleted containers and services', async () => {
  try {
    const manifest = makeManifest();

    const current = makeState({
      containers: {
        runner: { deployedAt: '2026-01-01T00:00:00Z', imageHash: 'sha256:bbb' },
      },
      services: {
        backend: { deployedAt: '2026-01-01T00:00:00Z', imageHash: 'sha256:ccc', ipv4: '1.2.3.4' },
      },
    });

    const result = computeDiff(manifest, current);

    assertEquals(result.entries.find((e) => e.name === 'runner')?.action, 'delete');
    assertEquals(result.entries.find((e) => e.name === 'backend')?.action, 'delete');
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('computeWorkerDiff - returns create for new worker', async () => {
  try {
    const entry = computeWorkerDiff('api', 'sha256:new', null);
    assertEquals(entry.action, 'create');
    assertEquals(entry.reason, 'new');
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('computeWorkerDiff - returns update when codeHash differs', async () => {
  try {
    const current = makeState({
      workers: {
        api: { scriptName: 'api', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:old' },
      },
    });
    const entry = computeWorkerDiff('api', 'sha256:new', current);
    assertEquals(entry.action, 'update');
    assertEquals(entry.reason, 'code changed');
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('computeWorkerDiff - returns unchanged when codeHash matches', async () => {
  try {
    const current = makeState({
      workers: {
        api: { scriptName: 'api', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:same' },
      },
    });
    const entry = computeWorkerDiff('api', 'sha256:same', current);
    assertEquals(entry.action, 'unchanged');
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('formatPlan - returns "no changes" message when entries are empty', async () => {
  try {
    const result = formatPlan({
      entries: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
    });
    assertEquals(result, '変更はありません。');
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('formatPlan - formats entries with correct symbols', async () => {
  try {
    const result = formatPlan({
      entries: [
        { name: 'db', category: 'resource', action: 'create', type: 'd1', reason: 'new' },
        { name: 'web', category: 'worker', action: 'update', type: 'worker', reason: 'code changed' },
        { name: 'old', category: 'worker', action: 'delete', type: 'worker', reason: 'removed from manifest' },
        { name: 'cache', category: 'resource', action: 'unchanged', type: 'kv' },
      ],
      hasChanges: true,
      summary: { create: 1, update: 1, delete: 1, unchanged: 1 },
    });

    const lines = result.split('\n');
    assertStringIncludes(lines[0], '+ db');
    assertStringIncludes(lines[0], 'd1');
    assertStringIncludes(lines[0], 'new');

    assertStringIncludes(lines[1], '~ web');
    assertStringIncludes(lines[1], 'worker');
    assertStringIncludes(lines[1], 'code changed');

    assertStringIncludes(lines[2], '- old');
    assertStringIncludes(lines[2], 'worker');
    assertStringIncludes(lines[2], 'removed from manifest');

    assertStringIncludes(lines[3], '= cache');
    assertStringIncludes(lines[3], 'kv');
    assertStringIncludes(lines[3], '変更なし');

    const summaryLine = lines[lines.length - 1];
    assertStringIncludes(summaryLine, '作成: 1');
    assertStringIncludes(summaryLine, '更新: 1');
    assertStringIncludes(summaryLine, '削除: 1');
    assertStringIncludes(summaryLine, '変更なし: 1');
  } finally {
    await cleanupTempDirs();
  }
});

Deno.test('formatPlan - omits zero counts from summary', async () => {
  try {
    const result = formatPlan({
      entries: [
        { name: 'db', category: 'resource', action: 'create', type: 'd1', reason: 'new' },
      ],
      hasChanges: true,
      summary: { create: 1, update: 0, delete: 0, unchanged: 0 },
    });

    const summaryLine = result.split('\n').pop()!;
    assertEquals(summaryLine, '作成: 1');
    assert(!summaryLine.includes('更新'));
    assert(!summaryLine.includes('削除'));
    assert(!summaryLine.includes('変更なし'));
  } finally {
    await cleanupTempDirs();
  }
});
