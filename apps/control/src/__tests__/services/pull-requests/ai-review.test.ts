import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Env } from '@/types';

import { assertEquals } from 'jsr:@std/assert';

const mocks = ({
  getWorkspaceModelSettings: ((..._args: any[]) => undefined) as any,
  LLMClient: ((..._args: any[]) => undefined) as any,
  getProviderFromModel: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,
  resolveRef: ((..._args: any[]) => undefined) as any,
  getCommitData: ((..._args: any[]) => undefined) as any,
  flattenTree: ((..._args: any[]) => undefined) as any,
  getBlob: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/identity/spaces'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/llm'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
import { runAiReview } from '@/services/pull-requests/ai-review';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    returning: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    offset: (function(this: any) { return this; }),
    leftJoin: (function(this: any) { return this; }),
    innerJoin: (function(this: any) { return this; }),
    onConflictDoUpdate: (function(this: any) { return this; }),
    onConflictDoNothing: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
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


  Deno.test('runAiReview contract alignment (issue 004) - accepts db pullRequest shape and returns snake_case review/comment DTOs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const db = createDrizzleMock();
    mocks.getDb = (() => db) as any;
    mocks.getWorkspaceModelSettings = (async () => null) as any;
    mocks.getProviderFromModel = (() => 'openai') as any;

    mocks.LLMClient = () => ({
      chat: (async () => ({
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
      })),
    }) as any;

    mocks.resolveRef = async (_db: D1Database, _repoId: string, ref: string) => {
      if (ref === 'main') {
        return 'sha-base';
      }
      if (ref === 'feature/pr') {
        return 'sha-head';
      }
      return null;
    } as any;

    mocks.getCommitData = async (_bucket: R2Bucket, sha: string) => {
      if (sha === 'sha-base') {
        return { tree: 'tree-base' };
      }
      if (sha === 'sha-head') {
        return { tree: 'tree-head' };
      }
      return null;
    } as any;

    mocks.flattenTree = async (_bucket: R2Bucket, tree: string) => {
      if (tree === 'tree-base') {
        return [{ path: 'src/a.ts', sha: 'oid-base' }];
      }
      if (tree === 'tree-head') {
        return [{ path: 'src/a.ts', sha: 'oid-head' }];
      }
      return [];
    } as any;

    mocks.getBlob = async (_bucket: R2Bucket, oid: string) => {
      if (oid === 'oid-base') {
        return new TextEncoder().encode('old');
      }
      if (oid === 'oid-head') {
        return new TextEncoder().encode('new');
      }
      return null;
    } as any;

    // Drizzle call sequence in runAiReview:
    // 1. insert(prReviews).values({...}).returning().get() -> review record
    // 2. insert(prComments).values({...}) -> for each comment (no terminal needed)
    // 3. select().from(prComments).where(...).all() -> comment records
    db._.get = (async () => ({
      id: 'rev-1',
      prId: 'pr-1',
      reviewerType: 'ai',
      reviewerId: null,
      status: 'changes_requested',
      body: 'Needs changes',
      analysis: '{"status":"changes_requested"}',
      createdAt: '2026-02-10T00:00:00.000Z',
    })) as any;

    db._.all = (async () => [
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
    ]) as any;

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

    assertEquals(result.review.pr_id, 'pr-1');
    assertEquals(result.review.reviewer_type, 'ai');
    assertEquals(result.review.created_at, '2026-02-10T00:00:00.000Z');
    assertEquals('prId' in (result.review as unknown as Record<string, unknown>), false);

    assertEquals(result.comments.length, 1);
    assertEquals(result.comments[0].author_type, 'ai');
    assertEquals(result.comments[0].file_path, 'src/a.ts');
    assertEquals(result.comments[0].line_number, 10);
    assertEquals('filePath' in (result.comments[0] as unknown as Record<string, unknown>), false);
})