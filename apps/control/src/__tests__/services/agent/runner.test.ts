import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, R2Bucket } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  queryRelevantThreadMessages: vi.fn(),
  buildThreadContextSystemMessage: vi.fn(),
  readMessageFromR2: vi.fn(),
  getDelegationPacketFromRunInput: vi.fn(),
  buildDelegationSystemMessage: vi.fn(),
  buildDelegationUserMessage: vi.fn(),
  buildTerminalPayload: vi.fn(),
  buildRunNotifierEmitRequest: vi.fn(),
  getRunNotifierStub: vi.fn(),
  buildRunNotifierEmitPayload: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  safeJsonParseOrDefault: vi.fn(),
  getContextWindowForModel: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/agent/thread-context', () => ({
  queryRelevantThreadMessages: mocks.queryRelevantThreadMessages,
  buildThreadContextSystemMessage: mocks.buildThreadContextSystemMessage,
}));

vi.mock('@/services/offload/messages', () => ({
  readMessageFromR2: mocks.readMessageFromR2,
}));

vi.mock('@/services/agent/delegation', () => ({
  getDelegationPacketFromRunInput: mocks.getDelegationPacketFromRunInput,
  buildDelegationSystemMessage: mocks.buildDelegationSystemMessage,
  buildDelegationUserMessage: mocks.buildDelegationUserMessage,
}));

vi.mock('@/services/run-notifier', () => ({
  buildTerminalPayload: mocks.buildTerminalPayload,
  buildRunNotifierEmitRequest: mocks.buildRunNotifierEmitRequest,
  getRunNotifierStub: mocks.getRunNotifierStub,
  buildRunNotifierEmitPayload: mocks.buildRunNotifierEmitPayload,
}));

vi.mock('@/utils/logger', () => ({
  logDebug: vi.fn(),
  logError: mocks.logError,
  logWarn: mocks.logWarn,
  logInfo: mocks.logInfo,
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  safeJsonParse: vi.fn((v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } }),
  safeJsonParseOrDefault: vi.fn((v: unknown, d: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return d; } }),
}));

vi.mock('@/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils')>()),
  safeJsonParseOrDefault: mocks.safeJsonParseOrDefault,
}));

vi.mock('@/services/agent/model-catalog', () => ({
  DEFAULT_MODEL_ID: 'gpt-5.4-nano',
  getContextWindowForModel: mocks.getContextWindowForModel,
}));

vi.mock('@/services/agent/langgraph-runner', () => ({
  runLangGraphRunner: vi.fn(),
}));

vi.mock('@/services/agent/runner-config', () => ({
  getAgentConfig: vi.fn(() => ({
    type: 'default',
    systemPrompt: 'System prompt',
    tools: [],
  })),
}));

vi.mock('@/services/agent/prompts', () => ({
  buildToolCatalogContent: vi.fn(() => 'tool catalog content'),
}));

vi.mock('@/services/agent/prompt-budget', () => ({
  buildBudgetedSystemPrompt: vi.fn((_lanes: unknown[]) => 'budgeted prompt'),
  LANE_PRIORITY: { BASE_PROMPT: 0, TOOL_CATALOG: 1, MEMORY_ACTIVATION: 2, SKILL_INSTRUCTIONS: 3, THREAD_CONTEXT: 4 },
  LANE_MAX_TOKENS: { BASE_PROMPT: 2000, TOOL_CATALOG: 2500, MEMORY_ACTIVATION: 800, SKILL_INSTRUCTIONS: 2000, THREAD_CONTEXT: 1500 },
}));

vi.mock('@/services/agent/session-closer', () => ({
  autoCloseSession: vi.fn(),
}));

vi.mock('@/services/agent/skills', () => ({
  emitSkillLoadOutcome: vi.fn(),
}));

vi.mock('@/services/agent/simple-loop', () => ({
  runWithSimpleLoop: vi.fn(),
  runWithoutLLM: vi.fn(),
}));

vi.mock('@/services/memory-graph/runtime', () => ({
  AgentMemoryRuntime: vi.fn(),
}));

vi.mock('@/services/agent/remote-tool-executor', () => ({
  RemoteToolExecutor: vi.fn(),
}));

vi.mock('@/services/agent/execute-run', () => ({
  executeRun: vi.fn(),
}));

import {
  isValidToolCallsArray,
  createEventEmitterState,
  updateRunStatusImpl,
  buildConversationHistory,
} from '@/services/agent/runner';

