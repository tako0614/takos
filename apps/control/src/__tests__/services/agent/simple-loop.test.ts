import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/agent/skills', () => ({
  buildSkillEnhancedPrompt: vi.fn((_prompt: string) => 'enhanced-prompt'),
}));

vi.mock('@/services/agent/runner-config', () => ({
  getTimeoutConfig: vi.fn(() => ({
    iterationTimeout: 120000,
    totalTimeout: 900000,
    toolExecutionTimeout: 300000,
    langGraphTimeout: 900000,
  })),
}));

vi.mock('@/utils/with-timeout', () => ({
  withTimeout: vi.fn(async (fn: (signal: AbortSignal) => Promise<unknown>) => {
    const controller = new AbortController();
    return fn(controller.signal);
  }),
}));

vi.mock('@/services/agent/runner-types', () => ({
  anySignal: vi.fn((signals: AbortSignal[]) => signals[0] || new AbortController().signal),
  addToolExecution: vi.fn(),
  redactSensitiveArgs: vi.fn((args: Record<string, unknown>) => args),
  MAX_TOTAL_TOOL_CALLS: 1000,
}));

import { runWithSimpleLoop, runWithoutLLM, type SimpleLoopDeps, type NoLLMDeps } from '@/services/agent/simple-loop';

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
      chat: vi.fn(async () => ({
        content: 'Final response',
        toolCalls: undefined,
        stopReason: 'stop' as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      })),
    } as any,
    toolExecutor: {
      execute: vi.fn(async () => ({ output: 'tool output', error: undefined })),
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
    throwIfCancelled: vi.fn(async () => {}),
    emitEvent: vi.fn(async () => {}),
    addMessage: vi.fn(async () => {}),
    updateRunStatus: vi.fn(async () => {}),
    buildTerminalEventPayload: vi.fn((status, details) => ({
      run: { id: 'run-1', status, ...details },
    })) as any,
    getConversationHistory: vi.fn(async () => [
      { role: 'user' as const, content: 'Hello' },
    ]),
    ...overrides,
  };
}

function createNoLLMDeps(overrides?: Partial<NoLLMDeps>): NoLLMDeps {
  return {
    toolExecutor: {
      execute: vi.fn(async (call: { name: string }) => {
        if (call.name === 'file_list') {
          return { output: 'file1.ts\nfile2.ts', error: undefined };
        }
        return { output: 'result', error: undefined };
      }),
    } as any,
    emitEvent: vi.fn(async () => {}),
    addMessage: vi.fn(async () => {}),
    updateRunStatus: vi.fn(async () => {}),
    buildTerminalEventPayload: vi.fn((status, details) => ({
      run: { id: 'run-1', status, ...details },
    })) as any,
    ...overrides,
  };
}

