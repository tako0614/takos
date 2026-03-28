import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Drizzle-chainable mock
// ---------------------------------------------------------------------------

const mockSelectGet = vi.fn();
const mockSelectAll = vi.fn();

vi.mock('@/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    get: vi.fn(() => mockSelectGet()),
    all: vi.fn(() => mockSelectAll()),
  };
  return {
    getDb: () => ({
      select: vi.fn(() => chain),
    }),
    infoUnits: {
      id: 'id',
      accountId: 'account_id',
      runId: 'run_id',
      kind: 'kind',
      content: 'content',
      createdAt: 'created_at',
      metadata: 'metadata',
    },
    repositories: {
      id: 'id',
      accountId: 'account_id',
    },
    nodes: {
      id: 'id',
      accountId: 'account_id',
      type: 'type',
      refId: 'ref_id',
      label: 'label',
    },
    edges: {
      sourceId: 'source_id',
      targetId: 'target_id',
      accountId: 'account_id',
      type: 'type',
    },
  };
});

import {
  INFO_UNIT_SEARCH,
  REPO_GRAPH_SEARCH,
  REPO_GRAPH_NEIGHBORS,
  REPO_GRAPH_LINEAGE,
  INFO_UNIT_TOOLS,
  INFO_UNIT_HANDLERS,
  infoUnitSearchHandler,
  repoGraphSearchHandler,
  repoGraphNeighborsHandler,
  repoGraphLineageHandler,
} from '@/tools/builtin/info-unit';

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

function makeContextWithAI(): ToolContext {
  return makeContext({
    env: {
      AI: {
        run: vi.fn(async () => ({ data: [[0.1, 0.2, 0.3]] })),
      },
      VECTORIZE: {
        query: vi.fn(async () => ({
          matches: [
            {
              score: 0.9,
              metadata: {
                content: 'TypeScript is preferred',
                runId: 'run-1',
                segmentIndex: 0,
                segmentCount: 1,
              },
            },
            {
              score: 0.3, // Below default threshold
              metadata: { content: 'Low score result' },
            },
          ],
        })),
      },
    } as unknown as Env,
  });
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

describe('info unit tool definitions', () => {
  it('defines all four info unit tools', () => {
    expect(INFO_UNIT_TOOLS).toHaveLength(4);
    const names = INFO_UNIT_TOOLS.map((t) => t.name);
    expect(names).toEqual([
      'info_unit_search',
      'repo_graph_search',
      'repo_graph_neighbors',
      'repo_graph_lineage',
    ]);
  });

  it('all tools have memory category', () => {
    for (const def of INFO_UNIT_TOOLS) {
      expect(def.category).toBe('memory');
    }
  });

  it('info_unit_search requires query', () => {
    expect(INFO_UNIT_SEARCH.parameters.required).toEqual(['query']);
  });

  it('repo_graph_search requires query', () => {
    expect(REPO_GRAPH_SEARCH.parameters.required).toEqual(['query']);
  });

  it('repo_graph_neighbors has no required params', () => {
    expect(REPO_GRAPH_NEIGHBORS.parameters.required).toEqual([]);
  });

  it('repo_graph_lineage requires info_unit_id', () => {
    expect(REPO_GRAPH_LINEAGE.parameters.required).toEqual(['info_unit_id']);
  });

  it('INFO_UNIT_HANDLERS maps all tools', () => {
    const keys = Object.keys(INFO_UNIT_HANDLERS);
    expect(keys).toHaveLength(4);
    for (const def of INFO_UNIT_TOOLS) {
      expect(INFO_UNIT_HANDLERS).toHaveProperty(def.name);
    }
  });
});

// ---------------------------------------------------------------------------
// infoUnitSearchHandler
// ---------------------------------------------------------------------------

describe('infoUnitSearchHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when query is empty', async () => {
    await expect(
      infoUnitSearchHandler({ query: '' }, makeContext()),
    ).rejects.toThrow('Query is required');
  });

  it('throws when query is whitespace only', async () => {
    await expect(
      infoUnitSearchHandler({ query: '   ' }, makeContext()),
    ).rejects.toThrow('Query is required');
  });

  it('uses vector search when AI and VECTORIZE are available', async () => {
    const ctx = makeContextWithAI();

    const result = await infoUnitSearchHandler({ query: 'TypeScript' }, ctx);

    expect(result).toContain('Found 1 info units');
    expect(result).toContain('TypeScript is preferred');
    expect(result).toContain('0.900');
    expect(result).toContain('run:run-1');
  });

  it('returns no results message when vector search has no matches above threshold', async () => {
    const ctx = makeContext({
      env: {
        AI: {
          run: vi.fn(async () => ({ data: [[0.1, 0.2]] })),
        },
        VECTORIZE: {
          query: vi.fn(async () => ({
            matches: [{ score: 0.3, metadata: { content: 'low' } }],
          })),
        },
      } as unknown as Env,
    });

    const result = await infoUnitSearchHandler({ query: 'nothing here' }, ctx);
    expect(result).toContain('No info units found');
  });

  it('handles embedding failure', async () => {
    const ctx = makeContext({
      env: {
        AI: { run: vi.fn(async () => ({ data: [] })) },
        VECTORIZE: { query: vi.fn() },
      } as unknown as Env,
    });

    const result = await infoUnitSearchHandler({ query: 'test' }, ctx);
    expect(result).toContain('embedding failed');
  });

  it('falls back to text search when AI is not available', async () => {
    mockSelectAll.mockResolvedValue([
      { id: 'u1', runId: 'run-1', kind: 'summary', content: 'Matching content', createdAt: '2026-01-01' },
    ]);

    const result = await infoUnitSearchHandler({ query: 'Matching' }, makeContext());

    expect(result).toContain('Found 1 info units');
    expect(result).toContain('run:run-1');
    expect(result).toContain('Matching content');
  });

  it('reports no results in text search fallback', async () => {
    mockSelectAll.mockResolvedValue([]);

    const result = await infoUnitSearchHandler({ query: 'nothing' }, makeContext());
    expect(result).toContain('No info units found');
  });

  it('respects custom limit and min_score', async () => {
    const ctx = makeContextWithAI();

    await infoUnitSearchHandler({ query: 'test', limit: 2, min_score: 0.8 }, ctx);

    expect((ctx.env.VECTORIZE as any).query).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ topK: 4 }),
    );
  });
});

