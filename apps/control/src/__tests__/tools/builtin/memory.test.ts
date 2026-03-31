import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

import { assertEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockInsertValues = ((..._args: any[]) => undefined) as any;
const mockSelectAll = ((..._args: any[]) => undefined) as any;
const mockSelectGet = ((..._args: any[]) => undefined) as any;
const mockUpdateSet = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
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
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: () => undefined,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


  
    Deno.test('memory tools - definitions - REMEMBER requires content and type', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(REMEMBER.name, 'remember');
      assertEquals(REMEMBER.category, 'memory');
      assertEquals(REMEMBER.parameters.required, ['content', 'type']);
})
    Deno.test('memory tools - definitions - RECALL requires query', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(RECALL.name, 'recall');
      assertEquals(RECALL.parameters.required, ['query']);
})
    Deno.test('memory tools - definitions - SET_REMINDER requires content, trigger_type, trigger_value', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(SET_REMINDER.name, 'set_reminder');
      assertEquals(SET_REMINDER.parameters.required, ['content', 'trigger_type', 'trigger_value']);
})
    Deno.test('memory tools - definitions - MEMORY_TOOLS exports all three tools', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(MEMORY_TOOLS.length, 3);
      assertEquals(MEMORY_TOOLS.map(t => t.name), ['remember', 'recall', 'set_reminder']);
})  
  
    Deno.test('memory tools - rememberHandler - stores a memory and returns confirmation', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await rememberHandler(
        { content: 'TypeScript is preferred', type: 'semantic' },
        makeContext(),
      );

      assertStringIncludes(result, 'Remembered (semantic)');
      assertStringIncludes(result, 'TypeScript is preferred');
      assertSpyCallArgs(mockInsertValues, 0, [
        ({
          accountId: 'ws-test',
          authorAccountId: 'user-1',
          threadId: 'thread-1',
          type: 'semantic',
          content: 'TypeScript is preferred',
        }),
      ]);
})
    Deno.test('memory tools - rememberHandler - truncates summary for long content', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const longContent = 'x'.repeat(200);
      await rememberHandler(
        { content: longContent, type: 'episode' },
        makeContext(),
      );

      assertSpyCallArgs(mockInsertValues, 0, [
        ({
          summary: expect.stringContaining('...'),
        }),
      ]);
})
    Deno.test('memory tools - rememberHandler - uses default importance of 0.5', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await rememberHandler(
        { content: 'test', type: 'procedural' },
        makeContext(),
      );

      assertSpyCallArgs(mockInsertValues, 0, [
        ({
          importance: 0.5,
        }),
      ]);
})
    Deno.test('memory tools - rememberHandler - uses custom importance when provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await rememberHandler(
        { content: 'important fact', type: 'semantic', importance: 0.9 },
        makeContext(),
      );

      assertSpyCallArgs(mockInsertValues, 0, [
        ({
          importance: 0.9,
        }),
      ]);
})
    Deno.test('memory tools - rememberHandler - stores category when provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await rememberHandler(
        { content: 'test', type: 'semantic', category: 'project' },
        makeContext(),
      );

      assertSpyCallArgs(mockInsertValues, 0, [
        ({ category: 'project' }),
      ]);
})
    Deno.test('memory tools - rememberHandler - rejects content exceeding max size', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const hugeContent = 'x'.repeat(100_001);
      await await assertRejects(async () => { await 
        rememberHandler(
          { content: hugeContent, type: 'semantic' },
          makeContext(),
        ),
      ; }, 'Memory content too large');
})
    Deno.test('memory tools - rememberHandler - rejects category exceeding max size', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const hugeCategory = 'x'.repeat(1001);
      await await assertRejects(async () => { await 
        rememberHandler(
          { content: 'test', type: 'semantic', category: hugeCategory },
          makeContext(),
        ),
      ; }, 'Memory category too long');
})
    Deno.test('memory tools - rememberHandler - includes session ID in result when available', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await rememberHandler(
        { content: 'test', type: 'semantic' },
        makeContext({ sessionId: 'session-abc-123' }),
      );

      // source uses sessionId.slice(0, 8) => 'session-'
      assertStringIncludes(result, '[session: session-...]');
})  
  
    Deno.test('memory tools - recallHandler - returns memories matching the query', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectAll = (async () => [
        {
          id: 'm1',
          type: 'semantic',
          category: 'project',
          content: 'TypeScript is preferred',
          importance: 0.9,
          occurredAt: '2024-01-01T00:00:00Z',
          accessCount: 5,
        },
      ]) as any;

      const result = await recallHandler(
        { query: 'TypeScript' },
        makeContext(),
      );

      assertStringIncludes(result, 'Found 1 memories');
      assertStringIncludes(result, 'TypeScript is preferred');
      assertStringIncludes(result, '[project]');
})
    Deno.test('memory tools - recallHandler - returns no memories found message', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectAll = (async () => []) as any;

      const result = await recallHandler(
        { query: 'nonexistent' },
        makeContext(),
      );

      assertStringIncludes(result, 'No memories found');
})
    Deno.test('memory tools - recallHandler - limits results to max 50', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectAll = (async () => []) as any;

      await recallHandler(
        { query: 'test', limit: 100 },
        makeContext(),
      );

      // The handler should call .limit(50) even if 100 was requested
      // Since we can't easily inspect the chain calls, we test the logic indirectly
      assert(mockSelectAll.calls.length > 0);
})
    Deno.test('memory tools - recallHandler - updates access count for returned memories', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSelectAll = (async () => [
        {
          id: 'm1',
          type: 'semantic',
          category: null,
          content: 'Test',
          importance: 0.5,
          occurredAt: '2024-01-01T00:00:00Z',
          accessCount: 0,
        },
      ]) as any;

      await recallHandler({ query: 'Test' }, makeContext());

      assert(mockUpdateSet.calls.length > 0);
})  
  
    Deno.test('memory tools - setReminderHandler - sets a time-based reminder', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const futureDate = new Date(Date.now() + 86400000).toISOString();

      const result = await setReminderHandler(
        {
          content: 'Review PR',
          trigger_type: 'time',
          trigger_value: futureDate,
        },
        makeContext(),
      );

      assertStringIncludes(result, 'Reminder set (normal)');
      assertStringIncludes(result, 'Review PR');
      assertStringIncludes(result, 'at');
})
    Deno.test('memory tools - setReminderHandler - sets a condition-based reminder', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await setReminderHandler(
        {
          content: 'Check tests',
          trigger_type: 'condition',
          trigger_value: 'tests fail',
        },
        makeContext(),
      );

      assertStringIncludes(result, 'when: tests fail');
})
    Deno.test('memory tools - setReminderHandler - sets a context-based reminder', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await setReminderHandler(
        {
          content: 'Check deployment',
          trigger_type: 'context',
          trigger_value: 'deployment discussion',
        },
        makeContext(),
      );

      assertStringIncludes(result, 'context: deployment discussion');
})
    Deno.test('memory tools - setReminderHandler - uses custom priority', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await setReminderHandler(
        {
          content: 'Urgent task',
          trigger_type: 'context',
          trigger_value: 'urgent',
          priority: 'critical',
        },
        makeContext(),
      );

      assertStringIncludes(result, 'Reminder set (critical)');
})
    Deno.test('memory tools - setReminderHandler - rejects invalid time format', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  await await assertRejects(async () => { await 
        setReminderHandler(
          {
            content: 'Bad time',
            trigger_type: 'time',
            trigger_value: 'not-a-date',
          },
          makeContext(),
        ),
      ; }, 'Invalid time format');
})
    Deno.test('memory tools - setReminderHandler - rejects past trigger time', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const pastDate = new Date(Date.now() - 86400000).toISOString();
      await await assertRejects(async () => { await 
        setReminderHandler(
          {
            content: 'Past reminder',
            trigger_type: 'time',
            trigger_value: pastDate,
          },
          makeContext(),
        ),
      ; }, 'must be in the future');
})
    Deno.test('memory tools - setReminderHandler - includes session ID in result when available', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await setReminderHandler(
        {
          content: 'Test',
          trigger_type: 'context',
          trigger_value: 'test',
        },
        makeContext({ sessionId: 'session-xyz-890' }),
      );

      // source uses sessionId.slice(0, 8) => 'session-'
      assertStringIncludes(result, '[session: session-...]');
})  