describe('runWithSimpleLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes when LLM returns a final response without tool calls', async () => {
    const deps = createSimpleLoopDeps();
    await runWithSimpleLoop(deps);

    expect(deps.emitEvent).toHaveBeenCalledWith('thinking', expect.objectContaining({ iteration: 1 }));
    expect(deps.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: 'Final response' }),
      expect.any(Object),
    );
    expect(deps.updateRunStatus).toHaveBeenCalledWith(
      'completed',
      expect.stringContaining('Final response'),
    );
    expect(deps.emitEvent).toHaveBeenCalledWith('completed', expect.any(Object));
  });

  it('accumulates token usage across iterations', async () => {
    const deps = createSimpleLoopDeps();
    await runWithSimpleLoop(deps);

    expect(deps.totalUsage.inputTokens).toBe(100);
    expect(deps.totalUsage.outputTokens).toBe(50);
  });

  it('executes tool calls when LLM requests them', async () => {
    const llmChat = vi.fn()
      .mockResolvedValueOnce({
        content: 'Let me check...',
        toolCalls: [{ id: 'tc1', name: 'file_read', arguments: { path: '/test' } }],
        stopReason: 'tool_calls',
        usage: { inputTokens: 50, outputTokens: 20 },
      })
      .mockResolvedValueOnce({
        content: 'Here is the result.',
        toolCalls: undefined,
        stopReason: 'stop',
        usage: { inputTokens: 80, outputTokens: 30 },
      });

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
    });

    await runWithSimpleLoop(deps);

    expect(deps.toolExecutor!.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'file_read' }),
    );
    expect(deps.emitEvent).toHaveBeenCalledWith('tool_call', expect.objectContaining({
      tool: 'file_read',
    }));
    expect(deps.emitEvent).toHaveBeenCalledWith('tool_result', expect.any(Object));
  });

  it('checks cancellation before each iteration', async () => {
    const deps = createSimpleLoopDeps();
    await runWithSimpleLoop(deps);
    expect(deps.throwIfCancelled).toHaveBeenCalledWith('iteration');
  });

  it('throws on rate limit exceeded', async () => {
    const llmChat = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
      stopReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

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

    await expect(runWithSimpleLoop(deps)).rejects.toThrow('Rate limit exceeded');
  });

  it('throws when tool executor is not initialized', async () => {
    const llmChat = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
      stopReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      toolExecutor: undefined,
    });

    await expect(runWithSimpleLoop(deps)).rejects.toThrow('Tool executor not initialized');
  });

  it('completes with max iterations message when limit reached', async () => {
    const llmChat = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
      stopReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

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

    expect(deps.updateRunStatus).toHaveBeenCalledWith(
      'completed',
      expect.stringContaining('Max iterations'),
    );
  });

  it('refreshes memory before LLM call when memoryRuntime is available', async () => {
    const mockMemoryRuntime = {
      beforeModel: vi.fn(() => ({
        hasContent: true,
        segment: 'Memory segment content',
      })),
    };

    const deps = createSimpleLoopDeps({
      memoryRuntime: mockMemoryRuntime as any,
    });

    await runWithSimpleLoop(deps);
    expect(mockMemoryRuntime.beforeModel).toHaveBeenCalled();
  });

  it('throws when total run timeout is exceeded', async () => {
    // Use fake timers to control Date.now() and simulate timeout
    let callCount = 0;
    // First call returns base time (runStartTime), second call returns time far in the future
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      // First call is for runStartTime; subsequent calls simulate time passed
      if (callCount <= 1) return 1000000;
      return 1000000 + 1000000; // 1000 seconds later — well past the 900s (15min) default timeout
    });

    // LLM returns tool calls so the loop continues to a second iteration
    const llmChat = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
      stopReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      config: {
        type: 'default',
        systemPrompt: 'prompt',
        tools: [],
        maxIterations: 100,
      },
    });

    await expect(runWithSimpleLoop(deps)).rejects.toThrow(/timed out/);
    vi.spyOn(Date, 'now').mockRestore();
  });

  it('throws when MAX_TOTAL_TOOL_CALLS limit is exceeded', async () => {
    const llmChat = vi.fn().mockResolvedValue({
      content: '',
      toolCalls: [{ id: 'tc1', name: 'tool', arguments: {} }],
      stopReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

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

    await expect(runWithSimpleLoop(deps)).rejects.toThrow(/Total tool call limit exceeded/);
  });

  it('inserts [ACTIVE_MEMORY] message after the system prompt when memoryRuntime has content', async () => {
    let capturedMessages: any[] | undefined;
    const llmChat = vi.fn().mockImplementation(async (msgs: any[]) => {
      capturedMessages = [...msgs];
      return {
        content: 'Done',
        toolCalls: undefined,
        stopReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    });

    const mockMemoryRuntime = {
      beforeModel: vi.fn(() => ({
        hasContent: true,
        segment: 'Memory about the user preferences',
      })),
    };

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      memoryRuntime: mockMemoryRuntime as any,
    });

    await runWithSimpleLoop(deps);

    expect(capturedMessages).toBeDefined();
    // The memory message should be at index 1 (right after the system prompt at index 0)
    expect(capturedMessages![1].role).toBe('system');
    expect(capturedMessages![1].content).toContain('[ACTIVE_MEMORY]');
    expect(capturedMessages![1].content).toContain('Memory about the user preferences');
  });

  it('replaces existing [ACTIVE_MEMORY] message on subsequent iterations', async () => {
    let callCount = 0;
    let capturedMessages: any[][] = [];

    const llmChat = vi.fn().mockImplementation(async (msgs: any[]) => {
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
    });

    let memoryCallCount = 0;
    const mockMemoryRuntime = {
      beforeModel: vi.fn(() => {
        memoryCallCount++;
        return {
          hasContent: true,
          segment: `Memory segment v${memoryCallCount}`,
        };
      }),
    };

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      memoryRuntime: mockMemoryRuntime as any,
    });

    await runWithSimpleLoop(deps);

    expect(mockMemoryRuntime.beforeModel).toHaveBeenCalledTimes(2);

    // In the second call, the [ACTIVE_MEMORY] message should have been replaced
    const secondCallMsgs = capturedMessages[1];
    const memoryMsgs = secondCallMsgs.filter(
      (m: any) => m.role === 'system' && m.content.includes('[ACTIVE_MEMORY]'),
    );
    // There should be exactly one [ACTIVE_MEMORY] message (replaced, not duplicated)
    expect(memoryMsgs).toHaveLength(1);
    expect(memoryMsgs[0].content).toContain('Memory segment v2');
  });

  it('does not insert [ACTIVE_MEMORY] message when memoryRuntime has no content', async () => {
    let capturedMessages: any[] | undefined;
    const llmChat = vi.fn().mockImplementation(async (msgs: any[]) => {
      capturedMessages = [...msgs];
      return {
        content: 'Done',
        toolCalls: undefined,
        stopReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    });

    const mockMemoryRuntime = {
      beforeModel: vi.fn(() => ({
        hasContent: false,
        segment: '',
      })),
    };

    const deps = createSimpleLoopDeps({
      llmClient: { chat: llmChat } as any,
      memoryRuntime: mockMemoryRuntime as any,
    });

    await runWithSimpleLoop(deps);

    expect(capturedMessages).toBeDefined();
    const memoryMsgs = capturedMessages!.filter(
      (m: any) => m.role === 'system' && m.content.includes('[ACTIVE_MEMORY]'),
    );
    expect(memoryMsgs).toHaveLength(0);
  });
});

