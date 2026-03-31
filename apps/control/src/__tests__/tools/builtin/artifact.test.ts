import type { ToolContext } from '@/tools/types';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockInsertValues = ((..._args: any[]) => undefined) as any;
const mockSelectAll = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
import {
  createArtifactHandler,
  searchHandler,
  CREATE_ARTIFACT,
  SEARCH,
  ARTIFACT_TOOLS,
} from '@/tools/builtin/artifact';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


  
    Deno.test('artifact tools - definitions - CREATE_ARTIFACT requires type, title, content', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(CREATE_ARTIFACT.name, 'create_artifact');
      assertEquals(CREATE_ARTIFACT.category, 'artifact');
      assertEquals(CREATE_ARTIFACT.parameters.required, ['type', 'title', 'content']);
})
    Deno.test('artifact tools - definitions - SEARCH requires query', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(SEARCH.name, 'search');
      assertEquals(SEARCH.category, 'artifact');
      assertEquals(SEARCH.parameters.required, ['query']);
})
    Deno.test('artifact tools - definitions - ARTIFACT_TOOLS exports both tools', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(ARTIFACT_TOOLS.length, 2);
      assertEquals(ARTIFACT_TOOLS.map(t => t.name), ['create_artifact', 'search']);
})  
  
    Deno.test('artifact tools - createArtifactHandler - creates an artifact and returns confirmation', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await createArtifactHandler(
        { type: 'code', title: 'My Script', content: 'console.log("hi")' },
        makeContext(),
      );

      assertStringIncludes(result, 'Created artifact: My Script (code)');
      assertSpyCallArgs(mockInsertValues, 0, [
        ({
          id: 'artifact-id-1',
          runId: 'run-1',
          accountId: 'ws-test',
          type: 'code',
          title: 'My Script',
          content: 'console.log("hi")',
          metadata: '{}',
        }),
      ]);
})
    Deno.test('artifact tools - createArtifactHandler - supports various artifact types', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  for (const type of ['code', 'config', 'doc', 'patch', 'report', 'other']) {
        /* mocks cleared (no-op in Deno) */ void 0;
        const result = await createArtifactHandler(
          { type, title: `${type}-artifact`, content: 'some content' },
          makeContext(),
        );
        assertStringIncludes(result, `(${type})`);
      }
})  
  
    Deno.test('artifact tools - searchHandler - returns no files when workspace is empty', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectAll = (async () => []) as any;

      const result = await searchHandler(
        { query: 'test', type: 'filename' },
        makeContext(),
      );

      assertStringIncludes(result, 'No files matching');
})
    Deno.test('artifact tools - searchHandler - searches by filename', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectAll = (async () => [
        { path: '/src/index.ts', size: 1024, kind: 'file' },
        { path: '/src/utils/index.ts', size: 512, kind: 'file' },
      ]) as any;

      const result = await searchHandler(
        { query: 'index', type: 'filename' },
        makeContext(),
      );

      assertStringIncludes(result, 'Found 2 files');
      assertStringIncludes(result, '/src/index.ts');
      assertStringIncludes(result, '/src/utils/index.ts');
})
    Deno.test('artifact tools - searchHandler - returns note about vector indexing when no storage', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectAll = (async () => [
        { id: 'f1', path: '/src/file.ts' },
      ]) as any;

      const result = await searchHandler(
        { query: 'test' }, // defaults to content search
        makeContext({ storage: undefined }),
      );

      assertStringIncludes(result, 'vector indexing');
})
    Deno.test('artifact tools - searchHandler - returns no matches for content search', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockStorage = {
        get: (async () => ({
          text: (async () => 'nothing relevant here'),
        })),
      };

      mockSelectAll = (async () => [
        { id: 'f1', path: '/src/file.ts' },
      ]) as any;

      const result = await searchHandler(
        { query: 'nonexistent_pattern', type: 'content' },
        makeContext({ storage: mockStorage as unknown as R2Bucket }),
      );

      assertStringIncludes(result, 'No matches found');
})
    Deno.test('artifact tools - searchHandler - finds matching content in files', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockStorage = {
        get: (async () => ({
          text: (async () => 'line 1\nfunction test() {\nline 3'),
        })),
      };

      mockSelectAll = (async () => [
        { id: 'f1', path: '/src/file.ts' },
      ]) as any;

      const result = await searchHandler(
        { query: 'function test', type: 'content' },
        makeContext({ storage: mockStorage as unknown as R2Bucket }),
      );

      assertStringIncludes(result, 'Found');
      assertStringIncludes(result, '/src/file.ts:2');
      assertStringIncludes(result, 'function test()');
})
    Deno.test('artifact tools - searchHandler - defaults to content search when type not specified', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectAll = (async () => []) as any;

      const result = await searchHandler(
        { query: 'test' },
        makeContext(),
      );

      assertStringIncludes(result, 'No files in workspace');
})  