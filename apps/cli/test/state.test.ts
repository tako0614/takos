import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppManifest } from '../src/lib/app-manifest.ts';
import { computeDiff, computeWorkerDiff } from '../src/lib/state/diff.ts';
import { formatPlan } from '../src/lib/state/plan.ts';
import { readStateFromFile as readState, writeStateToFile as writeState } from '../src/lib/state/state-file.ts';
import type { TakosState } from '../src/lib/state/state-types.ts';

// ── helpers ──

import { assertEquals, assert, assertThrows, assertRejects, assertStringIncludes } from 'jsr:@std/assert';

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-state-'));
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

function makeManifest(spec: Partial<AppManifest['spec']> = {}): AppManifest {
  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'App',
    metadata: { name: 'test-app' },
    spec: {
      version: '1.0.0',
      workers: {
        web: {
          type: 'worker',
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

// ── state-file tests ──


  Deno.test('state-file - readState returns null when state file does not exist', async () => {
  try {
  const dir = await makeTempDir();
    const result = await readState(dir, 'default');
    assertEquals(result, null);
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('state-file - writeState creates directory if missing', async () => {
  try {
  const dir = await makeTempDir();
    const nested = path.join(dir, 'nested', 'deep');
    const state = makeState();

    await writeState(nested, 'default', state);
    const loaded = await readState(nested, 'default');
    assertEquals(loaded, state);
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('state-file - readState propagates non-ENOENT errors', async () => {
  try {
  // 存在するがディレクトリなので JSON パースエラーになる
    const dir = await makeTempDir();
    const stateFilePath = path.join(dir, 'state.default.json');
    await fs.mkdir(stateFilePath, { recursive: true }); // ファイルではなくディレクトリ
    await await assertRejects(async () => { await readState(dir, 'default'); });
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
// ── diff tests ──


  Deno.test('computeDiff - initial deploy (current = null) marks everything as create', () => {
  try {
  const manifest = makeManifest({
      resources: {
        db: { type: 'd1', binding: 'DB' },
        cache: { type: 'kv' },
      },
    });

    const result = computeDiff(manifest, null);

    assertEquals(result.hasChanges, true);
    assertEquals(result.summary.create, 3); // 2 resources + 1 worker
    assertEquals(result.summary.update, 0);
    assertEquals(result.summary.delete, 0);
    assertEquals(result.summary.unchanged, 0);

    const dbEntry = result.entries.find((e) => e.name === 'db');
    assertEquals(dbEntry, {
      name: 'db',
      category: 'resource',
      action: 'create',
      type: 'd1',
      reason: 'new',
    });

    const workerEntry = result.entries.find((e) => e.name === 'web');
    assertEquals(workerEntry, {
      name: 'web',
      category: 'worker',
      action: 'create',
      type: 'worker',
      reason: 'new',
    });
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('computeDiff - unchanged resources and workers', () => {
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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('computeDiff - detects deleted resources and workers', () => {
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

    const dbDel = result.entries.find((e) => e.name === 'db');
    assertEquals(dbDel?.action, 'delete');
    assertEquals(dbDel?.reason, 'removed from manifest');

    const workerDel = result.entries.find((e) => e.name === 'old');
    assertEquals(workerDel?.action, 'delete');
    assertEquals(workerDel?.reason, 'removed from manifest');
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('computeDiff - throws on resource type change', () => {
  try {
  const manifest = makeManifest({
      resources: {
        db: { type: 'r2' }, // was d1
      },
    });

    const current = makeState({
      resources: {
        db: { type: 'd1', id: 'abc', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
      },
    });

    assertThrows(() => { () => computeDiff(manifest, current); }, 
      /Resource "db" type changed from "d1" to "r2"/,
    );
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('computeDiff - handles mixed create, unchanged, delete', () => {
  try {
  const manifest = makeManifest({
      resources: {
        db: { type: 'd1', binding: 'DB' },       // unchanged
        newcache: { type: 'kv' },                 // create
      },
      workers: {
        web: {                                     // unchanged
          type: 'worker',
          build: {
            fromWorkflow: {
              path: '.takos/workflows/build.yml',
              job: 'build',
              artifact: 'dist',
              artifactPath: 'dist/',
            },
          },
        },
        api: {                                     // create
          type: 'worker',
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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('computeDiff - handles containers and services in extended manifest', () => {
  try {
  // containers / services は CLI の AppManifest 型には未定義だが、
    // GroupDeployOptions 経由の manifest には存在しうる
    const manifest = makeManifest() as AppManifest & {
      spec: AppManifest['spec'] & {
        containers: Record<string, unknown>;
        services: Record<string, unknown>;
      };
    };
    (manifest.spec as any).containers = { runner: { dockerfile: 'Dockerfile' } };
    (manifest.spec as any).services = { backend: { dockerfile: 'Dockerfile' } };

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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('computeDiff - detects deleted containers and services', () => {
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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
// ── computeWorkerDiff tests ──


  Deno.test('computeWorkerDiff - returns create for new worker', () => {
  try {
  const entry = computeWorkerDiff('api', 'sha256:new', null);
    assertEquals(entry.action, 'create');
    assertEquals(entry.reason, 'new');
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('computeWorkerDiff - returns update when codeHash differs', () => {
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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('computeWorkerDiff - returns unchanged when codeHash matches', () => {
  try {
  const current = makeState({
      workers: {
        api: { scriptName: 'api', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:same' },
      },
    });
    const entry = computeWorkerDiff('api', 'sha256:same', current);
    assertEquals(entry.action, 'unchanged');
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
// ── formatPlan tests ──


  Deno.test('formatPlan - returns "no changes" message when entries are empty', () => {
  try {
  const result = formatPlan({
      entries: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
    });
    assertEquals(result, '変更はありません。');
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('formatPlan - formats entries with correct symbols', () => {
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

    // summary line
    const summaryLine = lines[lines.length - 1];
    assertStringIncludes(summaryLine, '作成: 1');
    assertStringIncludes(summaryLine, '更新: 1');
    assertStringIncludes(summaryLine, '削除: 1');
    assertStringIncludes(summaryLine, '変更なし: 1');
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('formatPlan - omits zero counts from summary', () => {
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
    assert(!(summaryLine).includes('更新'));
    assert(!(summaryLine).includes('削除'));
    assert(!(summaryLine).includes('変更なし'));
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})