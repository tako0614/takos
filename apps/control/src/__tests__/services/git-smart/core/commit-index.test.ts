import type { GitCommit, GitSignature } from '@/services/git-smart/types';

// All mocks must be hoisted to survive /* mocks cleared (no-op in Deno) */ void 0 in the global setup
import { assertEquals } from 'jsr:@std/assert';

const {
  mockGetCommitData,
  mockDbGet,
  mockDbWhere,
  mockDbFrom,
  mockDbSelect,
  mockGetDb,
} = ({
  mockGetCommitData: ((..._args: any[]) => undefined) as any,
  mockDbGet: ((..._args: any[]) => undefined) as any,
  mockDbWhere: ((..._args: any[]) => undefined) as any,
  mockDbFrom: ((..._args: any[]) => undefined) as any,
  mockDbSelect: ((..._args: any[]) => undefined) as any,
  mockGetDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/core/object-store'

// [Deno] vi.mock removed - manually stub imports from '@/db'

import { isAncestor, findMergeBase } from '@/services/git-smart/core/commit-index';

// Test DAG:
//   A <- B <- C (merge: parents [B, E])  <- D
//   E <------/
//
// A is root (no parents)
// B's parent is A
// C's parents are [B, E] (merge commit)
// D's parent is C
// E is root (no parents)

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SHA_C = 'cccccccccccccccccccccccccccccccccccccccc';
const SHA_D = 'dddddddddddddddddddddddddddddddddddddddd';
const SHA_E = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SHA_UNKNOWN = 'ffffffffffffffffffffffffffffffffffffffff';

const REPO_ID = 'test-repo';

function makeSig(ts: number): GitSignature {
  return {
    name: 'Test User',
    email: 'test@example.com',
    timestamp: ts,
    tzOffset: '+0000',
  };
}

function makeCommit(sha: string, parents: string[]): GitCommit {
  return {
    sha,
    tree: '0000000000000000000000000000000000000000',
    parents,
    author: makeSig(1000000),
    committer: makeSig(1000000),
    message: `commit ${sha.slice(0, 8)}`,
  };
}

const commitMap = new Map<string, GitCommit>([
  [SHA_A, makeCommit(SHA_A, [])],
  [SHA_B, makeCommit(SHA_B, [SHA_A])],
  [SHA_C, makeCommit(SHA_C, [SHA_B, SHA_E])],
  [SHA_D, makeCommit(SHA_D, [SHA_C])],
  [SHA_E, makeCommit(SHA_E, [])],
]);

const mockDb = {} as any;
const mockBucket = {} as any;

/** Re-establish the Drizzle mock chain so getCommitFromIndex returns null */
function setupDbChain() {
  mockDbGet = (async () => null) as any;
  mockDbWhere = (() => ({ get: mockDbGet })) as any;
  mockDbFrom = (() => ({ where: mockDbWhere })) as any;
  mockDbSelect = (() => ({ from: mockDbFrom })) as any;
  mockGetDb = (() => ({ select: mockDbSelect })) as any;
}


  Deno.test('isAncestor - returns true when SHAs are the same', async () => {
  setupDbChain();
  mockGetCommitData = async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  } as any;
  assertEquals(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_A, SHA_A), true);
})

  Deno.test('isAncestor - returns true for direct parent', async () => {
  setupDbChain();
  mockGetCommitData = async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  } as any;
  assertEquals(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_A, SHA_B), true);
})

  Deno.test('isAncestor - returns true for grandparent', async () => {
  setupDbChain();
  mockGetCommitData = async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  } as any;
  assertEquals(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_A, SHA_D), true);
})

  Deno.test('isAncestor - returns true for ancestor via merge parent', async () => {
  setupDbChain();
  mockGetCommitData = async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  } as any;
  assertEquals(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_E, SHA_D), true);
})

  Deno.test('isAncestor - returns false when not an ancestor', async () => {
  setupDbChain();
  mockGetCommitData = async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  } as any;
  assertEquals(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_D, SHA_A), false);
})

  Deno.test('isAncestor - returns false for unknown SHA', async () => {
  setupDbChain();
  mockGetCommitData = async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  } as any;
  assertEquals(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_UNKNOWN, SHA_D), false);
})



  Deno.test('findMergeBase - finds common ancestor in linear chain', async () => {
  setupDbChain();
  mockGetCommitData = async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  } as any;
  const base = await findMergeBase(mockDb, mockBucket, REPO_ID, SHA_B, SHA_D);
    assertEquals(base, SHA_B);
})

  Deno.test('findMergeBase - finds merge base of diverged branches', async () => {
  setupDbChain();
  mockGetCommitData = async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  } as any;
  // ancestors of D: {D, C, B, A, E}
    // Walking from E: E is in ancestors of D -> return E
    const base = await findMergeBase(mockDb, mockBucket, REPO_ID, SHA_D, SHA_E);
    assertEquals(base, SHA_E);
})

  Deno.test('findMergeBase - finds merge base when both share a common root', async () => {
  setupDbChain();
  mockGetCommitData = async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  } as any;
  // ancestors of A: {A}
    // Walking from B: B not in {A}, then A is in {A} -> return A
    const base = await findMergeBase(mockDb, mockBucket, REPO_ID, SHA_A, SHA_B);
    assertEquals(base, SHA_A);
})

  Deno.test('findMergeBase - returns null when no common ancestor exists', async () => {
  setupDbChain();
  mockGetCommitData = async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  } as any;
  const SHA_ISOLATED = '1111111111111111111111111111111111111111';
    mockGetCommitData = async (_bucket: any, sha: string) => {
      if (sha === SHA_ISOLATED) return makeCommit(SHA_ISOLATED, []);
      return commitMap.get(sha) ?? null;
    } as any;

    const base = await findMergeBase(mockDb, mockBucket, REPO_ID, SHA_A, SHA_ISOLATED);
    assertEquals(base, null);
})

