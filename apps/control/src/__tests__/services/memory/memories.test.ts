import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn(),
  now: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  generateId: mocks.generateId,
  now: mocks.now,
}));

import { MEMORY_TYPES } from '@/services/memory/memories';

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

describe('MEMORY_TYPES constant', () => {
  it('includes the expected memory types', () => {
    expect(MEMORY_TYPES).toContain('episode');
    expect(MEMORY_TYPES).toContain('semantic');
    expect(MEMORY_TYPES).toContain('procedural');
    expect(MEMORY_TYPES).toHaveLength(3);
  });
});

describe('listMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now.mockReturnValue('2026-01-01T00:00:00.000Z');
  });

  it('returns mapped memories from the database', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValue([
      {
        id: 'm-1',
        accountId: 'space-1',
        authorAccountId: 'user-1',
        threadId: 'thread-1',
        type: 'semantic',
        category: 'fact',
        content: 'User works in fintech',
        summary: null,
        importance: 0.8,
        tags: null,
        occurredAt: '2026-01-01T00:00:00.000Z',
        expiresAt: null,
        lastAccessedAt: null,
        accessCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const { listMemories } = await import('@/services/memory/memories');
    const result = await listMemories({} as D1Database, 'space-1', {});

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m-1');
    expect(result[0].space_id).toBe('space-1');
    expect(result[0].user_id).toBe('user-1');
    expect(result[0].type).toBe('semantic');
    expect(result[0].category).toBe('fact');
    expect(result[0].content).toBe('User works in fintech');
    expect(result[0].importance).toBe(0.8);
  });

  it('defaults importance to 0.5 when null', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValue([
      {
        id: 'm-1',
        accountId: 'space-1',
        authorAccountId: null,
        threadId: null,
        type: 'semantic',
        category: null,
        content: 'test',
        summary: null,
        importance: null,
        tags: null,
        occurredAt: null,
        expiresAt: null,
        lastAccessedAt: null,
        accessCount: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const { listMemories } = await import('@/services/memory/memories');
    const result = await listMemories({} as D1Database, 'space-1', {});

    expect(result[0].importance).toBe(0.5);
    expect(result[0].access_count).toBe(0);
  });

  it('defaults type to semantic for unknown types', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValue([
      {
        id: 'm-1',
        accountId: 'space-1',
        authorAccountId: null,
        threadId: null,
        type: 'unknown_type',
        category: null,
        content: 'test',
        summary: null,
        importance: 0.5,
        tags: null,
        occurredAt: null,
        expiresAt: null,
        lastAccessedAt: null,
        accessCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const { listMemories } = await import('@/services/memory/memories');
    const result = await listMemories({} as D1Database, 'space-1', {});

    expect(result[0].type).toBe('semantic');
  });
});

describe('createMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateId.mockReturnValue('new-mem-id');
    mocks.now.mockReturnValue('2026-01-01T00:00:00.000Z');
  });

  it('inserts a new memory and retrieves it', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue({
      id: 'new-mem-id',
      accountId: 'space-1',
      authorAccountId: 'user-1',
      threadId: null,
      type: 'semantic',
      category: 'project',
      content: 'Using React for frontend',
      summary: null,
      importance: 0.8,
      tags: '["react","frontend"]',
      occurredAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
      lastAccessedAt: null,
      accessCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const { createMemory } = await import('@/services/memory/memories');
    const result = await createMemory({} as D1Database, {
      spaceId: 'space-1',
      userId: 'user-1',
      type: 'semantic',
      content: 'Using React for frontend',
      category: 'project',
      importance: 0.8,
      tags: ['react', 'frontend'],
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe('new-mem-id');
    expect(result?.type).toBe('semantic');
    expect(result?.content).toBe('Using React for frontend');
  });
});

describe('bumpMemoryAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now.mockReturnValue('2026-01-01T00:00:00.000Z');
  });

  it('does nothing for empty array', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    const { bumpMemoryAccess } = await import('@/services/memory/memories');
    await bumpMemoryAccess({} as D1Database, []);

    expect(drizzle.update).not.toHaveBeenCalled();
  });

  it('updates access count and timestamp for given ids', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    const { bumpMemoryAccess } = await import('@/services/memory/memories');
    await bumpMemoryAccess({} as D1Database, ['m-1', 'm-2']);

    expect(drizzle.update).toHaveBeenCalled();
  });
});

describe('deleteMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a memory by id', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    const { deleteMemory } = await import('@/services/memory/memories');
    await deleteMemory({} as D1Database, 'm-1');

    expect(drizzle.delete).toHaveBeenCalled();
  });
});

describe('createReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateId.mockReturnValue('rem-id');
    mocks.now.mockReturnValue('2026-01-01T00:00:00.000Z');
  });

  it('creates a reminder and returns it', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue({
      id: 'rem-id',
      accountId: 'space-1',
      ownerAccountId: 'user-1',
      content: 'Follow up on PR',
      context: null,
      triggerType: 'time',
      triggerValue: '2026-02-01T00:00:00.000Z',
      status: 'pending',
      triggeredAt: null,
      priority: 'normal',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const { createReminder } = await import('@/services/memory/memories');
    const result = await createReminder({} as D1Database, {
      spaceId: 'space-1',
      userId: 'user-1',
      content: 'Follow up on PR',
      triggerType: 'time',
      triggerValue: '2026-02-01T00:00:00.000Z',
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe('rem-id');
    expect(result?.content).toBe('Follow up on PR');
    expect(result?.trigger_type).toBe('time');
    expect(result?.status).toBe('pending');
    expect(result?.priority).toBe('normal');
  });
});

describe('triggerReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now.mockReturnValue('2026-01-15T00:00:00.000Z');
  });

  it('sets status to triggered and updates triggeredAt', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue({
      id: 'rem-1',
      accountId: 'space-1',
      ownerAccountId: 'user-1',
      content: 'Reminder',
      context: null,
      triggerType: 'time',
      triggerValue: null,
      status: 'triggered',
      triggeredAt: '2026-01-15T00:00:00.000Z',
      priority: 'high',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-15T00:00:00.000Z',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const { triggerReminder } = await import('@/services/memory/memories');
    const result = await triggerReminder({} as D1Database, 'rem-1');

    expect(result).not.toBeNull();
    expect(result?.status).toBe('triggered');
    expect(result?.triggered_at).toBe('2026-01-15T00:00:00.000Z');
  });
});