describe('isValidToolCallsArray', () => {
  it('returns true for valid tool calls', () => {
    expect(isValidToolCallsArray([
      { id: 'tc1', name: 'file_read', arguments: { path: '/test' } },
    ])).toBe(true);
  });

  it('returns true for empty array', () => {
    expect(isValidToolCallsArray([])).toBe(true);
  });

  it('returns false for non-array', () => {
    expect(isValidToolCallsArray('not-array')).toBe(false);
    expect(isValidToolCallsArray(null)).toBe(false);
    expect(isValidToolCallsArray(undefined)).toBe(false);
  });

  it('returns false when items lack required fields', () => {
    expect(isValidToolCallsArray([{ id: 'tc1' }])).toBe(false);
    expect(isValidToolCallsArray([{ id: 'tc1', name: 'tool' }])).toBe(false);
    expect(isValidToolCallsArray([{ id: 'tc1', name: 'tool', arguments: null }])).toBe(false);
  });

  it('returns false for non-object items', () => {
    expect(isValidToolCallsArray([null])).toBe(false);
    expect(isValidToolCallsArray(['string'])).toBe(false);
  });
});

describe('createEventEmitterState', () => {
  it('creates initial state with zero counters', () => {
    const state = createEventEmitterState();
    expect(state.eventSequence).toBe(0);
    expect(state.pendingEventEmissions).toBe(0);
    expect(state.eventEmissionErrors).toEqual([]);
  });
});

describe('updateRunStatusImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates run to running status with startedAt', async () => {
    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const mockDb = { update: vi.fn().mockReturnValue({ set: updateSet }) };
    mocks.getDb.mockReturnValue(mockDb);

    await updateRunStatusImpl(
      {} as any,
      'run-1',
      { inputTokens: 10, outputTokens: 5 },
      'running',
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        startedAt: expect.any(String),
        usage: JSON.stringify({ inputTokens: 10, outputTokens: 5 }),
      }),
    );
  });

  it('updates run to completed status with completedAt', async () => {
    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const mockDb = { update: vi.fn().mockReturnValue({ set: updateSet }) };
    mocks.getDb.mockReturnValue(mockDb);

    await updateRunStatusImpl(
      {} as any,
      'run-1',
      { inputTokens: 100, outputTokens: 50 },
      'completed',
      'output data',
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        completedAt: expect.any(String),
        output: 'output data',
      }),
    );
  });

  it('updates run to failed status with error', async () => {
    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const mockDb = { update: vi.fn().mockReturnValue({ set: updateSet }) };
    mocks.getDb.mockReturnValue(mockDb);

    await updateRunStatusImpl(
      {} as any,
      'run-1',
      { inputTokens: 0, outputTokens: 0 },
      'failed',
      undefined,
      'Error message',
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        completedAt: expect.any(String),
        error: 'Error message',
      }),
    );
  });

  it('uses simple id-only WHERE for cancelled status (no != cancelled guard)', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { update: vi.fn().mockReturnValue({ set: updateSet }) };
    mocks.getDb.mockReturnValue(mockDb);

    await updateRunStatusImpl(
      {} as any,
      'run-1',
      { inputTokens: 0, outputTokens: 0 },
      'cancelled',
    );

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cancelled',
        completedAt: expect.any(String),
      }),
    );

    // For cancelled: condition = eq(runs.id, runId) — flat queryChunks with just `= `
    // For non-cancelled: condition = and(eq(...), sql`... != 'cancelled'`) — nested with `( ... and ... )`
    const whereArg = mockWhere.mock.calls[0][0];
    expect(whereArg).toBeDefined();
    expect(whereArg.queryChunks).toBeDefined();

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
    expect(joined).not.toContain(' and ');
    expect(joined).not.toContain("!= 'cancelled'");
  });

  it('includes != cancelled guard in WHERE for non-cancelled statuses', async () => {
    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: mockWhere });
    const mockDb = { update: vi.fn().mockReturnValue({ set: updateSet }) };
    mocks.getDb.mockReturnValue(mockDb);

    await updateRunStatusImpl(
      {} as any,
      'run-1',
      { inputTokens: 0, outputTokens: 0 },
      'completed',
      'done',
    );

    const whereArg = mockWhere.mock.calls[0][0];
    expect(whereArg).toBeDefined();
    expect(whereArg.queryChunks).toBeDefined();

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
    expect(joined).toContain(' and ');
    expect(joined).toContain("!= 'cancelled'");
  });
});

