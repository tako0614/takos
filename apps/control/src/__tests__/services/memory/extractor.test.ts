import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  chatAndParseJsonArray: vi.fn(),
  createLLMClient: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/agent', () => ({
  createLLMClient: mocks.createLLMClient,
}));

vi.mock('@/services/memory/helpers', () => ({
  chatAndParseJsonArray: mocks.chatAndParseJsonArray,
}));

import { shouldAutoExtract, MemoryExtractor } from '@/services/memory/extractor';

describe('shouldAutoExtract', () => {
  it('returns true when message count exceeds threshold', () => {
    expect(shouldAutoExtract(10, 0)).toBe(true);
    expect(shouldAutoExtract(20, 10)).toBe(true);
    expect(shouldAutoExtract(25, 10)).toBe(true);
  });

  it('returns false when not enough new messages', () => {
    expect(shouldAutoExtract(5, 0)).toBe(false);
    expect(shouldAutoExtract(9, 0)).toBe(false);
    expect(shouldAutoExtract(15, 10)).toBe(false);
  });

  it('returns true at exactly the threshold', () => {
    expect(shouldAutoExtract(10, 0)).toBe(true);
    expect(shouldAutoExtract(20, 10)).toBe(true);
  });
});

describe('MemoryExtractor', () => {
  function createDrizzleMock() {
    const allMock = vi.fn();
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      all: allMock,
    };
    return {
      select: vi.fn(() => chain),
      insert: vi.fn(() => ({
        values: vi.fn().mockResolvedValue(undefined),
      })),
      _: { all: allMock },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractFromThread (pattern-based)', () => {
    it('returns empty array when no messages found', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result).toEqual([]);
    });

    it('extracts "remember" pattern memories', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'remember this: my API key is xyz123' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('semantic');
      expect(result[0].importance).toBe(0.9);
    });

    it('extracts "decision" pattern memories', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'We decided to use React for the frontend' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('episode');
      expect(result[0].category).toBe('decision');
    });

    it('extracts "fact" pattern memories', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'My company is Acme Corp' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('semantic');
      expect(result[0].category).toBe('fact');
    });

    it('extracts "preference" pattern memories', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'I always prefer TypeScript over JavaScript' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('procedural');
      expect(result[0].category).toBe('preference');
    });

    it('skips assistant messages', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'assistant', content: 'I decided to help you with this' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result).toEqual([]);
    });

    it('deduplicates similar extractions', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'remember this: important note' },
        { role: 'user', content: 'remember this: important note again' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      // Should deduplicate based on first 50 chars of content
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it('limits to 10 extractions', async () => {
      const messages = Array.from({ length: 20 }, (_, i) => ({
        role: 'user',
        content: `remember this: unique note number ${i}`,
      }));
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue(messages);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result.length).toBeLessThanOrEqual(10);
    });
  });

  describe('saveMemories', () => {
    it('saves extracted memories to the database', async () => {
      const insertMock = vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      const drizzle = { insert: insertMock };
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const saved = await extractor.saveMemories('space-1', 'thread-1', 'user-1', [
        { type: 'semantic', content: 'test memory', importance: 0.8 },
      ]);

      expect(saved).toBe(1);
      expect(insertMock).toHaveBeenCalled();
    });

    it('continues on individual save failures', async () => {
      const insertMock = vi.fn()
        .mockReturnValueOnce({
          values: vi.fn().mockRejectedValue(new Error('DB error')),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValue(undefined),
        });
      const drizzle = { insert: insertMock };
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const saved = await extractor.saveMemories('space-1', 'thread-1', 'user-1', [
        { type: 'semantic', content: 'memory 1', importance: 0.8 },
        { type: 'episode', content: 'memory 2', importance: 0.7 },
      ]);

      expect(saved).toBe(1); // Only second one succeeded
    });

    it('returns 0 for empty array', async () => {
      const extractor = new MemoryExtractor({} as any);
      const saved = await extractor.saveMemories('space-1', 'thread-1', 'user-1', []);
      expect(saved).toBe(0);
    });
  });

  describe('extractFromThread (LLM-based)', () => {
    it('uses LLM extraction when apiKey is provided and LLM returns valid memories', async () => {
      const mockLLMClient = { chat: vi.fn() };
      mocks.createLLMClient.mockReturnValue(mockLLMClient);

      const llmMemories = [
        { type: 'semantic', content: 'User works at Acme Corp', category: 'user', importance: 0.8 },
        { type: 'episode', content: 'Decided to use React', category: 'project', importance: 0.7 },
      ];
      mocks.chatAndParseJsonArray.mockResolvedValue(llmMemories);

      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'I work at Acme Corp and we decided to use React' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any, 'test-api-key');
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('semantic');
      expect(result[0].content).toBe('User works at Acme Corp');
      expect(result[1].type).toBe('episode');
    });

    it('filters out invalid memories from LLM response', async () => {
      const mockLLMClient = { chat: vi.fn() };
      mocks.createLLMClient.mockReturnValue(mockLLMClient);

      const llmMemories = [
        { type: 'semantic', content: 'Valid memory', importance: 0.8 },
        { type: 'invalid_type', content: 'Bad type', importance: 0.5 },
        { type: 'episode', content: '', importance: 0.7 }, // empty content
        { type: 'procedural', content: 'Missing importance' }, // no importance
      ];
      mocks.chatAndParseJsonArray.mockResolvedValue(llmMemories);

      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'some message content here' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any, 'test-api-key');
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Valid memory');
    });

    it('falls back to pattern matching when LLM throws', async () => {
      const mockLLMClient = { chat: vi.fn() };
      mocks.createLLMClient.mockReturnValue(mockLLMClient);
      mocks.chatAndParseJsonArray.mockRejectedValue(new Error('LLM API error'));

      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'remember this: my preferred language is TypeScript' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any, 'test-api-key');
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      // Should fall back to pattern matching and find the "remember" pattern
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].type).toBe('semantic');
      expect(result[0].importance).toBe(0.9);
    });

    it('returns empty when LLM returns null', async () => {
      const mockLLMClient = { chat: vi.fn() };
      mocks.createLLMClient.mockReturnValue(mockLLMClient);
      mocks.chatAndParseJsonArray.mockResolvedValue(null);

      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'Hello, how are you?' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any, 'test-api-key');
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result).toEqual([]);
    });
  });

  describe('processThread', () => {
    it('combines extraction and saving, returning counts', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'remember this: my project uses Next.js' },
        { role: 'user', content: 'We decided to use PostgreSQL for the database' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.processThread('space-1', 'thread-1', 'user-1');

      expect(result.extracted).toBeGreaterThan(0);
      expect(result.saved).toBe(result.extracted);
    });

    it('returns zero counts for empty thread', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.processThread('space-1', 'thread-1', 'user-1');

      expect(result).toEqual({ extracted: 0, saved: 0 });
    });

    it('reports partial saves when some fail', async () => {
      const allMock = vi.fn().mockResolvedValue([
        { role: 'user', content: 'remember this: first important fact about the project' },
        { role: 'user', content: 'We decided to use a microservices architecture' },
      ]);
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        all: allMock,
      };
      const insertMock = vi.fn()
        .mockReturnValueOnce({
          values: vi.fn().mockRejectedValue(new Error('DB error')),
        })
        .mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        });
      const drizzle = {
        select: vi.fn(() => selectChain),
        insert: insertMock,
        _: { all: allMock },
      };
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.processThread('space-1', 'thread-1', 'user-1');

      expect(result.extracted).toBeGreaterThan(0);
      // saved should be less than extracted since the first insert fails
      expect(result.saved).toBeLessThan(result.extracted);
    });
  });

  describe('cleanMatch behavior', () => {
    it('strips "remember this" pattern from content', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'remember this: the database password is stored in vault' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result.length).toBe(1);
      // Content should have "remember this" stripped, leaving the actual info
      expect(result[0].content).not.toMatch(/remember this/i);
      expect(result[0].content).toContain('database password is stored in vault');
    });

    it('returns null when cleaned content is too short (below minCleanedLength)', async () => {
      const drizzle = createDrizzleMock();
      // "remember this: hi" -> after stripping "remember this" and trimming, "hi" is 2 chars
      // minCleanedLength for REMEMBER_PATTERNS rule is 10
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'remember this: hi' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      // Should not extract because cleaned content is too short
      expect(result).toEqual([]);
    });

    it('strips leading colons and whitespace after pattern removal', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'remember this:   the API endpoint is /v2/users' },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result.length).toBe(1);
      // Should not start with colon or extra spaces
      expect(result[0].content).not.toMatch(/^[:\s]/);
      expect(result[0].content).toContain('API endpoint is /v2/users');
    });
  });

  describe('maxContentLength check in matchPatternRule', () => {
    it('skips extraction when content exceeds maxContentLength for fact patterns', async () => {
      // FACT_PATTERNS have maxContentLength: 200
      const drizzle = createDrizzleMock();
      const longContent = 'My company is ' + 'x'.repeat(200);
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: longContent },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      // Content is >= 200 chars, so fact pattern should not match
      expect(result.filter(m => m.category === 'fact')).toEqual([]);
    });

    it('skips extraction when content exceeds maxContentLength for decision patterns', async () => {
      // DECISION_PATTERNS have maxContentLength: 500
      const drizzle = createDrizzleMock();
      const longContent = 'We decided to ' + 'x'.repeat(500);
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: longContent },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      // Content is >= 500 chars, so decision pattern should not match
      expect(result.filter(m => m.category === 'decision')).toEqual([]);
    });

    it('skips extraction when content exceeds maxContentLength for procedure patterns', async () => {
      // PROCEDURE_PATTERNS have maxContentLength: 300
      const drizzle = createDrizzleMock();
      const longContent = 'I always ' + 'x'.repeat(300);
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: longContent },
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      // Content is >= 300 chars, so procedure pattern should not match
      expect(result.filter(m => m.category === 'preference')).toEqual([]);
    });

    it('extracts when content is within maxContentLength', async () => {
      const drizzle = createDrizzleMock();
      drizzle._.all.mockResolvedValue([
        { role: 'user', content: 'My company is Acme Corp' }, // well under 200
      ]);
      mocks.getDb.mockReturnValue(drizzle);

      const extractor = new MemoryExtractor({} as any);
      const result = await extractor.extractFromThread('space-1', 'thread-1', 'user-1');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].category).toBe('fact');
    });
  });
});
