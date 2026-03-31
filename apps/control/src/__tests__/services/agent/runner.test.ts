import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import type { Env } from '@/types';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  queryRelevantThreadMessages: ((..._args: any[]) => undefined) as any,
  buildThreadContextSystemMessage: ((..._args: any[]) => undefined) as any,
  readMessageFromR2: ((..._args: any[]) => undefined) as any,
  getDelegationPacketFromRunInput: ((..._args: any[]) => undefined) as any,
  buildDelegationSystemMessage: ((..._args: any[]) => undefined) as any,
  buildDelegationUserMessage: ((..._args: any[]) => undefined) as any,
  buildTerminalPayload: ((..._args: any[]) => undefined) as any,
  buildRunNotifierEmitRequest: ((..._args: any[]) => undefined) as any,
  getRunNotifierStub: ((..._args: any[]) => undefined) as any,
  buildRunNotifierEmitPayload: ((..._args: any[]) => undefined) as any,
  logError: ((..._args: any[]) => undefined) as any,
  logWarn: ((..._args: any[]) => undefined) as any,
  logInfo: ((..._args: any[]) => undefined) as any,
  safeJsonParseOrDefault: ((..._args: any[]) => undefined) as any,
  resolveContextWindow: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/thread-context'
// [Deno] vi.mock removed - manually stub imports from '@/services/offload/messages'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/delegation'
// [Deno] vi.mock removed - manually stub imports from '@/services/run-notifier'
// [Deno] vi.mock removed - manually stub imports from '@/utils/logger'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/model-catalog'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/graph-runner'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/runner-config'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/prompts'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/prompt-budget'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/session-closer'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/skills'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/simple-loop'
// [Deno] vi.mock removed - manually stub imports from '@/services/memory-graph/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/remote-tool-executor'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/execute-run'
import {
  isValidToolCallsArray,
  updateRunStatusImpl,
  buildConversationHistory,
} from '@/services/agent/runner';


  Deno.test('isValidToolCallsArray - returns true for valid tool calls', () => {
  assertEquals(isValidToolCallsArray([
      { id: 'tc1', name: 'file_read', arguments: { path: '/test' } },
    ]), true);
})
  Deno.test('isValidToolCallsArray - returns true for empty array', () => {
  assertEquals(isValidToolCallsArray([]), true);
})
  Deno.test('isValidToolCallsArray - returns false for non-array', () => {
  assertEquals(isValidToolCallsArray('not-array'), false);
    assertEquals(isValidToolCallsArray(null), false);
    assertEquals(isValidToolCallsArray(undefined), false);
})
  Deno.test('isValidToolCallsArray - returns false when items lack required fields', () => {
  assertEquals(isValidToolCallsArray([{ id: 'tc1' }]), false);
    assertEquals(isValidToolCallsArray([{ id: 'tc1', name: 'tool' }]), false);
    assertEquals(isValidToolCallsArray([{ id: 'tc1', name: 'tool', arguments: null }]), false);
})
  Deno.test('isValidToolCallsArray - returns false for non-object items', () => {
  assertEquals(isValidToolCallsArray([null]), false);
    assertEquals(isValidToolCallsArray(['string']), false);
})

  Deno.test('EventEmitterState default values - has correct initial values when constructed inline', () => {
  const state = {
      eventSequence: 0,
      pendingEventEmissions: 0,
      eventEmissionErrors: [] as unknown[],
    };
    assertEquals(state.eventSequence, 0);
    assertEquals(state.pendingEventEmissions, 0);
    assertEquals(state.eventEmissionErrors, []);
})

  Deno.test('updateRunStatusImpl - updates run to running status with startedAt', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const updateSet = (() => ({ where: (async () => undefined) }));
    const mockDb = { update: (() => ({ set: updateSet })) };
    mocks.getDb = (() => mockDb) as any;

    await updateRunStatusImpl(
      {} as any,
      'run-1',
      { inputTokens: 10, outputTokens: 5 },
      'running',
    );

    assertSpyCallArgs(updateSet, 0, [
      ({
        status: 'running',
        startedAt: /* expect.any(String) */ {} as any,
        usage: JSON.stringify({ inputTokens: 10, outputTokens: 5 }),
      }),
    ]);
})
  Deno.test('updateRunStatusImpl - updates run to completed status with completedAt', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const updateSet = (() => ({ where: (async () => undefined) }));
    const mockDb = { update: (() => ({ set: updateSet })) };
    mocks.getDb = (() => mockDb) as any;

    await updateRunStatusImpl(
      {} as any,
      'run-1',
      { inputTokens: 100, outputTokens: 50 },
      'completed',
      'output data',
    );

    assertSpyCallArgs(updateSet, 0, [
      ({
        status: 'completed',
        completedAt: /* expect.any(String) */ {} as any,
        output: 'output data',
      }),
    ]);
})
  Deno.test('updateRunStatusImpl - updates run to failed status with error', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const updateSet = (() => ({ where: (async () => undefined) }));
    const mockDb = { update: (() => ({ set: updateSet })) };
    mocks.getDb = (() => mockDb) as any;

    await updateRunStatusImpl(
      {} as any,
      'run-1',
      { inputTokens: 0, outputTokens: 0 },
      'failed',
      undefined,
      'Error message',
    );

    assertSpyCallArgs(updateSet, 0, [
      ({
        status: 'failed',
        completedAt: /* expect.any(String) */ {} as any,
        error: 'Error message',
      }),
    ]);
})
  Deno.test('updateRunStatusImpl - uses simple id-only WHERE for cancelled status (no != cancelled guard)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockWhere = (async () => undefined);
    const updateSet = (() => ({ where: mockWhere }));
    const mockDb = { update: (() => ({ set: updateSet })) };
    mocks.getDb = (() => mockDb) as any;

    await updateRunStatusImpl(
      {} as any,
      'run-1',
      { inputTokens: 0, outputTokens: 0 },
      'cancelled',
    );

    assertSpyCallArgs(updateSet, 0, [
      ({
        status: 'cancelled',
        completedAt: /* expect.any(String) */ {} as any,
      }),
    ]);

    // For cancelled: condition = eq(runs.id, runId) — flat queryChunks with just `= `
    // For non-cancelled: condition = and(eq(...), sql`... != 'cancelled'`) — nested with `( ... and ... )`
    const whereArg = mockWhere.calls[0][0];
    assert(whereArg !== undefined);
    assert(whereArg.queryChunks !== undefined);

    // Serialise queryChunks recursively to find all string values
    function collectValues(chunks: unknown[]): string[] {
      const values: string[] = [];
      for (const c of chunks) {
        if (c && typeof c === 'object' && 'value' in (c as Record<string, unknown>)) {
          values.push(...((c as Record<string, unknown>).value as string[]));
        } else if (c && typeof c === 'object' && 'queryChunks' in (c as Record<string, unknown>)) {
          values.push(...collectValues((c as Record<string, unknown>).queryChunks as unknown[]));
        }
      }
      return values;
    }
    const allValues = collectValues(whereArg.queryChunks);
    const joined = allValues.join('');
    // The cancelled branch should NOT contain 'and' or "!= 'cancelled'" — just eq()
    assert(!(joined).includes(' and '));
    assert(!(joined).includes("!= 'cancelled'"));
})
  Deno.test('updateRunStatusImpl - includes != cancelled guard in WHERE for non-cancelled statuses', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockWhere = (async () => undefined);
    const updateSet = (() => ({ where: mockWhere }));
    const mockDb = { update: (() => ({ set: updateSet })) };
    mocks.getDb = (() => mockDb) as any;

    await updateRunStatusImpl(
      {} as any,
      'run-1',
      { inputTokens: 0, outputTokens: 0 },
      'completed',
      'done',
    );

    const whereArg = mockWhere.calls[0][0];
    assert(whereArg !== undefined);
    assert(whereArg.queryChunks !== undefined);

    function collectValues(chunks: unknown[]): string[] {
      const values: string[] = [];
      for (const c of chunks) {
        if (c && typeof c === 'object' && 'value' in (c as Record<string, unknown>)) {
          values.push(...((c as Record<string, unknown>).value as string[]));
        } else if (c && typeof c === 'object' && 'queryChunks' in (c as Record<string, unknown>)) {
          values.push(...collectValues((c as Record<string, unknown>).queryChunks as unknown[]));
        }
      }
      return values;
    }
    const allValues = collectValues(whereArg.queryChunks);
    const joined = allValues.join('');
    // Non-cancelled statuses wrap with and() and include the != 'cancelled' guard
    assertStringIncludes(joined, ' and ');
    assertStringIncludes(joined, "!= 'cancelled'");
})

  function makeDbMock(selectGetResults: unknown[], selectAllResults: unknown[]) {
    let getIndex = 0;
    let allIndex = 0;
    const chain = () => {
      const c: Record<string, unknown> = {};
      c.from = (() => c);
      c.where = (() => c);
      c.orderBy = (() => c);
      c.limit = (() => c);
      c.all = async () => selectAllResults[allIndex++] ?? [];
      c.get = async () => selectGetResults[getIndex++] ?? null;
      return c;
    };
    return {
      select: () => chain(),
    };
  }
  Deno.test('buildConversationHistory - builds conversation from messages in the thread', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.queryRelevantThreadMessages = (async () => []) as any;
    mocks.buildThreadContextSystemMessage = (() => null) as any;
    mocks.getDelegationPacketFromRunInput = (() => null) as any;
    mocks.safeJsonParseOrDefault = (() => ({})) as any;
    mocks.resolveContextWindow = (() => 50) as any;
  mocks.getDb = (() => makeDbMock(
      [
        { summary: 'Thread summary', keyPoints: '["point1"]' },
        null, // run row (no parent)
      ],
      [
        [
          { id: 'msg1', role: 'user', content: 'Hello', r2Key: null, toolCalls: null, toolCallId: null, metadata: '{}', sequence: 0 },
          { id: 'msg2', role: 'assistant', content: 'Hi there!', r2Key: null, toolCalls: null, toolCallId: null, metadata: '{}', sequence: 1 },
        ],
      ],
    )) as any;

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'thread-1',
      runId: 'run-1',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-mini',
    });

    assert(history.length >= 2);
    assert(history.find((m) => m.content === 'Hello'));
    assert(history.find((m) => m.content === 'Hi there!'));
})
  Deno.test('buildConversationHistory - builds delegated child context from delegation packet', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.queryRelevantThreadMessages = (async () => []) as any;
    mocks.buildThreadContextSystemMessage = (() => null) as any;
    mocks.getDelegationPacketFromRunInput = (() => null) as any;
    mocks.safeJsonParseOrDefault = (() => ({})) as any;
    mocks.resolveContextWindow = (() => 50) as any;
  mocks.getDb = (() => makeDbMock(
      [
        { summary: null, keyPoints: '[]' },
        {
          parentRunId: 'parent-run',
          input: JSON.stringify({
            delegation: {
              task: 'Implement the fix',
              goal: 'Fix the bug',
              deliverable: 'Code changes',
              constraints: [],
              context: [],
              acceptance_criteria: [],
              product_hint: 'takos',
              locale: 'en',
              parent_run_id: 'parent-run',
              parent_thread_id: 'thread-1',
              root_thread_id: 'thread-1',
              thread_summary: 'Bug fix',
              thread_key_points: [],
            },
          }),
        },
      ],
      [[]],
    )) as any;

    mocks.getDelegationPacketFromRunInput = (() => ({
      task: 'Implement the fix',
      goal: 'Fix the bug',
      product_hint: 'takos',
      parent_run_id: 'parent-run',
      parent_thread_id: 'thread-1',
      root_thread_id: 'thread-1',
      constraints: [],
      context: [],
      acceptance_criteria: [],
      locale: 'en',
      deliverable: 'Code changes',
      thread_summary: 'Bug fix',
      thread_key_points: [],
    })) as any;

    mocks.buildDelegationSystemMessage = (() => ({
      role: 'system',
      content: 'Delegated execution context:\nGoal: Fix the bug',
    })) as any;

    mocks.buildDelegationUserMessage = (() => ({
      role: 'user',
      content: '[Delegated sub-task from parent agent (run: parent-run)]\n\nImplement the fix',
    })) as any;

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'child-thread-1',
      runId: 'child-run',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-mini',
    });

    assertStringIncludes(history[0]?.content, 'Delegated execution context');
    assertEquals(history.some((m) => m.content.includes('Implement the fix')), true);
})
  Deno.test('buildConversationHistory - parses tool_calls from stored messages', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.queryRelevantThreadMessages = (async () => []) as any;
    mocks.buildThreadContextSystemMessage = (() => null) as any;
    mocks.getDelegationPacketFromRunInput = (() => null) as any;
    mocks.safeJsonParseOrDefault = (() => ({})) as any;
    mocks.resolveContextWindow = (() => 50) as any;
  const toolCallsJson = JSON.stringify([
      { id: 'tc1', name: 'file_read', arguments: { path: '/test' } },
    ]);

    mocks.getDb = (() => makeDbMock(
      [
        { summary: null, keyPoints: '[]' },
        null,
      ],
      [
        [
          { id: 'msg1', role: 'assistant', content: 'calling tool', r2Key: null, toolCalls: toolCallsJson, toolCallId: null, metadata: '{}', sequence: 0 },
        ],
      ],
    )) as any;

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'thread-1',
      runId: 'run-1',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-nano',
    });

    const assistantMsg = history.find((m) => m.role === 'assistant');
    assert(assistantMsg?.tool_calls !== undefined);
    assertEquals(assistantMsg?.tool_calls?.[0].name, 'file_read');
})
  Deno.test('buildConversationHistory - handles malformed tool_calls JSON gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.queryRelevantThreadMessages = (async () => []) as any;
    mocks.buildThreadContextSystemMessage = (() => null) as any;
    mocks.getDelegationPacketFromRunInput = (() => null) as any;
    mocks.safeJsonParseOrDefault = (() => ({})) as any;
    mocks.resolveContextWindow = (() => 50) as any;
  mocks.getDb = (() => makeDbMock(
      [
        { summary: null, keyPoints: '[]' },
        null,
      ],
      [
        [
          { id: 'msg1', role: 'assistant', content: 'msg', r2Key: null, toolCalls: 'not-json', toolCallId: null, metadata: '{}', sequence: 0 },
        ],
      ],
    )) as any;

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'thread-1',
      runId: 'run-1',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-nano',
    });

    const msg = history.find((m) => m.role === 'assistant');
    assertEquals(msg?.tool_calls, undefined);
    assert(mocks.logWarn.calls.length > 0);
})
  Deno.test('buildConversationHistory - prepends thread context when available', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.queryRelevantThreadMessages = (async () => []) as any;
    mocks.buildThreadContextSystemMessage = (() => null) as any;
    mocks.getDelegationPacketFromRunInput = (() => null) as any;
    mocks.safeJsonParseOrDefault = (() => ({})) as any;
    mocks.resolveContextWindow = (() => 50) as any;
  mocks.buildThreadContextSystemMessage = (() => ({
      role: 'system',
      content: '[THREAD_CONTEXT] Test context [/THREAD_CONTEXT]',
    })) as any;

    mocks.getDb = (() => makeDbMock(
      [
        { summary: 'Summary', keyPoints: '["point"]' },
        null,
      ],
      [
        [
          { id: 'msg1', role: 'user', content: 'Hello', r2Key: null, toolCalls: null, toolCallId: null, metadata: '{}', sequence: 0 },
        ],
      ],
    )) as any;

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'thread-1',
      runId: 'run-1',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-nano',
    });

    assertEquals(history[0]?.role, 'system');
    assertStringIncludes(history[0]?.content, 'THREAD_CONTEXT');
})