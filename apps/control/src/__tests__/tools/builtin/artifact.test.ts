import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database, R2Bucket } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInsertValues = vi.fn();
const mockSelectAll = vi.fn();

vi.mock('@/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    get: vi.fn(async () => null),
    all: vi.fn(() => mockSelectAll()),
  };

  return {
    getDb: () => ({
      select: vi.fn(() => chain),
      insert: vi.fn(() => ({
        values: vi.fn((...args: unknown[]) => {
          mockInsertValues(...args);
          return { run: vi.fn() };
        }),
      })),
    }),
    artifacts: {
      id: 'id',
      runId: 'run_id',
      accountId: 'account_id',
      type: 'type',
      title: 'title',
      content: 'content',
      metadata: 'metadata',
      createdAt: 'created_at',
    },
    files: {
      id: 'id',
      accountId: 'account_id',
      path: 'path',
      size: 'size',
      kind: 'kind',
      origin: 'origin',
      updatedAt: 'updated_at',
    },
  };
});

vi.mock('@/utils', () => ({
  generateId: vi.fn(() => 'artifact-id-1'),
}));

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
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('artifact tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('definitions', () => {
    it('CREATE_ARTIFACT requires type, title, content', () => {
      expect(CREATE_ARTIFACT.name).toBe('create_artifact');
      expect(CREATE_ARTIFACT.category).toBe('artifact');
      expect(CREATE_ARTIFACT.parameters.required).toEqual(['type', 'title', 'content']);
    });

    it('SEARCH requires query', () => {
      expect(SEARCH.name).toBe('search');
      expect(SEARCH.category).toBe('artifact');
      expect(SEARCH.parameters.required).toEqual(['query']);
    });

    it('ARTIFACT_TOOLS exports both tools', () => {
      expect(ARTIFACT_TOOLS).toHaveLength(2);
      expect(ARTIFACT_TOOLS.map(t => t.name)).toEqual(['create_artifact', 'search']);
    });
  });

  describe('createArtifactHandler', () => {
    it('creates an artifact and returns confirmation', async () => {
      const result = await createArtifactHandler(
        { type: 'code', title: 'My Script', content: 'console.log("hi")' },
        makeContext(),
      );

      expect(result).toContain('Created artifact: My Script (code)');
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'artifact-id-1',
          runId: 'run-1',
          accountId: 'ws-test',
          type: 'code',
          title: 'My Script',
          content: 'console.log("hi")',
          metadata: '{}',
        }),
      );
    });

    it('supports various artifact types', async () => {
      for (const type of ['code', 'config', 'doc', 'patch', 'report', 'other']) {
        vi.clearAllMocks();
        const result = await createArtifactHandler(
          { type, title: `${type}-artifact`, content: 'some content' },
          makeContext(),
        );
        expect(result).toContain(`(${type})`);
      }
    });
  });

  describe('searchHandler', () => {
    it('returns no files when workspace is empty', async () => {
      mockSelectAll.mockResolvedValue([]);

      const result = await searchHandler(
        { query: 'test', type: 'filename' },
        makeContext(),
      );

      expect(result).toContain('No files matching');
    });

    it('searches by filename', async () => {
      mockSelectAll.mockResolvedValue([
        { path: '/src/index.ts', size: 1024, kind: 'file' },
        { path: '/src/utils/index.ts', size: 512, kind: 'file' },
      ]);

      const result = await searchHandler(
        { query: 'index', type: 'filename' },
        makeContext(),
      );

      expect(result).toContain('Found 2 files');
      expect(result).toContain('/src/index.ts');
      expect(result).toContain('/src/utils/index.ts');
    });

    it('returns note about vector indexing when no storage', async () => {
      mockSelectAll.mockResolvedValue([
        { id: 'f1', path: '/src/file.ts' },
      ]);

      const result = await searchHandler(
        { query: 'test' }, // defaults to content search
        makeContext({ storage: undefined }),
      );

      expect(result).toContain('vector indexing');
    });

    it('returns no matches for content search', async () => {
      const mockStorage = {
        get: vi.fn().mockResolvedValue({
          text: vi.fn().mockResolvedValue('nothing relevant here'),
        }),
      };

      mockSelectAll.mockResolvedValue([
        { id: 'f1', path: '/src/file.ts' },
      ]);

      const result = await searchHandler(
        { query: 'nonexistent_pattern', type: 'content' },
        makeContext({ storage: mockStorage as unknown as R2Bucket }),
      );

      expect(result).toContain('No matches found');
    });

    it('finds matching content in files', async () => {
      const mockStorage = {
        get: vi.fn().mockResolvedValue({
          text: vi.fn().mockResolvedValue('line 1\nfunction test() {\nline 3'),
        }),
      };

      mockSelectAll.mockResolvedValue([
        { id: 'f1', path: '/src/file.ts' },
      ]);

      const result = await searchHandler(
        { query: 'function test', type: 'content' },
        makeContext({ storage: mockStorage as unknown as R2Bucket }),
      );

      expect(result).toContain('Found');
      expect(result).toContain('/src/file.ts:2');
      expect(result).toContain('function test()');
    });

    it('defaults to content search when type not specified', async () => {
      mockSelectAll.mockResolvedValue([]);

      const result = await searchHandler(
        { query: 'test' },
        makeContext(),
      );

      expect(result).toContain('No files in workspace');
    });
  });
});