// ---------------------------------------------------------------------------
// repoGraphSearchHandler
// ---------------------------------------------------------------------------

describe('repoGraphSearchHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when query is empty', async () => {
    await expect(
      repoGraphSearchHandler({ query: '' }, makeContext()),
    ).rejects.toThrow('Query is required');
  });

  it('rejects unauthorized repo access', async () => {
    mockSelectAll.mockResolvedValue([]); // resolveAccessibleRepoIds finds no owned repos

    await expect(
      repoGraphSearchHandler(
        { query: 'test', repo_ids: ['unauthorized-repo'] },
        makeContext(),
      ),
    ).rejects.toThrow('Repository access denied');
  });

  it('falls back to text search without AI', async () => {
    // resolveAccessibleRepoIds short-circuits when repo_ids is empty, so only
    // the main text-search query calls .all()
    mockSelectAll
      .mockResolvedValueOnce([
        { id: 'u1', runId: 'r1', kind: 'summary', content: 'Test content', createdAt: '2026-01-01', metadata: '{}' },
      ]);

    const result = await repoGraphSearchHandler({ query: 'Test' }, makeContext());
    expect(result).toContain('Found 1 info units');
  });
});

// ---------------------------------------------------------------------------
// repoGraphNeighborsHandler
// ---------------------------------------------------------------------------

describe('repoGraphNeighborsHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when neither node_id nor info_unit_id is provided', async () => {
    mockSelectGet.mockResolvedValue(undefined);

    await expect(
      repoGraphNeighborsHandler({}, makeContext()),
    ).rejects.toThrow('node_id or info_unit_id is required');
  });

  it('returns no neighbors message when none found', async () => {
    mockSelectAll.mockResolvedValue([]);

    const result = await repoGraphNeighborsHandler(
      { node_id: 'node-1' },
      makeContext(),
    );
    expect(result).toBe('No neighboring nodes found.');
  });

  it('resolves info_unit_id to node_id', async () => {
    mockSelectGet.mockResolvedValue({ id: 'resolved-node' });
    mockSelectAll.mockResolvedValue([]);

    const result = await repoGraphNeighborsHandler(
      { info_unit_id: 'iu-1' },
      makeContext(),
    );
    expect(result).toBe('No neighboring nodes found.');
  });
});

// ---------------------------------------------------------------------------
// repoGraphLineageHandler
// ---------------------------------------------------------------------------

describe('repoGraphLineageHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns not found when info unit node does not exist', async () => {
    mockSelectGet.mockResolvedValue(null);

    const result = await repoGraphLineageHandler(
      { info_unit_id: 'missing' },
      makeContext(),
    );
    expect(result).toBe('Info unit node not found.');
  });

  it('returns no lineage message when no edges found', async () => {
    mockSelectGet.mockResolvedValue({ id: 'node-1' });
    mockSelectAll.mockResolvedValue([]);

    const result = await repoGraphLineageHandler(
      { info_unit_id: 'iu-1' },
      makeContext(),
    );
    expect(result).toBe('No lineage edges found.');
  });
});
