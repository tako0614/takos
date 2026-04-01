import { assertEquals } from 'jsr:@std/assert';

import {
  readableCommitDeps,
  resolveReadableCommitFromRef,
} from '@/services/git-smart/core/readable-commit';

const db = {} as any;
const bucket = {} as any;
const REPO_ID = 'repo-1';
const defaultDeps = { ...readableCommitDeps };

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

function restoreDeps() {
  Object.assign(readableCommitDeps, defaultDeps);
}

Deno.test('resolveReadableCommitFromRef - returns ref_not_found when ref does not resolve', async () => {
  restoreDeps();
  readableCommitDeps.resolveRef = async () => null;

  const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

  assertEquals(result, { ok: false, reason: 'ref_not_found' });
});

Deno.test('resolveReadableCommitFromRef - returns non-degraded when primary commit has a valid tree', async () => {
  restoreDeps();
  const commit = makeCommit('aaa', 'ttt');
  readableCommitDeps.resolveRef = async () => 'aaa';
  readableCommitDeps.getCommit = async () => commit;
  readableCommitDeps.getTree = async () => ({ sha: 'ttt', entries: [] } as any);

  const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

  assertEquals(result, {
    ok: true,
    refCommitSha: 'aaa',
    resolvedCommitSha: 'aaa',
    degraded: false,
    commit,
  });
});

Deno.test('resolveReadableCommitFromRef - falls back to ancestor when primary tree is missing', async () => {
  restoreDeps();
  const primary = makeCommit('aaa', 'ttt-broken', ['bbb']);
  const fallback = makeCommit('bbb', 'ttt-ok');
  readableCommitDeps.resolveRef = async () => 'aaa';
  readableCommitDeps.getCommit = async () => primary;
  readableCommitDeps.getCommitLog = async () => [primary, fallback];
  readableCommitDeps.getTree = async (_bucket, treeSha) =>
    treeSha === 'ttt-ok' ? ({ sha: 'ttt-ok', entries: [] } as any) : null;

  const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

  assertEquals(result, {
    ok: true,
    refCommitSha: 'aaa',
    resolvedCommitSha: 'bbb',
    degraded: true,
    commit: fallback,
  });
});

Deno.test('resolveReadableCommitFromRef - returns commit_not_found when commit cannot be loaded', async () => {
  restoreDeps();
  readableCommitDeps.resolveRef = async () => 'aaa';
  readableCommitDeps.getCommit = async () => null;
  readableCommitDeps.getCommitLog = async () => [];

  const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

  assertEquals(result, { ok: false, reason: 'commit_not_found', refCommitSha: 'aaa' });
});

Deno.test('resolveReadableCommitFromRef - returns tree_not_found when no commit in history has a valid tree', async () => {
  restoreDeps();
  const primary = makeCommit('aaa', 'ttt-broken');
  readableCommitDeps.resolveRef = async () => 'aaa';
  readableCommitDeps.getCommit = async () => primary;
  readableCommitDeps.getCommitLog = async () => [primary];
  readableCommitDeps.getTree = async () => null;

  const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

  assertEquals(result, { ok: false, reason: 'tree_not_found', refCommitSha: 'aaa' });
});

Deno.test('resolveReadableCommitFromRef - respects fallbackLimit option', async () => {
  restoreDeps();
  const primary = makeCommit('aaa', 'ttt-broken');
  const calls: Array<[string, number]> = [];
  readableCommitDeps.resolveRef = async () => 'aaa';
  readableCommitDeps.getCommit = async () => primary;
  readableCommitDeps.getTree = async () => null;
  readableCommitDeps.getCommitLog = async (_db, _bucket, _repoId, refCommitSha, limit) => {
    calls.push([refCommitSha, limit ?? -1]);
    return [primary];
  };

  await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main', { fallbackLimit: 10 });

  assertEquals(calls, [['aaa', 10]]);
});

Deno.test('resolveReadableCommitFromRef - clamps fallbackLimit to at least 1', async () => {
  restoreDeps();
  const primary = makeCommit('aaa', 'ttt-broken');
  const calls: Array<[string, number]> = [];
  readableCommitDeps.resolveRef = async () => 'aaa';
  readableCommitDeps.getCommit = async () => primary;
  readableCommitDeps.getTree = async () => null;
  readableCommitDeps.getCommitLog = async (_db, _bucket, _repoId, refCommitSha, limit) => {
    calls.push([refCommitSha, limit ?? -1]);
    return [primary];
  };

  await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main', { fallbackLimit: -5 });

  assertEquals(calls, [['aaa', 1]]);
});

Deno.test('resolveReadableCommitFromRef - skips primary commit in fallback history scan', async () => {
  restoreDeps();
  const primary = makeCommit('aaa', 'ttt-broken', ['bbb']);
  const second = makeCommit('bbb', 'ttt-also-broken');
  const third = makeCommit('ccc', 'ttt-ok');
  readableCommitDeps.resolveRef = async () => 'aaa';
  readableCommitDeps.getCommit = async () => primary;
  readableCommitDeps.getCommitLog = async () => [primary, second, third];
  readableCommitDeps.getTree = async (_bucket, treeSha) =>
    treeSha === 'ttt-ok' ? ({ sha: 'ttt-ok', entries: [] } as any) : null;

  const result = await resolveReadableCommitFromRef(db, bucket, REPO_ID, 'main');

  assertEquals(result, {
    ok: true,
    refCommitSha: 'aaa',
    resolvedCommitSha: 'ccc',
    degraded: true,
    commit: third,
  });
});
