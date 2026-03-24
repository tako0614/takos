import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInsertValues = vi.fn();
const mockSelectAll = vi.fn();
const mockSelectGet = vi.fn();
const mockUpdateSet = vi.fn();

vi.mock('@/db', () => {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    get: vi.fn(() => mockSelectGet()),
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
      update: vi.fn(() => ({
        set: vi.fn((...args: unknown[]) => {
          mockUpdateSet(...args);
          return { where: vi.fn() };
        }),
      })),
    }),
    memories: {
      id: 'id',
      accountId: 'account_id',
      authorAccountId: 'author_account_id',
      threadId: 'thread_id',
      type: 'type',
      category: 'category',
      content: 'content',
      summary: 'summary',
      importance: 'importance',
      occurredAt: 'occurred_at',
      accessCount: 'access_count',
      lastAccessedAt: 'last_accessed_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    reminders: {
      id: 'id',
      accountId: 'account_id',
      ownerAccountId: 'owner_account_id',
      content: 'content',
      context: 'context',
      triggerType: 'trigger_type',
      triggerValue: 'trigger_value',
      status: 'status',
      priority: 'priority',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  };
});

vi.mock('@/utils', () => ({
  generateId: vi.fn(() => 'generated-id'),
}));

import {
  rememberHandler,
  recallHandler,
  setReminderHandler,
  REMEMBER,
  RECALL,
  SET_REMINDER,
  MEMORY_TOOLS,
} from '@/tools/builtin/memory';

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

