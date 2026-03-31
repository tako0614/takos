// [Deno] vi.mock removed - manually stub imports from '@/services/agent/skills'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/runner-config'
// [Deno] vi.mock removed - manually stub imports from '@/utils/with-timeout'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/runner-utils'
import { runWithSimpleLoop, runWithoutLLM, type SimpleLoopDeps, type NoLLMDeps } from '@/services/agent/simple-loop';

import { assertEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { stub, assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

function createSimpleLoopDeps(overrides?: Partial<SimpleLoopDeps>): SimpleLoopDeps {
  return {
    env: {} as any,
    config: {
      type: 'default',
      systemPrompt: 'System prompt',
      tools: [],
      maxIterations: 10,
      temperature: 0.5,
    },
    llmClient: {
      chat: async () => ({
        content: 'Final response',
        toolCalls: undefined,
        stopReason: 'stop' as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    } as any,
    toolExecutor: {
      execute: async () => ({ output: 'tool output', error: undefined }),
    } as any,
    skillLocale: 'en',
    availableSkills: [],
    selectedSkills: [],
    activatedSkills: [],
    spaceId: 'ws-1',
    toolExecutions: [],
    totalUsage: { inputTokens: 0, outputTokens: 0 },
    toolCallCount: 0,
    totalToolCalls: 0,
    throwIfCancelled: async () => {},
    emitEvent: async () => {},
    addMessage: async () => {},
    updateRunStatus: async () => {},
    buildTerminalEventPayload: (status, details) => ({
      run: { id: 'run-1', status, ...details },
    }) as any,
    getConversationHistory: async () => [
      { role: 'user' as const, content: 'Hello' },
    ],
    ...overrides,
  };
}

function createNoLLMDeps(overrides?: Partial<NoLLMDeps>): NoLLMDeps {
  return {
    toolExecutor: {
      execute: async (call: { name: string }) => {
        if (call.name === 'file_list') {
          return { output: 'file1.ts\nfile2.ts', error: undefined };
        }
        return { output: 'result', error: undefined };
      },
    } as any,
    emitEvent: async () => {},
    addMessage: async () => {},
    updateRunStatus: async () => {},
    buildTerminalEventPayload: (status, details) => ({
      run: { id: 'run-1', status, ...details },
    }) as any,
    ...overrides,
  };
}


  Deno.test('runWithSimpleLoop - completes when LLM returns a final response without tool calls', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deps = createSimpleLoopDeps();
    await runWithSimpleLoop(deps);

    assertSpyCallArgs(deps.emitEvent, 0, ['thinking', ({ iteration: 1 })]);
    assertSpyCallArgs(deps.addMessage, 0, [
      ({ role: 'assistant', content: 'Final response' }),
      /* expect.any(Object) */ {} as any,
    ]);
    assertSpyCallArgs(deps.updateRunStatus, 0, [
      'completed',
      expect.stringContaining('Final response'),
    ]);
    assertSpyCallArgs(deps.emitEvent, 0, ['completed', /* expect.any(Object) */ {} as any]);
})
  Deno.test('runWithSimpleLoop - accumulates token usage across iterations', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deps = createSimpleLoopDeps();
    await runWithSimpleLoop(deps);

    assertEquals(deps.totalUsage.inputTokens, 100);
    assertEquals(deps.totalUsage.outputTokens, 50);
})
  Deno.test('runWithSimpleLoop - executes tool calls when LLM requests them', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const llmChat = ((..._args: any[]) => undefined) as any
       = (async () => ({
        content: 'Let me check...',
        toolCalls: [{ id: 'tc1', name: 'file_read', arguments: { path: '/test' } }],
        stopReason: 'tool_calls',
        usage: { inputTokens: 50, outputTokens: 20 },
      })) as any
       = (async () => ({
        content: 'Here is the result.',
        toolCalls: undefined,
        stopReason: 'stop',
        usage: { inputTokens: 80, outputTokens: 30 },
      })) as any;

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
    });

    await runWithSimpleLoop(deps);

    assertSpyCallArgs(deps.toolExecutor!.execute, 0, [
      ({ name: 'file_read' }),
    ]);
    assertSpyCallArgs(deps.emitEvent, 0, ['tool_call', ({
      tool: 'file_read',
    })]);
    assertSpyCallArgs(deps.emitEvent, 0, ['tool_result', /* expect.any(Object) */ {} as any]);
})
  Deno.test('runWithSimpleLoop - checks cancellation before each iteration', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deps = createSimpleLoopDeps();
    await runWithSimpleLoop(deps);
    assertSpyCallArgs(deps.throwIfCancelled, 0, ['iteration']);
})
  Deno.test('runWithSimpleLoop - throws on rate limit exceeded', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const llmChat = (async () => ({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
      stopReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      config: {
        type: 'default',
        systemPrompt: 'prompt',
        tools: [],
        maxIterations: 100,
        rateLimit: 1,
      },
      toolCallCount: 1,
    });

    await await assertRejects(async () => { await runWithSimpleLoop(deps); }, 'Rate limit exceeded');
})
  Deno.test('runWithSimpleLoop - throws when tool executor is not initialized', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const llmChat = (async () => ({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
      stopReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      toolExecutor: undefined,
    });

    await await assertRejects(async () => { await runWithSimpleLoop(deps); }, 'Tool executor not initialized');
})
  Deno.test('runWithSimpleLoop - completes with max iterations message when limit reached', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const llmChat = (async () => ({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
      stopReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      config: {
        type: 'default',
        systemPrompt: 'prompt',
        tools: [],
        maxIterations: 1,
      },
    });

    await runWithSimpleLoop(deps);

    assertSpyCallArgs(deps.updateRunStatus, 0, [
      'completed',
      expect.stringContaining('Max iterations'),
    ]);
})
  Deno.test('runWithSimpleLoop - refreshes memory before LLM call when memoryRuntime is available', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockMemoryRuntime = {
      beforeModel: () => ({
        hasContent: true,
        segment: 'Memory segment content',
      }),
    };

    const deps = createSimpleLoopDeps({
      memoryRuntime: mockMemoryRuntime as any,
    });

    await runWithSimpleLoop(deps);
    assert(mockMemoryRuntime.beforeModel.calls.length > 0);
})
  Deno.test('runWithSimpleLoop - throws when total run timeout is exceeded', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Use fake timers to control Date.now() and simulate timeout
    let callCount = 0;
    // First call returns base time (runStartTime), second call returns time far in the future
    stub(Date, 'now') = () => {
      callCount++;
      // First call is for runStartTime; subsequent calls simulate time passed
      if (callCount <= 1) return 1000000;
      return 1000000 + 1000000; // 1000 seconds later — well past the 900s (15min) default timeout
    } as any;

    // LLM returns tool calls so the loop continues to a second iteration
    const llmChat = (async () => ({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
      stopReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      config: {
        type: 'default',
        systemPrompt: 'prompt',
        tools: [],
        maxIterations: 100,
      },
    });

    await await assertRejects(async () => { await runWithSimpleLoop(deps); }, /timed out/);
    stub(Date, 'now').restore();
})
  Deno.test('runWithSimpleLoop - throws when MAX_TOTAL_TOOL_CALLS limit is exceeded', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const llmChat = (async () => ({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
      stopReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      config: {
        type: 'default',
        systemPrompt: 'prompt',
        tools: [],
        maxIterations: 100,
      },
      totalToolCalls: 1000, // Already at the limit (MAX_TOTAL_TOOL_CALLS = 1000)
    });

    await await assertRejects(async () => { await runWithSimpleLoop(deps); }, /Total tool call limit exceeded/);
})
  Deno.test('runWithSimpleLoop - inserts [ACTIVE_MEMORY] message after the system prompt when memoryRuntime has content', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  let capturedMessages: any[] | undefined;
    const llmChat = async (msgs: any[]) => {
      capturedMessages = [...msgs];
      return {
        content: 'Done',
        toolCalls: undefined,
        stopReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    };

    const mockMemoryRuntime = {
      beforeModel: () => ({
        hasContent: true,
        segment: 'Memory about the user preferences',
      }),
    };

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      memoryRuntime: mockMemoryRuntime as any,
    });

    await runWithSimpleLoop(deps);

    assert(capturedMessages !== undefined);
    // The memory message should be at index 1 (right after the system prompt at index 0)
    assertEquals(capturedMessages![1].role, 'system');
    assertStringIncludes(capturedMessages![1].content, '[ACTIVE_MEMORY]');
    assertStringIncludes(capturedMessages![1].content, 'Memory about the user preferences');
})
  Deno.test('runWithSimpleLoop - replaces existing [ACTIVE_MEMORY] message on subsequent iterations', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  let callCount = 0;
    let capturedMessages: any[][] = [];

    const llmChat = async (msgs: any[]) => {
      capturedMessages.push([...msgs]);
      callCount++;
      if (callCount === 1) {
        return {
          content: '',
          toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
          stopReason: 'tool_calls',
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
      return {
        content: 'Final',
        toolCalls: undefined,
        stopReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    };

    let memoryCallCount = 0;
    const mockMemoryRuntime = {
      beforeModel: () => {
        memoryCallCount++;
        return {
          hasContent: true,
          segment: `Memory segment v${memoryCallCount}`,
        };
      },
    };

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      memoryRuntime: mockMemoryRuntime as any,
    });

    await runWithSimpleLoop(deps);

    assertSpyCalls(mockMemoryRuntime.beforeModel, 2);

    // In the second call, the [ACTIVE_MEMORY] message should have been replaced
    const secondCallMsgs = capturedMessages[1];
    const memoryMsgs = secondCallMsgs.filter(
      (m: any) => m.role === 'system' && m.content.includes('[ACTIVE_MEMORY]'),
    );
    // There should be exactly one [ACTIVE_MEMORY] message (replaced, not duplicated)
    assertEquals(memoryMsgs.length, 1);
    assertStringIncludes(memoryMsgs[0].content, 'Memory segment v2');
})
  Deno.test('runWithSimpleLoop - does not insert [ACTIVE_MEMORY] message when memoryRuntime has no content', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  let capturedMessages: any[] | undefined;
    const llmChat = async (msgs: any[]) => {
      capturedMessages = [...msgs];
      return {
        content: 'Done',
        toolCalls: undefined,
        stopReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    };

    const mockMemoryRuntime = {
      beforeModel: () => ({
        hasContent: false,
        segment: '',
      }),
    };

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      memoryRuntime: mockMemoryRuntime as any,
    });

    await runWithSimpleLoop(deps);

    assert(capturedMessages !== undefined);
    const memoryMsgs = capturedMessages!.filter(
      (m: any) => m.role === 'system' && m.content.includes('[ACTIVE_MEMORY]'),
    );
    assertEquals(memoryMsgs.length, 0);
})

  Deno.test('runWithoutLLM - responds with file listing for "list files" query', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deps = createNoLLMDeps();
    const history = [{ role: 'user' as const, content: 'list files' }];

    await runWithoutLLM(deps, history);

    assertSpyCallArgs(deps.toolExecutor!.execute, 0, [
      ({ name: 'file_list' }),
    ]);
    assertSpyCallArgs(deps.addMessage, 0, [
      ({
        role: 'assistant',
        content: expect.stringContaining('file1.ts'),
      }),
    ]);
    assertSpyCallArgs(deps.updateRunStatus, 0, [
      'completed',
      expect.stringContaining('no-llm'),
    ]);
})
  Deno.test('runWithoutLLM - responds with file content for "read file" query with path', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const toolExecutor = {
      execute: async () => ({ output: 'file content here', error: undefined }),
    };
    const deps = createNoLLMDeps({ toolExecutor: toolExecutor as any });
    const history = [{ role: 'user' as const, content: "read file 'src/index.ts'" }];

    await runWithoutLLM(deps, history);

    assertSpyCallArgs(toolExecutor.execute, 0, [
      ({ name: 'file_read' }),
    ]);
})
  Deno.test('runWithoutLLM - handles search queries', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const toolExecutor = {
      execute: async () => ({ output: 'found: result.ts', error: undefined }),
    };
    const deps = createNoLLMDeps({ toolExecutor: toolExecutor as any });
    const history = [{ role: 'user' as const, content: 'search for "config"' }];

    await runWithoutLLM(deps, history);

    assertSpyCallArgs(toolExecutor.execute, 0, [
      ({ name: 'search' }),
    ]);
})
  Deno.test('runWithoutLLM - returns generic help when no pattern matches', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deps = createNoLLMDeps();
    const history = [{ role: 'user' as const, content: 'What is the meaning of life?' }];

    await runWithoutLLM(deps, history);

    assertSpyCallArgs(deps.addMessage, 0, [
      ({
        content: expect.stringContaining('LLM API key not configured'),
      }),
    ]);
})
  Deno.test('runWithoutLLM - handles missing tool executor', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deps = createNoLLMDeps({ toolExecutor: undefined });
    const history = [{ role: 'user' as const, content: 'list files' }];

    await runWithoutLLM(deps, history);

    assertSpyCallArgs(deps.addMessage, 0, [
      ({
        content: expect.stringContaining('Tool executor not available'),
      }),
    ]);
})
  Deno.test('runWithoutLLM - uses last user message as query', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deps = createNoLLMDeps();
    const history = [
      { role: 'user' as const, content: 'first message' },
      { role: 'assistant' as const, content: 'response' },
      { role: 'user' as const, content: 'list files in workspace' },
    ];

    await runWithoutLLM(deps, history);

    assert(deps.toolExecutor!.execute.calls.length > 0);
})
  Deno.test('runWithoutLLM - handles empty history gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deps = createNoLLMDeps();
    await runWithoutLLM(deps, []);

    assertSpyCallArgs(deps.addMessage, 0, [
      ({ role: 'assistant' }),
    ]);
})
  Deno.test('runWithoutLLM - handles file read error', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const toolExecutor = {
      execute: async () => ({ output: '', error: 'File not found' }),
    };
    const deps = createNoLLMDeps({ toolExecutor: toolExecutor as any });
    const history = [{ role: 'user' as const, content: "read file 'nonexistent.ts'" }];

    await runWithoutLLM(deps, history);

    assertSpyCallArgs(deps.addMessage, 0, [
      ({
        content: expect.stringContaining('Error reading file'),
      }),
    ]);
})
  Deno.test('runWithoutLLM - prompts for file path when read file has no path', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const deps = createNoLLMDeps();
    const history = [{ role: 'user' as const, content: 'read file' }];

    await runWithoutLLM(deps, history);

    assertSpyCallArgs(deps.addMessage, 0, [
      ({
        content: expect.stringContaining('specify a file path'),
      }),
    ]);
})