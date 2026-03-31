import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockResolveRef = ((..._args: any[]) => undefined) as any;
const mockGetCommit = ((..._args: any[]) => undefined) as any;
const mockGetCommitLog = ((..._args: any[]) => undefined) as any;
const mockGetTree = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/core/refs'

// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/core/commit-index'

// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/core/tree-ops'

import { resolveReadableCommitFromRef } from '@/services/git-smart/core/readable-commit';

const db = {} as any;
const bucket = {} as any;
const REPO_ID = 'repo-1';

function makeCommit(sha: string, treeSha: string, parents: string[] = []) {
  return {
    sha,
    tree: treeSha,
    parents,
    message: `commit ${sha}`,
    author: { name: 'a', email: 'a@b', timestamp: 0, tzOffset: '+0000' },
    committer: { name: 'a', email: 'a@b', timestamp: 0, tzOffset: '+0000' },
  };
}



  Deno.test('resolveReadableCommitFromRef - returns ref_not_found when ref does not resolve', async () => {
  mockResolveRef;
    mockGetCommit;
    mockGetCommitLog;
    mockGetTree;
  mockResolveRef = (async () => null) as any;

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    assertEquals(result, { ok: false, reason: 'ref_not_found' });
})

  Deno.test('resolveReadableCommitFromRef - returns non-degraded when primary commit has a valid tree', async () => {
  mockResolveRef;
    mockGetCommit;
    mockGetCommitLog;
    mockGetTree;
  const commit = makeCommit('aaa', 'ttt');
    mockResolveRef = (async () => 'aaa') as any;
    mockGetCommit = (async () => commit) as any;
    mockGetTree = (async () => ({ sha: 'ttt', entries: [] })) as any;

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    assertEquals(result, {
      ok: true,
      refCommitSha: 'aaa',
      resolvedCommitSha: 'aaa',
      degraded: false,
      commit,
    });
})

  Deno.test('resolveReadableCommitFromRef - falls back to ancestor when primary tree is missing', async () => {
  mockResolveRef;
    mockGetCommit;
    mockGetCommitLog;
    mockGetTree;
  const primary = makeCommit('aaa', 'ttt-broken', ['bbb']);
    const fallback = makeCommit('bbb', 'ttt-ok');

    mockResolveRef = (async () => 'aaa') as any;
    mockGetCommit = (async () => primary) as any;
    mockGetTree
       = (async () => null) as any // primary tree missing
       = (async () => ({ sha: 'ttt-ok', entries: [] })) as any; // fallback tree ok
    mockGetCommitLog = (async () => [primary, fallback]) as any;

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    assertEquals(result, {
      ok: true,
      refCommitSha: 'aaa',
      resolvedCommitSha: 'bbb',
      degraded: true,
      commit: fallback,
    });
})

  Deno.test('resolveReadableCommitFromRef - returns commit_not_found when commit cannot be loaded', async () => {
  mockResolveRef;
    mockGetCommit;
    mockGetCommitLog;
    mockGetTree;
  mockResolveRef = (async () => 'aaa') as any;
    mockGetCommit = (async () => null) as any;
    mockGetCommitLog = (async () => []) as any;

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    assertEquals(result, { ok: false, reason: 'commit_not_found', refCommitSha: 'aaa' });
})

  Deno.test('resolveReadableCommitFromRef - returns tree_not_found when no commit in history has a valid tree', async () => {
  mockResolveRef;
    mockGetCommit;
    mockGetCommitLog;
    mockGetTree;
  const primary = makeCommit('aaa', 'ttt-broken');
    mockResolveRef = (async () => 'aaa') as any;
    mockGetCommit = (async () => primary) as any;
    mockGetTree = (async () => null) as any; // all trees missing
    mockGetCommitLog = (async () => [primary]) as any;

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    assertEquals(result, { ok: false, reason: 'tree_not_found', refCommitSha: 'aaa' });
})

  Deno.test('resolveReadableCommitFromRef - respects fallbackLimit option', async () => {
  mockResolveRef;
    mockGetCommit;
    mockGetCommitLog;
    mockGetTree;
  const primary = makeCommit('aaa', 'ttt-broken');
    mockResolveRef = (async () => 'aaa') as any;
    mockGetCommit = (async () => primary) as any;
    mockGetTree = (async () => null) as any;
    mockGetCommitLog = (async () => [primary]) as any;

    await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main', { fallbackLimit: 10 });

    assertSpyCallArgs(mockGetCommitLog, 0, [db, bucket, REPO_ID, 'aaa', 10]);
})

  Deno.test('resolveReadableCommitFromRef - clamps fallbackLimit to at least 1', async () => {
  mockResolveRef;
    mockGetCommit;
    mockGetCommitLog;
    mockGetTree;
  const primary = makeCommit('aaa', 'ttt-broken');
    mockResolveRef = (async () => 'aaa') as any;
    mockGetCommit = (async () => primary) as any;
    mockGetTree = (async () => null) as any;
    mockGetCommitLog = (async () => [primary]) as any;

    await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main', { fallbackLimit: -5 });

    assertSpyCallArgs(mockGetCommitLog, 0, [db, bucket, REPO_ID, 'aaa', 1]);
})

  Deno.test('resolveReadableCommitFromRef - skips primary commit in fallback history scan', async () => {
  mockResolveRef;
    mockGetCommit;
    mockGetCommitLog;
    mockGetTree;
  const primary = makeCommit('aaa', 'ttt-broken', ['bbb']);
    const second = makeCommit('bbb', 'ttt-also-broken');
    const third = makeCommit('ccc', 'ttt-ok');

    mockResolveRef = (async () => 'aaa') as any;
    mockGetCommit = (async () => primary) as any;
    mockGetTree
       = (async () => null) as any   // primary tree
       = (async () => null) as any   // second tree (bbb)
       = (async () => ({ sha: 'ttt-ok', entries: [] })) as any; // third tree (ccc)
    mockGetCommitLog = (async () => [primary, second, third]) as any;

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    assertEquals(result, {
      ok: true,
      refCommitSha: 'aaa',
      resolvedCommitSha: 'ccc',
      degraded: true,
      commit: third,
    });
})

