// deno-lint-ignore-file no-import-prefix no-unversioned-import no-explicit-any require-await
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/skills'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/runner-config'
// [Deno] vi.mock removed - manually stub imports from '@/utils/with-timeout'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/runner-utils'
import {
  type NoLLMDeps,
  runWithoutLLM,
  runWithSimpleLoop,
  type SimpleLoopDeps,
} from "../../../../../../packages/control/src/application/services/agent/simple-loop.ts";

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";

function createSimpleLoopDeps(
  overrides?: Partial<SimpleLoopDeps>,
): SimpleLoopDeps {
  return {
    env: {} as any,
    config: {
      type: "default",
      systemPrompt: "System prompt",
      tools: [],
      maxIterations: 10,
      temperature: 0.5,
    },
    llmClient: {
      chat: async () => ({
        content: "Final response",
        toolCalls: undefined,
        stopReason: "stop" as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    } as any,
    toolExecutor: {
      execute: async () => ({ output: "tool output", error: undefined }),
    } as any,
    skillLocale: "en",
    availableSkills: [],
    selectedSkills: [],
    activatedSkills: [],
    spaceId: "ws-1",
    toolExecutions: [],
    totalUsage: { inputTokens: 0, outputTokens: 0 },
    toolCallCount: 0,
    totalToolCalls: 0,
    throwIfCancelled: async () => {},
    emitEvent: async () => {},
    addMessage: async () => {},
    updateRunStatus: async () => {},
    buildTerminalEventPayload: (
      status: "completed" | "failed" | "cancelled",
      details: Record<string, unknown> = {},
    ) =>
      ({
        run: { id: "run-1", status, ...details },
      }) as any,
    getConversationHistory:
      async () => [{ role: "user" as const, content: "Hello" }],
    ...overrides,
  };
}

function createNoLLMDeps(overrides?: Partial<NoLLMDeps>): NoLLMDeps {
  return {
    toolExecutor: {
      execute: async (call: { name: string }) => {
        if (call.name === "file_list") {
          return { output: "file1.ts\nfile2.ts", error: undefined };
        }
        return { output: "result", error: undefined };
      },
    } as any,
    emitEvent: async () => {},
    addMessage: async () => {},
    updateRunStatus: async () => {},
    buildTerminalEventPayload: (
      status: "completed" | "failed" | "cancelled",
      details: Record<string, unknown> = {},
    ) =>
      ({
        run: { id: "run-1", status, ...details },
      }) as any,
    ...overrides,
  };
}

function createSimpleLoopHarness(overrides?: Partial<SimpleLoopDeps>) {
  const deps = createSimpleLoopDeps(overrides);
  const emitEventSpy = stub(deps, "emitEvent", async () => {});
  const addMessageSpy = stub(deps, "addMessage", async () => {});
  const updateRunStatusSpy = stub(deps, "updateRunStatus", async () => {});
  const throwIfCancelledSpy = stub(deps, "throwIfCancelled", async () => {});
  return {
    deps,
    emitEventSpy,
    addMessageSpy,
    updateRunStatusSpy,
    throwIfCancelledSpy,
  };
}

function createNoLLMHarness(overrides?: Partial<NoLLMDeps>) {
  const deps = createNoLLMDeps(overrides);
  const emitEventSpy = stub(deps, "emitEvent", async () => {});
  const addMessageSpy = stub(deps, "addMessage", async () => {});
  const updateRunStatusSpy = stub(deps, "updateRunStatus", async () => {});
  return { deps, emitEventSpy, addMessageSpy, updateRunStatusSpy };
}

Deno.test("runWithSimpleLoop - completes when LLM returns a final response without tool calls", async () => {
  const {
    deps,
    emitEventSpy,
    addMessageSpy,
    updateRunStatusSpy,
    throwIfCancelledSpy,
  } = createSimpleLoopHarness({
    llmClient: {
      chat: async () => ({
        content: "Final response",
        toolCalls: undefined,
        stopReason: "stop" as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    } as any,
  });

  await runWithSimpleLoop(deps);

  assertSpyCalls(throwIfCancelledSpy, 2);
  assertEquals(emitEventSpy.calls[0].args[0], "thinking");
  assertEquals(emitEventSpy.calls[1].args[0], "message");
  assertEquals(emitEventSpy.calls[2].args[0], "completed");

  const assistantMessage = addMessageSpy.calls[0].args[0] as {
    role: string;
    content: string;
  };
  assertEquals(assistantMessage.role, "assistant");
  assertEquals(assistantMessage.content, "Final response");
  assertEquals(addMessageSpy.calls[0].args[1], {});

  assertEquals(updateRunStatusSpy.calls[0].args[0], "completed");
  assertStringIncludes(
    String(updateRunStatusSpy.calls[0].args[1]),
    "Final response",
  );
});

Deno.test("runWithSimpleLoop - accumulates token usage across iterations", async () => {
  const { deps } = createSimpleLoopHarness({
    llmClient: {
      chat: async () => ({
        content: "Final response",
        toolCalls: undefined,
        stopReason: "stop" as const,
        usage: { inputTokens: 100, outputTokens: 50 },
      }),
    } as any,
  });

  await runWithSimpleLoop(deps);

  assertEquals(deps.totalUsage.inputTokens, 100);
  assertEquals(deps.totalUsage.outputTokens, 50);
});

Deno.test("runWithSimpleLoop - executes tool calls when LLM requests them", async () => {
  let callCount = 0;
  const chatCalls: any[][] = [];
  const llmClient = {
    chat: async (...args: any[]) => {
      chatCalls.push(args);
      callCount++;
      if (callCount === 1) {
        return {
          content: "Let me check...",
          toolCalls: [{
            id: "tc1",
            name: "file_read",
            arguments: { path: "/test" },
          }],
          stopReason: "tool_calls" as const,
          usage: { inputTokens: 50, outputTokens: 20 },
        };
      }
      return {
        content: "Here is the result.",
        toolCalls: undefined,
        stopReason: "stop" as const,
        usage: { inputTokens: 80, outputTokens: 30 },
      };
    },
  };
  const { deps, emitEventSpy, addMessageSpy } = createSimpleLoopHarness({
    llmClient: llmClient as any,
  });
  const executeSpy = stub(deps.toolExecutor!, "execute", async () => ({
    output: "file content",
    error: undefined,
    tool_call_id: "tc1",
  }));

  await runWithSimpleLoop(deps);

  assertSpyCalls(executeSpy, 1);
  assertEquals(executeSpy.calls[0].args[0], {
    id: "tc1",
    name: "file_read",
    arguments: { path: "/test" },
  });
  assertEquals(emitEventSpy.calls[1].args[0], "tool_call");
  assertEquals(emitEventSpy.calls[2].args[0], "tool_result");
  assertEquals(addMessageSpy.calls[0].args[0], {
    role: "assistant",
    content: "Let me check...",
    tool_calls: [{
      id: "tc1",
      name: "file_read",
      arguments: { path: "/test" },
    }],
  });
  assertEquals(chatCalls.length, 2);
});

Deno.test("runWithSimpleLoop - checks cancellation before each iteration", async () => {
  const { deps, throwIfCancelledSpy } = createSimpleLoopHarness();

  await runWithSimpleLoop(deps);

  assertSpyCalls(throwIfCancelledSpy, 2);
  assertEquals(throwIfCancelledSpy.calls[0].args[0], "iteration");
});

Deno.test("runWithSimpleLoop - throws on rate limit exceeded", async () => {
  const { deps } = createSimpleLoopHarness({
    config: {
      type: "default",
      systemPrompt: "prompt",
      tools: [],
      maxIterations: 100,
      rateLimit: 1,
    } as any,
    toolCallCount: 1,
    llmClient: {
      chat: async () => ({
        content: "",
        toolCalls: [{ id: "tc1", name: "tool", arguments: {} }],
        stopReason: "tool_calls" as const,
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    } as any,
  });

  await assertRejects(
    () => runWithSimpleLoop(deps),
    Error,
    "Rate limit exceeded",
  );
});

Deno.test("runWithSimpleLoop - throws when tool executor is not initialized", async () => {
  const { deps } = createSimpleLoopHarness({
    toolExecutor: undefined,
    llmClient: {
      chat: async () => ({
        content: "",
        toolCalls: [{ id: "tc1", name: "tool", arguments: {} }],
        stopReason: "tool_calls" as const,
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    } as any,
  });

  await assertRejects(
    () => runWithSimpleLoop(deps),
    Error,
    "Tool executor not initialized",
  );
});

Deno.test("runWithSimpleLoop - completes with max iterations message when limit reached", async () => {
  const { deps, updateRunStatusSpy } = createSimpleLoopHarness({
    config: {
      type: "default",
      systemPrompt: "prompt",
      tools: [],
      maxIterations: 1,
    } as any,
    llmClient: {
      chat: async () => ({
        content: "",
        toolCalls: [{ id: "tc1", name: "tool", arguments: {} }],
        stopReason: "tool_calls" as const,
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    } as any,
  });

  await runWithSimpleLoop(deps);

  assertEquals(updateRunStatusSpy.calls[0].args[0], "completed");
  assertStringIncludes(
    String(updateRunStatusSpy.calls[0].args[1]),
    "Max iterations reached",
  );
});

Deno.test("runWithSimpleLoop - refreshes memory before LLM call when memoryRuntime is available", async () => {
  const mockMemoryRuntime = {
    beforeModel: () => ({
      hasContent: true,
      segment: "Memory segment content",
    }),
  };
  const beforeModelSpy = stub(mockMemoryRuntime, "beforeModel", () => ({
    hasContent: true,
    segment: "Memory segment content",
  }));

  const { deps } = createSimpleLoopHarness({
    memoryRuntime: mockMemoryRuntime as any,
  });

  await runWithSimpleLoop(deps);

  assertSpyCalls(beforeModelSpy, 1);
});

Deno.test("runWithSimpleLoop - throws when total run timeout is exceeded", async () => {
  let callCount = 0;
  const nowStub = stub(Date, "now", () => {
    callCount++;
    if (callCount <= 1) return 1_000_000;
    return 2_000_000;
  });

  try {
    const { deps } = createSimpleLoopHarness({
      config: {
        type: "default",
        systemPrompt: "prompt",
        tools: [],
        maxIterations: 100,
      } as any,
      llmClient: {
        chat: async () => ({
          content: "",
          toolCalls: [{ id: "tc1", name: "tool", arguments: {} }],
          stopReason: "tool_calls" as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      } as any,
    });

    await assertRejects(
      () => runWithSimpleLoop(deps),
      Error,
      "Run timed out after",
    );
  } finally {
    nowStub.restore();
  }
});

Deno.test("runWithSimpleLoop - throws when MAX_TOTAL_TOOL_CALLS limit is exceeded", async () => {
  const { deps } = createSimpleLoopHarness({
    config: {
      type: "default",
      systemPrompt: "prompt",
      tools: [],
      maxIterations: 100,
    } as any,
    totalToolCalls: 1000,
    llmClient: {
      chat: async () => ({
        content: "",
        toolCalls: [{ id: "tc1", name: "tool", arguments: {} }],
        stopReason: "tool_calls" as const,
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    } as any,
  });

  await assertRejects(
    () => runWithSimpleLoop(deps),
    Error,
    "Total tool call limit exceeded",
  );
});

Deno.test("runWithSimpleLoop - inserts [ACTIVE_MEMORY] message after the system prompt when memoryRuntime has content", async () => {
  const capturedMessages: any[][] = [];
  const llmClient = {
    chat: async (msgs: any[]) => {
      capturedMessages.push([...msgs]);
      return {
        content: "Done",
        toolCalls: undefined,
        stopReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
  const { deps } = createSimpleLoopHarness({
    llmClient: llmClient as any,
    memoryRuntime: {
      beforeModel: () => ({
        hasContent: true,
        segment: "Memory about the user preferences",
      }),
    } as any,
  });

  await runWithSimpleLoop(deps);

  assert(capturedMessages.length > 0);
  assertEquals(capturedMessages[0][1].role, "system");
  assertStringIncludes(capturedMessages[0][1].content, "[ACTIVE_MEMORY]");
  assertStringIncludes(
    capturedMessages[0][1].content,
    "Memory about the user preferences",
  );
});

Deno.test("runWithSimpleLoop - replaces existing [ACTIVE_MEMORY] message on subsequent iterations", async () => {
  let callCount = 0;
  const capturedMessages: any[][] = [];
  const memoryRuntime = {
    beforeModel: () => {
      callCount++;
      return {
        hasContent: true,
        segment: `Memory segment v${callCount}`,
      };
    },
  };
  const beforeModelSpy = stub(memoryRuntime, "beforeModel", () => {
    callCount++;
    return {
      hasContent: true,
      segment: `Memory segment v${callCount}`,
    };
  });

  const llmClient = {
    chat: async (msgs: any[]) => {
      capturedMessages.push([...msgs]);
      if (capturedMessages.length === 1) {
        return {
          content: "",
          toolCalls: [{ id: "tc1", name: "tool", arguments: {} }],
          stopReason: "tool_calls" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
      return {
        content: "Final",
        toolCalls: undefined,
        stopReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    },
  };
  const { deps } = createSimpleLoopHarness({
    llmClient: llmClient as any,
    memoryRuntime: memoryRuntime as any,
  });

  await runWithSimpleLoop(deps);

  assertSpyCalls(beforeModelSpy, 2);
  const secondCallMsgs = capturedMessages[1];
  const memoryMsgs = secondCallMsgs.filter((m: any) =>
    m.role === "system" && m.content.includes("[ACTIVE_MEMORY]")
  );
  assertEquals(memoryMsgs.length, 1);
  assertStringIncludes(memoryMsgs[0].content, "Memory segment v2");
});

Deno.test("runWithSimpleLoop - does not insert [ACTIVE_MEMORY] message when memoryRuntime has no content", async () => {
  const capturedMessages: any[][] = [];
  const { deps } = createSimpleLoopHarness({
    llmClient: {
      chat: async (msgs: any[]) => {
        capturedMessages.push([...msgs]);
        return {
          content: "Done",
          toolCalls: undefined,
          stopReason: "stop" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    } as any,
    memoryRuntime: {
      beforeModel: () => ({
        hasContent: false,
        segment: "",
      }),
    } as any,
  });

  await runWithSimpleLoop(deps);

  const memoryMsgs = capturedMessages[0].filter((m: any) =>
    m.role === "system" && m.content.includes("[ACTIVE_MEMORY]")
  );
  assertEquals(memoryMsgs.length, 0);
});

Deno.test('runWithoutLLM - responds with file listing for "list files" query', async () => {
  const { deps, emitEventSpy, addMessageSpy, updateRunStatusSpy } =
    createNoLLMHarness();

  await runWithoutLLM(deps, [{ role: "user", content: "list files" }]);

  assertEquals(emitEventSpy.calls[0].args[0], "thinking");
  const assistantMessage = addMessageSpy.calls[0].args[0] as {
    role: string;
    content: string;
  };
  assertEquals(assistantMessage.role, "assistant");
  assertStringIncludes(assistantMessage.content, "file1.ts");
  assertEquals(updateRunStatusSpy.calls[0].args[0], "completed");
  assertStringIncludes(String(updateRunStatusSpy.calls[0].args[1]), "no-llm");
});

Deno.test('runWithoutLLM - responds with file content for "read file" query with path', async () => {
  const toolExecutor = {
    execute: async () => ({ output: "file content here", error: undefined }),
  };
  const executeSpy = stub(toolExecutor, "execute", async () => ({
    output: "file content here",
    error: undefined,
    tool_call_id: "simple-file-read",
  }));
  const { deps } = createNoLLMHarness({ toolExecutor: toolExecutor as any });

  await runWithoutLLM(deps, [{
    role: "user",
    content: "read file 'src/index.ts'",
  }]);

  assertSpyCalls(executeSpy, 1);
  const firstCall = executeSpy.calls[0] as any;
  assertEquals(firstCall.args[0].name, "file_read");
});

Deno.test("runWithoutLLM - handles search queries", async () => {
  const toolExecutor = {
    execute: async () => ({ output: "found: result.ts", error: undefined }),
  };
  const executeSpy = stub(toolExecutor, "execute", async () => ({
    output: "found: result.ts",
    error: undefined,
    tool_call_id: "simple-search",
  }));
  const { deps } = createNoLLMHarness({ toolExecutor: toolExecutor as any });

  await runWithoutLLM(deps, [{ role: "user", content: 'search for "config"' }]);

  assertSpyCalls(executeSpy, 1);
  const firstCall = executeSpy.calls[0] as any;
  assertEquals(firstCall.args[0].name, "search");
});

Deno.test("runWithoutLLM - returns generic help when no pattern matches", async () => {
  const { deps, addMessageSpy, updateRunStatusSpy } = createNoLLMHarness();

  await runWithoutLLM(deps, [{
    role: "user",
    content: "What is the meaning of life?",
  }]);

  const assistantMessage = addMessageSpy.calls[0].args[0] as {
    content: string;
  };
  assertStringIncludes(assistantMessage.content, "LLM API key not configured");
  assertEquals(updateRunStatusSpy.calls[0].args[0], "completed");
});

Deno.test("runWithoutLLM - handles missing tool executor", async () => {
  const { deps, addMessageSpy } = createNoLLMHarness({
    toolExecutor: undefined,
  });

  await runWithoutLLM(deps, [{ role: "user", content: "list files" }]);

  const assistantMessage = addMessageSpy.calls[0].args[0] as {
    content: string;
  };
  assertStringIncludes(assistantMessage.content, "Tool executor not available");
});

Deno.test("runWithoutLLM - uses last user message as query", async () => {
  const toolExecutor = {
    execute: async () => ({ output: "file1.ts\nfile2.ts", error: undefined }),
  };
  const executeSpy = stub(toolExecutor, "execute", async () => ({
    output: "file1.ts\nfile2.ts",
    error: undefined,
    tool_call_id: "simple-file-list",
  }));
  const { deps } = createNoLLMHarness({ toolExecutor: toolExecutor as any });

  await runWithoutLLM(deps, [
    { role: "user", content: "first message" },
    { role: "assistant", content: "response" },
    { role: "user", content: "list files in workspace" },
  ]);

  assertSpyCalls(executeSpy, 1);
  const firstCall = executeSpy.calls[0] as any;
  assertEquals(firstCall.args[0].name, "file_list");
});

Deno.test("runWithoutLLM - handles empty history gracefully", async () => {
  const { deps, addMessageSpy } = createNoLLMHarness();

  await runWithoutLLM(deps, []);

  const assistantMessage = addMessageSpy.calls[0].args[0] as {
    content: string;
  };
  assertStringIncludes(assistantMessage.content, "LLM API key not configured");
});

Deno.test("runWithoutLLM - handles file read error", async () => {
  const toolExecutor = {
    execute: async () => ({ output: "", error: "File not found" }),
  };
  const executeSpy = stub(toolExecutor, "execute", async () => ({
    output: "",
    error: "File not found",
    tool_call_id: "simple-file-read",
  }));
  const { deps, addMessageSpy } = createNoLLMHarness({
    toolExecutor: toolExecutor as any,
  });

  await runWithoutLLM(deps, [{
    role: "user",
    content: "read file 'nonexistent.ts'",
  }]);

  assertSpyCalls(executeSpy, 1);
  const assistantMessage = addMessageSpy.calls[0].args[0] as {
    content: string;
  };
  assertStringIncludes(assistantMessage.content, "Error reading file");
});

Deno.test("runWithoutLLM - prompts for file path when read file has no path", async () => {
  const { deps, addMessageSpy } = createNoLLMHarness();

  await runWithoutLLM(deps, [{ role: "user", content: "read file" }]);

  const assistantMessage = addMessageSpy.calls[0].args[0] as {
    content: string;
  };
  assertStringIncludes(assistantMessage.content, "specify a file path");
});
