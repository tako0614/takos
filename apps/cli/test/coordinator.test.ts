import { describe, expect, it } from 'vitest';
import { computeDiff } from '../src/lib/state/diff.js';
import type { TakosState } from '../src/lib/state/state-types.js';
import type { AppManifest } from '../src/lib/app-manifest.js';
import type { DiffEntry, DiffResult } from '../src/lib/state/diff.js';

// ── Test helpers ────────────────────────────────────────────────────────────

function makeState(overrides: Partial<TakosState> = {}): TakosState {
  return {
    version: 1,
    provider: 'cloudflare',
    env: 'production',
    groupName: 'test-group',
    updatedAt: '2026-01-01T00:00:00Z',
    resources: {},
    workers: {},
    containers: {},
    services: {},
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
      workers: {},
      ...spec,
    },
  };
}

/**
 * Simulate applyDiff: given a diff result, collect the action calls that
 * the coordinator would make. This verifies diff-driven dispatch logic
 * without depending on the actual coordinator implementation (which is
 * being built by another agent).
 */
function simulateApplyDiff(diff: DiffResult): Array<{ action: string; name: string; category: string }> {
  const calls: Array<{ action: string; name: string; category: string }> = [];

  for (const entry of diff.entries) {
    switch (entry.action) {
      case 'create': {
        if (entry.category === 'resource') {
          calls.push({ action: 'createResource', name: entry.name, category: entry.category });
        } else if (entry.category === 'worker') {
          calls.push({ action: 'deployWorker', name: entry.name, category: entry.category });
        } else if (entry.category === 'container') {
          calls.push({ action: 'deployContainer', name: entry.name, category: entry.category });
        } else if (entry.category === 'service') {
          calls.push({ action: 'deployService', name: entry.name, category: entry.category });
        }
        break;
      }
      case 'update': {
        if (entry.category === 'worker') {
          calls.push({ action: 'deployWorker', name: entry.name, category: entry.category });
        } else if (entry.category === 'container') {
          calls.push({ action: 'deployContainer', name: entry.name, category: entry.category });
        } else if (entry.category === 'service') {
          calls.push({ action: 'deployService', name: entry.name, category: entry.category });
        }
        break;
      }
      case 'delete': {
        if (entry.category === 'resource') {
          calls.push({ action: 'deleteResource', name: entry.name, category: entry.category });
        } else if (entry.category === 'worker') {
          calls.push({ action: 'deleteWorker', name: entry.name, category: entry.category });
        } else if (entry.category === 'container') {
          calls.push({ action: 'deleteContainer', name: entry.name, category: entry.category });
        } else if (entry.category === 'service') {
          calls.push({ action: 'deleteService', name: entry.name, category: entry.category });
        }
        break;
      }
      case 'unchanged':
        // no-op
        break;
    }
  }

  return calls;
}

// ── applyDiff tests ─────────────────────────────────────────────────────────

describe('applyDiff', () => {
  it('calls createResource for create entries', () => {
    const manifest = makeManifest({
      resources: {
        db: { type: 'd1', binding: 'DB' },
        cache: { type: 'kv' },
      },
    });

    const diff = computeDiff(manifest, null);
    const calls = simulateApplyDiff(diff);

    const createResourceCalls = calls.filter((c) => c.action === 'createResource');
    expect(createResourceCalls).toHaveLength(2);
    expect(createResourceCalls.map((c) => c.name).sort()).toEqual(['cache', 'db']);
  });

  it('calls deployWorker for create worker entries', () => {
    const manifest = makeManifest({
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
    });

    const diff = computeDiff(manifest, null);
    const calls = simulateApplyDiff(diff);

    const deployWorkerCalls = calls.filter((c) => c.action === 'deployWorker');
    expect(deployWorkerCalls).toHaveLength(1);
    expect(deployWorkerCalls[0].name).toBe('web');
  });

  it('calls delete for delete entries', () => {
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

    const diff = computeDiff(manifest, current);
    const calls = simulateApplyDiff(diff);

    const deleteResourceCalls = calls.filter((c) => c.action === 'deleteResource');
    expect(deleteResourceCalls).toHaveLength(1);
    expect(deleteResourceCalls[0].name).toBe('db');

    const deleteWorkerCalls = calls.filter((c) => c.action === 'deleteWorker');
    expect(deleteWorkerCalls).toHaveLength(1);
    expect(deleteWorkerCalls[0].name).toBe('old');
  });

  it('skips unchanged entries', () => {
    const manifest = makeManifest({
      resources: {
        db: { type: 'd1', binding: 'DB' },
      },
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
    });

    const current = makeState({
      resources: {
        db: { type: 'd1', id: 'abc', binding: 'DB', createdAt: '2026-01-01T00:00:00Z' },
      },
      workers: {
        web: { scriptName: 'web', deployedAt: '2026-01-01T00:00:00Z', codeHash: 'sha256:aaa' },
      },
    });

    const diff = computeDiff(manifest, current);
    const calls = simulateApplyDiff(diff);

    // No actions should be dispatched for unchanged entries
    expect(calls).toHaveLength(0);
    expect(diff.hasChanges).toBe(false);
  });

  it('respects dependsOn ordering (resources before workers)', () => {
    const manifest = makeManifest({
      resources: {
        db: { type: 'd1', binding: 'DB' },
      },
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
    });

    const diff = computeDiff(manifest, null);

    // Verify that resource entries come before worker entries in the diff
    // This is the natural ordering that computeDiff produces, and the
    // coordinator should process entries in order, ensuring resources
    // are created before workers that may depend on them.
    const resourceIndex = diff.entries.findIndex(
      (e) => e.category === 'resource' && e.name === 'db',
    );
    const workerIndex = diff.entries.findIndex(
      (e) => e.category === 'worker' && e.name === 'web',
    );
    expect(resourceIndex).toBeLessThan(workerIndex);

    const calls = simulateApplyDiff(diff);
    const createResourceIdx = calls.findIndex((c) => c.action === 'createResource');
    const deployWorkerIdx = calls.findIndex((c) => c.action === 'deployWorker');
    expect(createResourceIdx).toBeLessThan(deployWorkerIdx);
  });

  it('handles mixed create, delete, and unchanged', () => {
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

    const diff = computeDiff(manifest, current);
    const calls = simulateApplyDiff(diff);

    // Should have 1 create (newcache) + 1 delete (oldqueue) = 2 calls
    expect(calls).toHaveLength(2);
    expect(calls.find((c) => c.action === 'createResource' && c.name === 'newcache')).toBeDefined();
    expect(calls.find((c) => c.action === 'deleteResource' && c.name === 'oldqueue')).toBeDefined();
  });

  it('handles container and service entries', () => {
    const manifest = makeManifest() as AppManifest & {
      spec: AppManifest['spec'] & {
        containers: Record<string, unknown>;
        services: Record<string, unknown>;
      };
    };
    (manifest.spec as any).containers = { runner: { dockerfile: 'Dockerfile' } };
    (manifest.spec as any).services = { backend: { dockerfile: 'Dockerfile' } };

    const diff = computeDiff(manifest, null);
    const calls = simulateApplyDiff(diff);

    const containerCalls = calls.filter((c) => c.action === 'deployContainer');
    expect(containerCalls).toHaveLength(1);
    expect(containerCalls[0].name).toBe('runner');

    const serviceCalls = calls.filter((c) => c.action === 'deployService');
    expect(serviceCalls).toHaveLength(1);
    expect(serviceCalls[0].name).toBe('backend');
  });
});
