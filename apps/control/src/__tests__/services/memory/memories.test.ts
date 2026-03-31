import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: ((..._args: any[]) => undefined) as any,
  now: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import { MEMORY_TYPES } from '@/services/memory/memories';

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


  Deno.test('MEMORY_TYPES constant - includes the expected memory types', () => {
  assertStringIncludes(MEMORY_TYPES, 'episode');
    assertStringIncludes(MEMORY_TYPES, 'semantic');
    assertStringIncludes(MEMORY_TYPES, 'procedural');
    assertEquals(MEMORY_TYPES.length, 3);
})

  Deno.test('listMemories - returns mapped memories from the database', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
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
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const { listMemories } = await import('@/services/memory/memories');
    const result = await listMemories({} as D1Database, 'space-1', {});

    assertEquals(result.length, 1);
    assertEquals(result[0].id, 'm-1');
    assertEquals(result[0].space_id, 'space-1');
    assertEquals(result[0].user_id, 'user-1');
    assertEquals(result[0].type, 'semantic');
    assertEquals(result[0].category, 'fact');
    assertEquals(result[0].content, 'User works in fintech');
    assertEquals(result[0].importance, 0.8);
})
  Deno.test('listMemories - defaults importance to 0.5 when null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
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
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const { listMemories } = await import('@/services/memory/memories');
    const result = await listMemories({} as D1Database, 'space-1', {});

    assertEquals(result[0].importance, 0.5);
    assertEquals(result[0].access_count, 0);
})
  Deno.test('listMemories - defaults type to semantic for unknown types', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
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
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const { listMemories } = await import('@/services/memory/memories');
    const result = await listMemories({} as D1Database, 'space-1', {});

    assertEquals(result[0].type, 'semantic');
})

  Deno.test('createMemory - inserts a new memory and retrieves it', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-mem-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
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
    })) as any;
    mocks.getDb = (() => drizzle) as any;

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

    assertNotEquals(result, null);
    assertEquals(result?.id, 'new-mem-id');
    assertEquals(result?.type, 'semantic');
    assertEquals(result?.content, 'Using React for frontend');
})

  Deno.test('bumpMemoryAccess - does nothing for empty array', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    const { bumpMemoryAccess } = await import('@/services/memory/memories');
    await bumpMemoryAccess({} as D1Database, []);

    assertSpyCalls(drizzle.update, 0);
})
  Deno.test('bumpMemoryAccess - updates access count and timestamp for given ids', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    const { bumpMemoryAccess } = await import('@/services/memory/memories');
    await bumpMemoryAccess({} as D1Database, ['m-1', 'm-2']);

    assert(drizzle.update.calls.length > 0);
})

  Deno.test('deleteMemory - deletes a memory by id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    const { deleteMemory } = await import('@/services/memory/memories');
    await deleteMemory({} as D1Database, 'm-1');

    assert(drizzle.delete.calls.length > 0);
})

  Deno.test('createReminder - creates a reminder and returns it', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'rem-id') as any;
    mocks.now = (() => '2026-01-01T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
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
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const { createReminder } = await import('@/services/memory/memories');
    const result = await createReminder({} as D1Database, {
      spaceId: 'space-1',
      userId: 'user-1',
      content: 'Follow up on PR',
      triggerType: 'time',
      triggerValue: '2026-02-01T00:00:00.000Z',
    });

    assertNotEquals(result, null);
    assertEquals(result?.id, 'rem-id');
    assertEquals(result?.content, 'Follow up on PR');
    assertEquals(result?.trigger_type, 'time');
    assertEquals(result?.status, 'pending');
    assertEquals(result?.priority, 'normal');
})

  Deno.test('triggerReminder - sets status to triggered and updates triggeredAt', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-01-15T00:00:00.000Z') as any;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
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
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const { triggerReminder } = await import('@/services/memory/memories');
    const result = await triggerReminder({} as D1Database, 'rem-1');

    assertNotEquals(result, null);
    assertEquals(result?.status, 'triggered');
    assertEquals(result?.triggered_at, '2026-01-15T00:00:00.000Z');
})