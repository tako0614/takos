import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitCommit, GitSignature } from '@/services/git-smart/types';

// All mocks must be hoisted to survive vi.clearAllMocks() in the global setup
const {
  mockGetCommitData,
  mockDbGet,
  mockDbWhere,
  mockDbFrom,
  mockDbSelect,
  mockGetDb,
} = vi.hoisted(() => ({
  mockGetCommitData: vi.fn(),
  mockDbGet: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbSelect: vi.fn(),
  mockGetDb: vi.fn(),
}));

vi.mock('@/services/git-smart/core/object-store', () => ({
  getCommitData: mockGetCommitData,
  putCommit: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: mockGetDb,
  commits: { repoId: 'repoId', sha: 'sha' },
}));

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
  mockDbGet.mockResolvedValue(null);
  mockDbWhere.mockReturnValue({ get: mockDbGet });
  mockDbFrom.mockReturnValue({ where: mockDbWhere });
  mockDbSelect.mockReturnValue({ from: mockDbFrom });
  mockGetDb.mockReturnValue({ select: mockDbSelect });
}

beforeEach(() => {
  setupDbChain();
  mockGetCommitData.mockImplementation(async (_bucket: any, sha: string) => {
    return commitMap.get(sha) ?? null;
  });
});

describe('isAncestor', () => {
  it('returns true when SHAs are the same', async () => {
    expect(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_A, SHA_A)).toBe(true);
  });

  it('returns true for direct parent', async () => {
    expect(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_A, SHA_B)).toBe(true);
  });

  it('returns true for grandparent', async () => {
    expect(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_A, SHA_D)).toBe(true);
  });

  it('returns true for ancestor via merge parent', async () => {
    expect(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_E, SHA_D)).toBe(true);
  });

  it('returns false when not an ancestor', async () => {
    expect(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_D, SHA_A)).toBe(false);
  });

  it('returns false for unknown SHA', async () => {
    expect(await isAncestor(mockDb, mockBucket, REPO_ID, SHA_UNKNOWN, SHA_D)).toBe(false);
  });
});

describe('findMergeBase', () => {
  it('finds common ancestor in linear chain', async () => {
    const base = await findMergeBase(mockDb, mockBucket, REPO_ID, SHA_B, SHA_D);
    expect(base).toBe(SHA_B);
  });

  it('finds merge base of diverged branches', async () => {
    // ancestors of D: {D, C, B, A, E}
    // Walking from E: E is in ancestors of D -> return E
    const base = await findMergeBase(mockDb, mockBucket, REPO_ID, SHA_D, SHA_E);
    expect(base).toBe(SHA_E);
  });

  it('finds merge base when both share a common root', async () => {
    // ancestors of A: {A}
    // Walking from B: B not in {A}, then A is in {A} -> return A
    const base = await findMergeBase(mockDb, mockBucket, REPO_ID, SHA_A, SHA_B);
    expect(base).toBe(SHA_A);
  });

  it('returns null when no common ancestor exists', async () => {
    const SHA_ISOLATED = '1111111111111111111111111111111111111111';
    mockGetCommitData.mockImplementation(async (_bucket: any, sha: string) => {
      if (sha === SHA_ISOLATED) return makeCommit(SHA_ISOLATED, []);
      return commitMap.get(sha) ?? null;
    });

    const base = await findMergeBase(mockDb, mockBucket, REPO_ID, SHA_A, SHA_ISOLATED);
    expect(base).toBeNull();
  });
});
