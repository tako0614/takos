import { assert, assertEquals } from "jsr:@std/assert";
import type { ChatStreamingState } from "../../views/chat/chat-types.ts";

const {
  EVENT_DISPATCH,
  resolveThinkingText,
} = await import("../../hooks/wsEventHandlers.ts");

Deno.test("resolveThinkingText - uses translated fallback instead of English", () => {
  const text = resolveThinkingText(
    {},
    (key: string) => (key === "timelineThinking" ? "考え中..." : key),
  );

  assertEquals(text, "考え中...");
});

Deno.test("message event - clears live tool calls when final content arrives", () => {
  let streaming: ChatStreamingState = {
    thinking: "Working...",
    toolCalls: [
      {
        id: "tc-1",
        name: "tool",
        arguments: {},
        status: "running",
      },
    ],
    currentMessage: null,
  };

  EVENT_DISPATCH.message({
    payload: { content: "done" },
    runId: "run-1",
    eventId: 3,
    eventType: "message",
    isPrimaryRun: true,
    verifyRunStatus: async () => true,
    isMountedRef: { current: true },
    currentRunIdRef: { current: "run-1" },
    lastEventIdRef: { current: 0 },
    handleWebSocketEventRef: { current: () => {} },
    handleRunCompletedRef: { current: async () => {} },
    setCurrentRun: () => {},
    setStreaming: (
      value:
        | ChatStreamingState
        | ((prev: ChatStreamingState) => ChatStreamingState),
    ) => {
      streaming = typeof value === "function" ? value(streaming) : value;
    },
    setIsLoading: () => {},
    setError: (_value: string | null) => {},
    closeWebSocket: () => {},
    resetStreamingState: () => {},
    appendTimelineEntry: () => {},
    t: (key: string) => key,
  });

  assertEquals(streaming.currentMessage, "done");
  assertEquals(streaming.thinking, null);
  assertEquals(streaming.toolCalls, []);
});

Deno.test("error event - surfaces a visible error and still completes the run", () => {
  let errorMessage: string | null = null;
  let completed = false;
  const appends: Array<{ type: string; message?: string }> = [];

  EVENT_DISPATCH.error({
    payload: { error: "boom" },
    runId: "run-2",
    eventId: 8,
    eventType: "error",
    isPrimaryRun: true,
    verifyRunStatus: async () => true,
    isMountedRef: { current: true },
    currentRunIdRef: { current: "run-2" },
    lastEventIdRef: { current: 0 },
    handleWebSocketEventRef: { current: () => {} },
    handleRunCompletedRef: {
      current: async () => {
        completed = true;
      },
    },
    setCurrentRun: () => {},
    setStreaming: () => {},
    setIsLoading: () => {},
    setError: (value: string | null) => {
      errorMessage = value;
    },
    closeWebSocket: () => {},
    resetStreamingState: () => {},
    appendTimelineEntry: (
      _runId: string,
      type: string,
      payload: { message?: string },
    ) => {
      appends.push({ type, message: payload.message });
    },
    t: (key: string) => key,
  });

  assertEquals(errorMessage, "boom");
  assert(completed);
  assertEquals(appends, [{ type: "error", message: undefined }]);
});
