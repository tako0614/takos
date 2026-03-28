import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getWorkspaceModelSettings: vi.fn(),
  LLMClient: vi.fn(),
  getProviderFromModel: vi.fn(),
  getDb: vi.fn(),
  resolveRef: vi.fn(),
  getCommitData: vi.fn(),
  flattenTree: vi.fn(),
  getBlob: vi.fn(),
}));

vi.mock('@/services/identity/spaces', () => ({
  getWorkspaceModelSettings: mocks.getWorkspaceModelSettings,
}));

vi.mock('@/services/agent/llm', () => ({
  LLMClient: mocks.LLMClient,
  getProviderFromModel: mocks.getProviderFromModel,
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/git-smart', () => ({
  resolveRef: mocks.resolveRef,
  getCommitData: mocks.getCommitData,
  flattenTree: mocks.flattenTree,
  getBlob: mocks.getBlob,
}));

import { runAiReview } from '@/services/pull-requests/ai-review';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

function createEnv(): Env {
  return {
    DB: {} as D1Database,
    GIT_OBJECTS: {} as R2Bucket,
    OPENAI_API_KEY: 'openai-key',
    ANTHROPIC_API_KEY: '',
    GOOGLE_API_KEY: '',
  } as unknown as Env;
}

describe('runAiReview contract alignment (issue 004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts db pullRequest shape and returns snake_case review/comment DTOs', async () => {
    const db = createDrizzleMock();
    mocks.getDb.mockReturnValue(db);
    mocks.getWorkspaceModelSettings.mockResolvedValue(null);
    mocks.getProviderFromModel.mockReturnValue('openai');

    mocks.LLMClient.mockImplementation(() => ({
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          status: 'changes_requested',
          summary: 'Needs changes',
          issues: ['Fix null handling'],
          comments: [
            {
              file_path: 'src/a.ts',
              line_number: 10,
              content: 'Guard null before access',
            },
          ],
        }),
      }),
    }));

    mocks.resolveRef.mockImplementation(async (_db: D1Database, _repoId: string, ref: string) => {
      if (ref === 'main') {
        return 'sha-base';
      }
      if (ref === 'feature/pr') {
        return 'sha-head';
      }
      return null;
    });

    mocks.getCommitData.mockImplementation(async (_bucket: R2Bucket, sha: string) => {
      if (sha === 'sha-base') {
        return { tree: 'tree-base' };
      }
      if (sha === 'sha-head') {
        return { tree: 'tree-head' };
      }
      return null;
    });

    mocks.flattenTree.mockImplementation(async (_bucket: R2Bucket, tree: string) => {
      if (tree === 'tree-base') {
        return [{ path: 'src/a.ts', sha: 'oid-base' }];
      }
      if (tree === 'tree-head') {
        return [{ path: 'src/a.ts', sha: 'oid-head' }];
      }
      return [];
    });

    mocks.getBlob.mockImplementation(async (_bucket: R2Bucket, oid: string) => {
      if (oid === 'oid-base') {
        return new TextEncoder().encode('old');
      }
      if (oid === 'oid-head') {
        return new TextEncoder().encode('new');
      }
      return null;
    });

    // Drizzle call sequence in runAiReview:
    // 1. insert(prReviews).values({...}).returning().get() -> review record
    // 2. insert(prComments).values({...}) -> for each comment (no terminal needed)
    // 3. select().from(prComments).where(...).all() -> comment records
    db._.get.mockResolvedValueOnce({
      id: 'rev-1',
      prId: 'pr-1',
      reviewerType: 'ai',
      reviewerId: null,
      status: 'changes_requested',
      body: 'Needs changes',
      analysis: '{"status":"changes_requested"}',
      createdAt: '2026-02-10T00:00:00.000Z',
    });

    db._.all.mockResolvedValueOnce([
      {
        id: 'cmt-1',
        prId: 'pr-1',
        authorType: 'ai',
        authorId: null,
        content: 'Guard null before access',
        filePath: 'src/a.ts',
        lineNumber: 10,
        createdAt: '2026-02-10T00:00:00.000Z',
      },
    ]);

    const result = await runAiReview({
      env: createEnv(),
      repoId: 'repo-1',
      pullRequest: {
        id: 'pr-1',
        number: 5,
        title: 'Fix review flow',
        description: 'desc',
        baseBranch: 'main',
        headBranch: 'feature/pr',
      },
      spaceId: 'ws-1',
    });

    expect(result.review.pr_id).toBe('pr-1');
    expect(result.review.reviewer_type).toBe('ai');
    expect(result.review.created_at).toBe('2026-02-10T00:00:00.000Z');
    expect('prId' in (result.review as unknown as Record<string, unknown>)).toBe(false);

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].author_type).toBe('ai');
    expect(result.comments[0].file_path).toBe('src/a.ts');
    expect(result.comments[0].line_number).toBe(10);
    expect('filePath' in (result.comments[0] as unknown as Record<string, unknown>)).toBe(false);
  });
});