describe('buildConversationHistory', () => {
  function makeDbMock(selectGetResults: unknown[], selectAllResults: unknown[]) {
    let getIndex = 0;
    let allIndex = 0;
    const chain = () => {
      const c: Record<string, unknown> = {};
      c.from = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.orderBy = vi.fn().mockReturnValue(c);
      c.limit = vi.fn().mockReturnValue(c);
      c.all = vi.fn(async () => selectAllResults[allIndex++] ?? []);
      c.get = vi.fn(async () => selectGetResults[getIndex++] ?? null);
      return c;
    };
    return {
      select: vi.fn().mockImplementation(() => chain()),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRelevantThreadMessages.mockResolvedValue([]);
    mocks.buildThreadContextSystemMessage.mockReturnValue(null);
    mocks.getDelegationPacketFromRunInput.mockReturnValue(null);
    mocks.safeJsonParseOrDefault.mockReturnValue({});
    mocks.getContextWindowForModel.mockReturnValue(50);
  });

  it('builds conversation from messages in the thread', async () => {
    mocks.getDb.mockReturnValue(makeDbMock(
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
    ));

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'thread-1',
      runId: 'run-1',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-mini',
    });

    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.find((m) => m.content === 'Hello')).toBeTruthy();
    expect(history.find((m) => m.content === 'Hi there!')).toBeTruthy();
  });

  it('builds delegated child context from delegation packet', async () => {
    mocks.getDb.mockReturnValue(makeDbMock(
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
    ));

    mocks.getDelegationPacketFromRunInput.mockReturnValue({
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
    });

    mocks.buildDelegationSystemMessage.mockReturnValue({
      role: 'system',
      content: 'Delegated execution context:\nGoal: Fix the bug',
    });

    mocks.buildDelegationUserMessage.mockReturnValue({
      role: 'user',
      content: '[Delegated sub-task from parent agent (run: parent-run)]\n\nImplement the fix',
    });

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'child-thread-1',
      runId: 'child-run',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-mini',
    });

    expect(history[0]?.content).toContain('Delegated execution context');
    expect(history.some((m) => m.content.includes('Implement the fix'))).toBe(true);
  });

  it('parses tool_calls from stored messages', async () => {
    const toolCallsJson = JSON.stringify([
      { id: 'tc1', name: 'file_read', arguments: { path: '/test' } },
    ]);

    mocks.getDb.mockReturnValue(makeDbMock(
      [
        { summary: null, keyPoints: '[]' },
        null,
      ],
      [
        [
          { id: 'msg1', role: 'assistant', content: 'calling tool', r2Key: null, toolCalls: toolCallsJson, toolCallId: null, metadata: '{}', sequence: 0 },
        ],
      ],
    ));

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'thread-1',
      runId: 'run-1',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-nano',
    });

    const assistantMsg = history.find((m) => m.role === 'assistant');
    expect(assistantMsg?.tool_calls).toBeDefined();
    expect(assistantMsg?.tool_calls?.[0].name).toBe('file_read');
  });

  it('handles malformed tool_calls JSON gracefully', async () => {
    mocks.getDb.mockReturnValue(makeDbMock(
      [
        { summary: null, keyPoints: '[]' },
        null,
      ],
      [
        [
          { id: 'msg1', role: 'assistant', content: 'msg', r2Key: null, toolCalls: 'not-json', toolCallId: null, metadata: '{}', sequence: 0 },
        ],
      ],
    ));

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'thread-1',
      runId: 'run-1',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-nano',
    });

    const msg = history.find((m) => m.role === 'assistant');
    expect(msg?.tool_calls).toBeUndefined();
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('prepends thread context when available', async () => {
    mocks.buildThreadContextSystemMessage.mockReturnValue({
      role: 'system',
      content: '[THREAD_CONTEXT] Test context [/THREAD_CONTEXT]',
    });

    mocks.getDb.mockReturnValue(makeDbMock(
      [
        { summary: 'Summary', keyPoints: '["point"]' },
        null,
      ],
      [
        [
          { id: 'msg1', role: 'user', content: 'Hello', r2Key: null, toolCalls: null, toolCallId: null, metadata: '{}', sequence: 0 },
        ],
      ],
    ));

    const history = await buildConversationHistory({
      db: {} as D1Database,
      env: { TAKOS_OFFLOAD: undefined } as Env,
      threadId: 'thread-1',
      runId: 'run-1',
      spaceId: 'ws-1',
      aiModel: 'gpt-5.4-nano',
    });

    expect(history[0]?.role).toBe('system');
    expect(history[0]?.content).toContain('THREAD_CONTEXT');
  });
});
