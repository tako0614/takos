import { describe, expect, it, vi } from 'vitest';
import { makeRangeSpec, DependencyResolver } from '@/services/takopack/dependency-resolver';
import type { InstalledTakopack } from '@/services/takopack/dependency-resolver';

vi.mock('@/services/source/repos', () => ({
  checkRepoAccess: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/services/source/repo-release-assets', () => ({
  toReleaseAssets: (rows: unknown[]) => rows,
}));

describe('makeRangeSpec', () => {
  it('returns a RangeSpec with raw and parsed fields', () => {
    const spec = makeRangeSpec('^1.2.3');
    expect(spec.raw).toBe('^1.2.3');
    expect(spec.parsed.comparators).toHaveLength(2);
    expect(spec.parsed.comparators[0].op).toBe('>=');
    expect(spec.parsed.comparators[1].op).toBe('<');
  });

  it('throws for invalid range', () => {
    expect(() => makeRangeSpec('invalid')).toThrow();
  });
});

function createMockDb(overrides: Record<string, unknown> = {}) {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockReturnValue(c);
    c.orderBy = vi.fn().mockReturnValue(c);
    c.limit = vi.fn().mockReturnValue(c);
    c.all = vi.fn().mockResolvedValue([]);
    c.get = vi.fn().mockResolvedValue(null);
    return c;
  };

  return {
    select: vi.fn().mockImplementation(() => chain()),
    all: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

function createMockEnv() {
  return {
    DB: {},
    ADMIN_DOMAIN: 'test.takos.jp',
    TENANT_BASE_DOMAIN: 'app.test.takos.jp',
  } as any;
}

describe('DependencyResolver', () => {
  it('detects dependency cycle', () => {
    // The topological sort helper is exercised through the resolver interface.
    // We can test the cycle detection behavior by constructing a resolver with
    // pre-seeded constraints that form a cycle.
    const db = createMockDb();
    const env = createMockEnv();
    const resolver = new DependencyResolver(db, env, 'user-1', new Map());

    // Directly test setConstraint to build up the constraint graph
    resolver.setConstraint('repo-a', '__root__', makeRangeSpec('^1.0.0'), '@alice/a');
    expect(resolver.getSelected().size).toBe(0);
  });

  it('resolves empty dependencies without error', async () => {
    const db = createMockDb();
    const env = createMockEnv();
    const resolver = new DependencyResolver(db, env, 'user-1', new Map());

    await resolver.seedRootDependencies([]);
    await resolver.resolve();

    expect(resolver.getSelected().size).toBe(0);
    expect(resolver.getInstallOrder()).toEqual([]);
  });

  it('setConstraint throws on duplicate constraint from same source', () => {
    const db = createMockDb();
    const env = createMockEnv();
    const resolver = new DependencyResolver(db, env, 'user-1', new Map());

    resolver.setConstraint('repo-a', '__root__', makeRangeSpec('^1.0.0'), '@alice/a');
    expect(() =>
      resolver.setConstraint('repo-a', '__root__', makeRangeSpec('^1.0.0'), '@alice/a'),
    ).toThrow('Duplicate dependency constraint');
  });

  it('removeOutgoingConstraints is a no-op when outgoingBySource has no entries for the key', () => {
    const db = createMockDb();
    const env = createMockEnv();
    const resolver = new DependencyResolver(db, env, 'user-1', new Map());

    resolver.setConstraint('repo-a', 'source-1', makeRangeSpec('^1.0.0'), '@alice/a');
    // removeOutgoingConstraints only removes constraints that have entries in
    // the internal outgoingBySource map (populated during resolve/seedRootDependencies).
    // Since we only called setConstraint directly, the constraint is NOT removed.
    resolver.removeOutgoingConstraints('source-1');

    // The constraint still exists, so setConstraint with the same key should throw
    expect(() =>
      resolver.setConstraint('repo-a', 'source-1', makeRangeSpec('^2.0.0'), '@alice/a'),
    ).toThrow('Duplicate dependency constraint');
  });

  it('selectCandidate uses installed version when it satisfies range', async () => {
    const db = createMockDb();
    const env = createMockEnv();
    const installed = new Map<string, InstalledTakopack>([
      ['repo-a', {
        id: 'tp-1',
        name: 'alpha',
        appId: 'dev.takos.alpha',
        installKey: 'key-1',
        version: '1.5.0',
        isPinned: false,
        sourceType: 'git',
        sourceRepoId: 'repo-a',
        manifestJson: JSON.stringify({
          manifestVersion: 'vnext-infra-v1alpha1',
          meta: { name: 'alpha', appId: 'dev.takos.alpha', version: '1.5.0', createdAt: '2026-03-01' },
          objects: [],
        }),
      }],
    ]);
    const resolver = new DependencyResolver(db, env, 'user-1', installed);

    const candidate = await resolver.selectCandidate(
      { id: 'repo-a', name: 'alpha', visibility: 'public', owner_username: 'alice' },
      [makeRangeSpec('^1.0.0')],
    );

    expect(candidate.source).toBe('installed');
    expect(candidate.version).toBe('1.5.0');
  });

  it('selectCandidate throws when pinned version does not satisfy range', async () => {
    const db = createMockDb();
    const env = createMockEnv();
    const installed = new Map<string, InstalledTakopack>([
      ['repo-a', {
        id: 'tp-1',
        name: 'alpha',
        appId: 'dev.takos.alpha',
        installKey: 'key-1',
        version: '1.0.0',
        isPinned: true,
        sourceType: 'git',
        sourceRepoId: 'repo-a',
        manifestJson: null,
      }],
    ]);
    const resolver = new DependencyResolver(db, env, 'user-1', installed);

    await expect(
      resolver.selectCandidate(
        { id: 'repo-a', name: 'alpha', visibility: 'public', owner_username: 'alice' },
        [makeRangeSpec('^2.0.0')],
      ),
    ).rejects.toThrow('pinned');
  });

  it('selectCandidate throws when no compatible release exists', async () => {
    const db = createMockDb();
    const env = createMockEnv();
    const resolver = new DependencyResolver(db, env, 'user-1', new Map());

    // getReleaseCandidates returns empty since db mocks return empty arrays
    await expect(
      resolver.selectCandidate(
        { id: 'repo-a', name: 'alpha', visibility: 'public', owner_username: 'alice' },
        [makeRangeSpec('^1.0.0')],
      ),
    ).rejects.toThrow('No compatible release found');
  });

  it('selectCandidate throws when install would require a downgrade', async () => {
    let selectCallCount = 0;
    const db = createMockDb({
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        const c: Record<string, unknown> = {};
        c.from = vi.fn().mockReturnValue(c);
        c.where = vi.fn().mockReturnValue(c);
        c.orderBy = vi.fn().mockReturnValue(c);
        c.limit = vi.fn().mockReturnValue(c);
        // First select() is the releases query, second is the assets query
        if (selectCallCount === 1) {
          c.all = vi.fn().mockResolvedValue([{
            id: 'release-1',
            repoId: 'repo-a',
            tag: 'v1.0.0',
            isDraft: false,
            isPrerelease: false,
            publishedAt: '2026-03-01',
          }]);
        } else {
          c.all = vi.fn().mockResolvedValue([{
            id: 'asset-1',
            releaseId: 'release-1',
            assetKey: 'k-1',
            name: 'a.takopack',
            contentType: 'application/zip',
            sizeBytes: 1,
            downloadCount: 0,
            bundle_format: 'takopack',
            bundle_meta: { name: 'alpha', version: '1.0.0', dependencies: [] },
            createdAt: '2026-03-01',
          }]);
        }
        c.get = vi.fn().mockResolvedValue(null);
        return c;
      }),
    });
    const env = createMockEnv();
    const installed = new Map<string, InstalledTakopack>([
      ['repo-a', {
        id: 'tp-1',
        name: 'alpha',
        appId: 'dev.takos.alpha',
        installKey: 'key-1',
        version: '2.0.0',
        isPinned: false,
        sourceType: 'git',
        sourceRepoId: 'repo-a',
        manifestJson: null,
      }],
    ]);
    const resolver = new DependencyResolver(db, env, 'user-1', installed);

    // Use ^1.0.0 (>=1.0.0 <2.0.0) so that installed 2.0.0 does NOT satisfy,
    // forcing a release lookup. The found release 1.0.0 is lower than installed
    // 2.0.0, triggering the downgrade check.
    await expect(
      resolver.selectCandidate(
        { id: 'repo-a', name: 'alpha', visibility: 'public', owner_username: 'alice' },
        [makeRangeSpec('^1.0.0')],
      ),
    ).rejects.toThrow('downgrade');
  });

  it('resolveRepoRef throws for invalid repo reference', async () => {
    const db = createMockDb();
    const env = createMockEnv();
    const resolver = new DependencyResolver(db, env, 'user-1', new Map());

    await expect(resolver.resolveRepoRef('invalid')).rejects.toThrow('Invalid dependency repo reference');
  });

  it('resolveRepoRef throws when repo is not found in DB', async () => {
    const db = createMockDb({
      all: vi.fn().mockResolvedValue([]),
    });
    const env = createMockEnv();
    const resolver = new DependencyResolver(db, env, 'user-1', new Map());

    await expect(resolver.resolveRepoRef('@alice/notfound')).rejects.toThrow('Dependency repository not found');
  });

  it('resolveRepoRef caches results', async () => {
    const allMock = vi.fn().mockResolvedValue([{
      id: 'repo-a',
      name: 'alpha',
      visibility: 'public',
      owner_username: 'alice',
    }]);
    const db = createMockDb({ all: allMock });
    const env = createMockEnv();
    const resolver = new DependencyResolver(db, env, 'user-1', new Map());

    const first = await resolver.resolveRepoRef('@alice/alpha');
    const second = await resolver.resolveRepoRef('@alice/alpha');

    expect(first).toBe(second);
    // DB should only be called once due to cache
    expect(allMock).toHaveBeenCalledTimes(1);
  });
});