describe('runWithoutLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds with file listing for "list files" query', async () => {
    const deps = createNoLLMDeps();
    const history = [{ role: 'user' as const, content: 'list files' }];

    await runWithoutLLM(deps, history);

    expect(deps.toolExecutor!.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'file_list' }),
    );
    expect(deps.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('file1.ts'),
      }),
    );
    expect(deps.updateRunStatus).toHaveBeenCalledWith(
      'completed',
      expect.stringContaining('no-llm'),
    );
  });

  it('responds with file content for "read file" query with path', async () => {
    const toolExecutor = {
      execute: vi.fn(async () => ({ output: 'file content here', error: undefined })),
    };
    const deps = createNoLLMDeps({ toolExecutor: toolExecutor as any });
    const history = [{ role: 'user' as const, content: "read file 'src/index.ts'" }];

    await runWithoutLLM(deps, history);

    expect(toolExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'file_read' }),
    );
  });

  it('handles search queries', async () => {
    const toolExecutor = {
      execute: vi.fn(async () => ({ output: 'found: result.ts', error: undefined })),
    };
    const deps = createNoLLMDeps({ toolExecutor: toolExecutor as any });
    const history = [{ role: 'user' as const, content: 'search for "config"' }];

    await runWithoutLLM(deps, history);

    expect(toolExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'search' }),
    );
  });

  it('returns generic help when no pattern matches', async () => {
    const deps = createNoLLMDeps();
    const history = [{ role: 'user' as const, content: 'What is the meaning of life?' }];

    await runWithoutLLM(deps, history);

    expect(deps.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('LLM API key not configured'),
      }),
    );
  });

  it('handles missing tool executor', async () => {
    const deps = createNoLLMDeps({ toolExecutor: undefined });
    const history = [{ role: 'user' as const, content: 'list files' }];

    await runWithoutLLM(deps, history);

    expect(deps.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Tool executor not available'),
      }),
    );
  });

  it('uses last user message as query', async () => {
    const deps = createNoLLMDeps();
    const history = [
      { role: 'user' as const, content: 'first message' },
      { role: 'assistant' as const, content: 'response' },
      { role: 'user' as const, content: 'list files in workspace' },
    ];

    await runWithoutLLM(deps, history);

    expect(deps.toolExecutor!.execute).toHaveBeenCalled();
  });

  it('handles empty history gracefully', async () => {
    const deps = createNoLLMDeps();
    await runWithoutLLM(deps, []);

    expect(deps.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant' }),
    );
  });

  it('handles file read error', async () => {
    const toolExecutor = {
      execute: vi.fn(async () => ({ output: '', error: 'File not found' })),
    };
    const deps = createNoLLMDeps({ toolExecutor: toolExecutor as any });
    const history = [{ role: 'user' as const, content: "read file 'nonexistent.ts'" }];

    await runWithoutLLM(deps, history);

    expect(deps.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Error reading file'),
      }),
    );
  });

  it('prompts for file path when read file has no path', async () => {
    const deps = createNoLLMDeps();
    const history = [{ role: 'user' as const, content: 'read file' }];

    await runWithoutLLM(deps, history);

    expect(deps.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('specify a file path'),
      }),
    );
  });
});
