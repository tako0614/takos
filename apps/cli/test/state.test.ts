import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppManifest } from '../src/lib/app-manifest.js';
import { computeDiff, computeWorkerDiff } from '../src/lib/state/diff.js';
import { formatPlan } from '../src/lib/state/plan.js';
import { readState, writeState } from '../src/lib/state/state-file.js';
import type { TakosState } from '../src/lib/state/state-types.js';

// ── helpers ──

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

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

describe('state-file', () => {
  it('readState returns null when state file does not exist', async () => {
    const dir = await makeTempDir();
    const result = await readState(dir, 'default');
    expect(result).toBeNull();
  });

  it('writeState + readState roundtrip', async () => {
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
    expect(loaded).toEqual(state);
  });

  it('writeState creates directory if missing', async () => {
    const dir = await makeTempDir();
    const nested = path.join(dir, 'nested', 'deep');
    const state = makeState();

    await writeState(nested, 'default', state);
    const loaded = await readState(nested, 'default');
    expect(loaded).toEqual(state);
  });

  it('readState propagates non-ENOENT errors', async () => {
    // 存在するがディレクトリなので JSON パースエラーになる
    const dir = await makeTempDir();
    const stateFilePath = path.join(dir, 'state.default.json');
    await fs.mkdir(stateFilePath, { recursive: true }); // ファイルではなくディレクトリ
    await expect(readState(dir, 'default')).rejects.toThrow();
  });
});

// ── diff tests ──

describe('computeDiff', () => {
  it('initial deploy (current = null) marks everything as create', () => {
    const manifest = makeManifest({
      resources: {
        db: { type: 'd1', binding: 'DB' },
        cache: { type: 'kv' },
      },
    });

    const result = computeDiff(manifest, null);

    expect(result.hasChanges).toBe(true);
    expect(result.summary.create).toBe(3); // 2 resources + 1 worker
    expect(result.summary.update).toBe(0);
    expect(result.summary.delete).toBe(0);
    expect(result.summary.unchanged).toBe(0);

    const dbEntry = result.entries.find((e) => e.name === 'db');
    expect(dbEntry).toEqual({
      name: 'db',
      category: 'resource',
      action: 'create',
      type: 'd1',
      reason: 'new',
    });

    const workerEntry = result.entries.find((e) => e.name === 'web');
    expect(workerEntry).toEqual({
      name: 'web',
      category: 'worker',
      action: 'create',
      type: 'worker',
      reason: 'new',
    });
  });

  it('unchanged resources and workers', () => {
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

    expect(result.hasChanges).toBe(false);
    expect(result.summary.unchanged).toBe(2);
    expect(result.entries.every((e) => e.action === 'unchanged')).toBe(true);
  });

  it('detects deleted resources and workers', () => {
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

    expect(result.hasChanges).toBe(true);
    expect(result.summary.delete).toBe(2);

    const dbDel = result.entries.find((e) => e.name === 'db');
    expect(dbDel?.action).toBe('delete');
    expect(dbDel?.reason).toBe('removed from manifest');

    const workerDel = result.entries.find((e) => e.name === 'old');
    expect(workerDel?.action).toBe('delete');
    expect(workerDel?.reason).toBe('removed from manifest');
  });

  it('throws on resource type change', () => {
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

    expect(() => computeDiff(manifest, current)).toThrow(
      /Resource "db" type changed from "d1" to "r2"/,
    );
  });

  it('handles mixed create, unchanged, delete', () => {
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

    expect(result.hasChanges).toBe(true);
    expect(result.summary).toEqual({ create: 2, update: 0, delete: 1, unchanged: 2 });

    expect(result.entries.find((e) => e.name === 'newcache')?.action).toBe('create');
    expect(result.entries.find((e) => e.name === 'api')?.action).toBe('create');
    expect(result.entries.find((e) => e.name === 'oldqueue')?.action).toBe('delete');
    expect(result.entries.find((e) => e.name === 'db')?.action).toBe('unchanged');
    expect(result.entries.find((e) => e.name === 'web')?.action).toBe('unchanged');
  });

  it('handles containers and services in extended manifest', () => {
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

    expect(result.entries.find((e) => e.name === 'runner')).toEqual({
      name: 'runner',
      category: 'container',
      action: 'create',
      type: 'container',
      reason: 'new',
    });
    expect(result.entries.find((e) => e.name === 'backend')).toEqual({
      name: 'backend',
      category: 'service',
      action: 'create',
      type: 'service',
      reason: 'new',
    });
  });

  it('detects deleted containers and services', () => {
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

    expect(result.entries.find((e) => e.name === 'runner')?.action).toBe('delete');
    expect(result.entries.find((e) => e.name === 'backend')?.action).toBe('delete');
  });
});

// ── computeWorkerDiff tests ──

describe('computeWorkerDiff', () => {
  it('returns create for new worker', () => {
    const entry = computeWorkerDiff('api', 'sha256:new', null);
    expect(entry.action).toBe('create');
    expect(entry.reason).toBe('new');
  });

  it('returns update when codeHash differs', () => {
    const current = makeState({
      workers: {
        api: { scriptName: 'api', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:old' },
      },
    });
    const entry = computeWorkerDiff('api', 'sha256:new', current);
    expect(entry.action).toBe('update');
    expect(entry.reason).toBe('code changed');
  });

  it('returns unchanged when codeHash matches', () => {
    const current = makeState({
      workers: {
        api: { scriptName: 'api', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:same' },
      },
    });
    const entry = computeWorkerDiff('api', 'sha256:same', current);
    expect(entry.action).toBe('unchanged');
  });
});

// ── formatPlan tests ──

describe('formatPlan', () => {
  it('returns "no changes" message when entries are empty', () => {
    const result = formatPlan({
      entries: [],
      hasChanges: false,
      summary: { create: 0, update: 0, delete: 0, unchanged: 0 },
    });
    expect(result).toBe('変更はありません。');
  });

  it('formats entries with correct symbols', () => {
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
    expect(lines[0]).toContain('+ db');
    expect(lines[0]).toContain('d1');
    expect(lines[0]).toContain('new');

    expect(lines[1]).toContain('~ web');
    expect(lines[1]).toContain('worker');
    expect(lines[1]).toContain('code changed');

    expect(lines[2]).toContain('- old');
    expect(lines[2]).toContain('worker');
    expect(lines[2]).toContain('removed from manifest');

    expect(lines[3]).toContain('= cache');
    expect(lines[3]).toContain('kv');
    expect(lines[3]).toContain('変更なし');

    // summary line
    const summaryLine = lines[lines.length - 1];
    expect(summaryLine).toContain('作成: 1');
    expect(summaryLine).toContain('更新: 1');
    expect(summaryLine).toContain('削除: 1');
    expect(summaryLine).toContain('変更なし: 1');
  });

  it('omits zero counts from summary', () => {
    const result = formatPlan({
      entries: [
        { name: 'db', category: 'resource', action: 'create', type: 'd1', reason: 'new' },
      ],
      hasChanges: true,
      summary: { create: 1, update: 0, delete: 0, unchanged: 0 },
    });

    const summaryLine = result.split('\n').pop()!;
    expect(summaryLine).toBe('作成: 1');
    expect(summaryLine).not.toContain('更新');
    expect(summaryLine).not.toContain('削除');
    expect(summaryLine).not.toContain('変更なし');
  });
});