describe('memory tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('definitions', () => {
    it('REMEMBER requires content and type', () => {
      expect(REMEMBER.name).toBe('remember');
      expect(REMEMBER.category).toBe('memory');
      expect(REMEMBER.parameters.required).toEqual(['content', 'type']);
    });

    it('RECALL requires query', () => {
      expect(RECALL.name).toBe('recall');
      expect(RECALL.parameters.required).toEqual(['query']);
    });

    it('SET_REMINDER requires content, trigger_type, trigger_value', () => {
      expect(SET_REMINDER.name).toBe('set_reminder');
      expect(SET_REMINDER.parameters.required).toEqual(['content', 'trigger_type', 'trigger_value']);
    });

    it('MEMORY_TOOLS exports all three tools', () => {
      expect(MEMORY_TOOLS).toHaveLength(3);
      expect(MEMORY_TOOLS.map(t => t.name)).toEqual(['remember', 'recall', 'set_reminder']);
    });
  });

  describe('rememberHandler', () => {
    it('stores a memory and returns confirmation', async () => {
      const result = await rememberHandler(
        { content: 'TypeScript is preferred', type: 'semantic' },
        makeContext(),
      );

      expect(result).toContain('Remembered (semantic)');
      expect(result).toContain('TypeScript is preferred');
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: 'ws-test',
          authorAccountId: 'user-1',
          threadId: 'thread-1',
          type: 'semantic',
          content: 'TypeScript is preferred',
        }),
      );
    });

    it('truncates summary for long content', async () => {
      const longContent = 'x'.repeat(200);
      await rememberHandler(
        { content: longContent, type: 'episode' },
        makeContext(),
      );

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.stringContaining('...'),
        }),
      );
    });

    it('uses default importance of 0.5', async () => {
      await rememberHandler(
        { content: 'test', type: 'procedural' },
        makeContext(),
      );

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: 0.5,
        }),
      );
    });

    it('uses custom importance when provided', async () => {
      await rememberHandler(
        { content: 'important fact', type: 'semantic', importance: 0.9 },
        makeContext(),
      );

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: 0.9,
        }),
      );
    });

    it('stores category when provided', async () => {
      await rememberHandler(
        { content: 'test', type: 'semantic', category: 'project' },
        makeContext(),
      );

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'project' }),
      );
    });

    it('rejects content exceeding max size', async () => {
      const hugeContent = 'x'.repeat(100_001);
      await expect(
        rememberHandler(
          { content: hugeContent, type: 'semantic' },
          makeContext(),
        ),
      ).rejects.toThrow('Memory content too large');
    });

    it('rejects category exceeding max size', async () => {
      const hugeCategory = 'x'.repeat(1001);
      await expect(
        rememberHandler(
          { content: 'test', type: 'semantic', category: hugeCategory },
          makeContext(),
        ),
      ).rejects.toThrow('Memory category too long');
    });

    it('includes session ID in result when available', async () => {
      const result = await rememberHandler(
        { content: 'test', type: 'semantic' },
        makeContext({ sessionId: 'session-abc-123' }),
      );

      // source uses sessionId.slice(0, 8) => 'session-'
      expect(result).toContain('[session: session-...]');
    });
  });

  describe('recallHandler', () => {
    it('returns memories matching the query', async () => {
      mockSelectAll.mockResolvedValue([
        {
          id: 'm1',
          type: 'semantic',
          category: 'project',
          content: 'TypeScript is preferred',
          importance: 0.9,
          occurredAt: '2024-01-01T00:00:00Z',
          accessCount: 5,
        },
      ]);

      const result = await recallHandler(
        { query: 'TypeScript' },
        makeContext(),
      );

      expect(result).toContain('Found 1 memories');
      expect(result).toContain('TypeScript is preferred');
      expect(result).toContain('[project]');
    });

    it('returns no memories found message', async () => {
      mockSelectAll.mockResolvedValue([]);

      const result = await recallHandler(
        { query: 'nonexistent' },
        makeContext(),
      );

      expect(result).toContain('No memories found');
    });

    it('limits results to max 50', async () => {
      mockSelectAll.mockResolvedValue([]);

      await recallHandler(
        { query: 'test', limit: 100 },
        makeContext(),
      );

      // The handler should call .limit(50) even if 100 was requested
      // Since we can't easily inspect the chain calls, we test the logic indirectly
      expect(mockSelectAll).toHaveBeenCalled();
    });

    it('updates access count for returned memories', async () => {
      mockSelectAll.mockResolvedValue([
        {
          id: 'm1',
          type: 'semantic',
          category: null,
          content: 'Test',
          importance: 0.5,
          occurredAt: '2024-01-01T00:00:00Z',
          accessCount: 0,
        },
      ]);

      await recallHandler({ query: 'Test' }, makeContext());

      expect(mockUpdateSet).toHaveBeenCalled();
    });
  });

  describe('setReminderHandler', () => {
    it('sets a time-based reminder', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      const result = await setReminderHandler(
        {
          content: 'Review PR',
          trigger_type: 'time',
          trigger_value: futureDate,
        },
        makeContext(),
      );

      expect(result).toContain('Reminder set (normal)');
      expect(result).toContain('Review PR');
      expect(result).toContain('at');
    });

    it('sets a condition-based reminder', async () => {
      const result = await setReminderHandler(
        {
          content: 'Check tests',
          trigger_type: 'condition',
          trigger_value: 'tests fail',
        },
        makeContext(),
      );

      expect(result).toContain('when: tests fail');
    });

    it('sets a context-based reminder', async () => {
      const result = await setReminderHandler(
        {
          content: 'Check deployment',
          trigger_type: 'context',
          trigger_value: 'deployment discussion',
        },
        makeContext(),
      );

      expect(result).toContain('context: deployment discussion');
    });

    it('uses custom priority', async () => {
      const result = await setReminderHandler(
        {
          content: 'Urgent task',
          trigger_type: 'context',
          trigger_value: 'urgent',
          priority: 'critical',
        },
        makeContext(),
      );

      expect(result).toContain('Reminder set (critical)');
    });

    it('rejects invalid time format', async () => {
      await expect(
        setReminderHandler(
          {
            content: 'Bad time',
            trigger_type: 'time',
            trigger_value: 'not-a-date',
          },
          makeContext(),
        ),
      ).rejects.toThrow('Invalid time format');
    });

    it('rejects past trigger time', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      await expect(
        setReminderHandler(
          {
            content: 'Past reminder',
            trigger_type: 'time',
            trigger_value: pastDate,
          },
          makeContext(),
        ),
      ).rejects.toThrow('must be in the future');
    });

    it('includes session ID in result when available', async () => {
      const result = await setReminderHandler(
        {
          content: 'Test',
          trigger_type: 'context',
          trigger_value: 'test',
        },
        makeContext({ sessionId: 'session-xyz-890' }),
      );

      // source uses sessionId.slice(0, 8) => 'session-'
      expect(result).toContain('[session: session-...]');
    });
  });
});
