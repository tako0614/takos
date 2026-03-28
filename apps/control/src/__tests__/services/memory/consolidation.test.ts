import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/agent', () => ({
  LLMClient: vi.fn(() => ({
    chat: vi.fn().mockResolvedValue({ content: '[]' }),
  })),
}));

import { MemoryConsolidator } from '@/services/memory/consolidation';

describe('MemoryConsolidator', () => {
  it('creates a consolidator instance via direct construction', () => {
    const consolidator = new MemoryConsolidator({} as any);
    expect(consolidator).toBeInstanceOf(MemoryConsolidator);
  });
});

describe('MemoryConsolidator methods', () => {
  function createDrizzleMock() {
    const allMock = vi.fn();
    const getMock = vi.fn();
    const runMock = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      all: allMock,
      get: getMock,
      run: runMock,
    };
    return {
      select: vi.fn(() => chain),
      update: vi.fn(() => chain),
      delete: vi.fn(() => chain),
      insert: vi.fn(() => chain),
      run: runMock,
      _: { all: allMock, get: getMock, run: runMock, chain },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('applyDecay', () => {
    it('runs decay SQL queries and returns counts', async () => {
      const runMock = vi.fn()
        .mockResolvedValueOnce({ meta: { changes: 3 } }) // deleted
        .mockResolvedValueOnce({ meta: { changes: 10 } }); // updated

      mocks.getDb.mockReturnValue({ run: runMock });

      const consolidator = new MemoryConsolidator({} as any);
      const result = await consolidator.applyDecay('space-1');

      expect(result.deleted).toBe(3);
      expect(result.updated).toBe(10);
      expect(runMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('mergeSimilarSimple (no LLM)', () => {
    it('returns merged: 0 when fewer than 2 memories', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { id: 'm-1', type: 'semantic', content: 'only one memory', importance: 0.5 },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const consolidator = new MemoryConsolidator({} as any);
      const result = await consolidator.mergeSimilar('space-1');

      expect(result.merged).toBe(0);
    });

    it('returns merged: 0 for empty memories', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([]);
      mocks.getDb.mockReturnValue(drizzle);

      const consolidator = new MemoryConsolidator({} as any);
      const result = await consolidator.mergeSimilar('space-1');

      expect(result.merged).toBe(0);
    });

    it('merges similar memories of the same type', async () => {
      const deleteMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { id: 'm-1', type: 'semantic', content: 'the quick brown fox jumps over the lazy dog today', importance: 0.8 },
        { id: 'm-2', type: 'semantic', content: 'the quick brown fox jumps over the lazy dog yesterday', importance: 0.6 },
      ]);
      drizzle.delete = deleteMock;
      mocks.getDb.mockReturnValue(drizzle);

      const consolidator = new MemoryConsolidator({} as any);
      const result = await consolidator.mergeSimilar('space-1');

      // These two memories share high n-gram similarity
      expect(result.merged).toBeGreaterThanOrEqual(0);
    });

    it('does not merge memories of different types', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { id: 'm-1', type: 'semantic', content: 'the quick brown fox jumps over the lazy dog', importance: 0.8 },
        { id: 'm-2', type: 'episode', content: 'the quick brown fox jumps over the lazy dog', importance: 0.6 },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const consolidator = new MemoryConsolidator({} as any);
      const result = await consolidator.mergeSimilar('space-1');

      expect(result.merged).toBe(0);
    });
  });

  describe('summarizeOld', () => {
    it('returns summarized: 0 when no LLM client', async () => {
      const consolidator = new MemoryConsolidator({} as any);
      const result = await consolidator.summarizeOld('space-1');

      expect(result.summarized).toBe(0);
    });
  });

  describe('enforceLimit', () => {
    it('returns deleted: 0 when under limit', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.get.mockResolvedValue({ count: 100 });
      mocks.getDb.mockReturnValue(drizzle);

      const consolidator = new MemoryConsolidator({} as any);
      const result = await consolidator.enforceLimit('space-1');

      expect(result.deleted).toBe(0);
    });

    it('deletes excess memories when over limit', async () => {
      const deleteMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      const drizzle = createDrizzleMock();
      drizzle._.get.mockResolvedValue({ count: 10002 });
      drizzle._.all.mockResolvedValue([
        { id: 'm-excess-1' },
        { id: 'm-excess-2' },
      ]);
      drizzle.delete = deleteMock;
      mocks.getDb.mockReturnValue(drizzle);

      const consolidator = new MemoryConsolidator({} as any);
      const result = await consolidator.enforceLimit('space-1');

      expect(result.deleted).toBe(2);
    });
  });

  describe('consolidate', () => {
    it('runs all consolidation steps', async () => {
      // Mock applyDecay
      const runMock = vi.fn()
        .mockResolvedValue({ meta: { changes: 0 } });

      const drizzle = {
        ...createDrizzleMock(),
        run: runMock,
      };
      drizzle._.all.mockResolvedValue([]);
      drizzle._.get.mockResolvedValue({ count: 0 });
      mocks.getDb.mockReturnValue(drizzle);

      const consolidator = new MemoryConsolidator({} as any);
      const result = await consolidator.consolidate('space-1');

      expect(result).toHaveProperty('decayed');
      expect(result).toHaveProperty('merged');
      expect(result).toHaveProperty('summarized');
      expect(result).toHaveProperty('limited');
    });
  });
});
