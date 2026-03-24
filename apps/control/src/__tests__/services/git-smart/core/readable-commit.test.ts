import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockResolveRef = vi.hoisted(() => vi.fn());
const mockGetCommit = vi.hoisted(() => vi.fn());
const mockGetCommitLog = vi.hoisted(() => vi.fn());
const mockGetTree = vi.hoisted(() => vi.fn());

vi.mock('@/services/git-smart/core/refs', () => ({
  resolveRef: mockResolveRef,
}));

vi.mock('@/services/git-smart/core/commit-index', () => ({
  getCommit: mockGetCommit,
  getCommitLog: mockGetCommitLog,
}));

vi.mock('@/services/git-smart/core/tree-ops', () => ({
  getTree: mockGetTree,
}));

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

describe('resolveReadableCommitFromRef', () => {
  beforeEach(() => {
    mockResolveRef.mockReset();
    mockGetCommit.mockReset();
    mockGetCommitLog.mockReset();
    mockGetTree.mockReset();
  });

  it('returns ref_not_found when ref does not resolve', async () => {
    mockResolveRef.mockResolvedValue(null);

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    expect(result).toEqual({ ok: false, reason: 'ref_not_found' });
  });

  it('returns non-degraded when primary commit has a valid tree', async () => {
    const commit = makeCommit('aaa', 'ttt');
    mockResolveRef.mockResolvedValue('aaa');
    mockGetCommit.mockResolvedValue(commit);
    mockGetTree.mockResolvedValue({ sha: 'ttt', entries: [] });

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    expect(result).toEqual({
      ok: true,
      refCommitSha: 'aaa',
      resolvedCommitSha: 'aaa',
      degraded: false,
      commit,
    });
  });

  it('falls back to ancestor when primary tree is missing', async () => {
    const primary = makeCommit('aaa', 'ttt-broken', ['bbb']);
    const fallback = makeCommit('bbb', 'ttt-ok');

    mockResolveRef.mockResolvedValue('aaa');
    mockGetCommit.mockResolvedValue(primary);
    mockGetTree
      .mockResolvedValueOnce(null) // primary tree missing
      .mockResolvedValueOnce({ sha: 'ttt-ok', entries: [] }); // fallback tree ok
    mockGetCommitLog.mockResolvedValue([primary, fallback]);

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    expect(result).toEqual({
      ok: true,
      refCommitSha: 'aaa',
      resolvedCommitSha: 'bbb',
      degraded: true,
      commit: fallback,
    });
  });

  it('returns commit_not_found when commit cannot be loaded', async () => {
    mockResolveRef.mockResolvedValue('aaa');
    mockGetCommit.mockResolvedValue(null);
    mockGetCommitLog.mockResolvedValue([]);

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    expect(result).toEqual({ ok: false, reason: 'commit_not_found', refCommitSha: 'aaa' });
  });

  it('returns tree_not_found when no commit in history has a valid tree', async () => {
    const primary = makeCommit('aaa', 'ttt-broken');
    mockResolveRef.mockResolvedValue('aaa');
    mockGetCommit.mockResolvedValue(primary);
    mockGetTree.mockResolvedValue(null); // all trees missing
    mockGetCommitLog.mockResolvedValue([primary]);

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    expect(result).toEqual({ ok: false, reason: 'tree_not_found', refCommitSha: 'aaa' });
  });

  it('respects fallbackLimit option', async () => {
    const primary = makeCommit('aaa', 'ttt-broken');
    mockResolveRef.mockResolvedValue('aaa');
    mockGetCommit.mockResolvedValue(primary);
    mockGetTree.mockResolvedValue(null);
    mockGetCommitLog.mockResolvedValue([primary]);

    await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main', { fallbackLimit: 10 });

    expect(mockGetCommitLog).toHaveBeenCalledWith(db, bucket, REPO_ID, 'aaa', 10);
  });

  it('clamps fallbackLimit to at least 1', async () => {
    const primary = makeCommit('aaa', 'ttt-broken');
    mockResolveRef.mockResolvedValue('aaa');
    mockGetCommit.mockResolvedValue(primary);
    mockGetTree.mockResolvedValue(null);
    mockGetCommitLog.mockResolvedValue([primary]);

    await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main', { fallbackLimit: -5 });

    expect(mockGetCommitLog).toHaveBeenCalledWith(db, bucket, REPO_ID, 'aaa', 1);
  });

  it('skips primary commit in fallback history scan', async () => {
    const primary = makeCommit('aaa', 'ttt-broken', ['bbb']);
    const second = makeCommit('bbb', 'ttt-also-broken');
    const third = makeCommit('ccc', 'ttt-ok');

    mockResolveRef.mockResolvedValue('aaa');
    mockGetCommit.mockResolvedValue(primary);
    mockGetTree
      .mockResolvedValueOnce(null)   // primary tree
      .mockResolvedValueOnce(null)   // second tree (bbb)
      .mockResolvedValueOnce({ sha: 'ttt-ok', entries: [] }); // third tree (ccc)
    mockGetCommitLog.mockResolvedValue([primary, second, third]);

    const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

    expect(result).toEqual({
      ok: true,
      refCommitSha: 'aaa',
      resolvedCommitSha: 'ccc',
      degraded: true,
      commit: third,
    });
  });
});
