import { describe, expect, test } from "bun:test";
import type { Message } from "../../types/index.ts";
import { mergeInitialHistoryMessages } from "../../hooks/chat-history-merge.ts";
import {
  EMPTY_HISTORY_TRUNCATION,
  mergeHistoryTruncation,
} from "../../hooks/useWsMessageProcessor.ts";

function message(id: string, content: string, sequence: number): Message {
  return {
    id,
    thread_id: "thread-1",
    role: "user",
    content,
    tool_calls: null,
    tool_call_id: null,
    metadata: "{}",
    sequence,
    created_at: "2026-08-09T00:00:00.000Z",
  };
}

describe("mergeInitialHistoryMessages", () => {
  test("preserves an optimistic message created while history was loading", () => {
    const optimistic = message("temp-1", "keep this draft", 0);

    expect(mergeInitialHistoryMessages([], [optimistic])).toEqual([
      optimistic,
    ]);
  });

  test("keeps history order and appends client-only messages", () => {
    const first = message("message-1", "first", 1);
    const second = message("message-2", "second", 2);
    const optimistic = message("temp-3", "third", 0);

    expect(
      mergeInitialHistoryMessages([first, second], [optimistic]),
    ).toEqual([first, second, optimistic]);
  });

  test("deduplicates persisted messages and keeps the newer client copy", () => {
    const stale = message("message-1", "stale", 1);
    const current = message("message-1", "current", 1);

    expect(mergeInitialHistoryMessages([stale], [current])).toEqual([
      current,
    ]);
  });
});

test("history truncation evidence merges without requiring Task context", () => {
  expect(mergeHistoryTruncation(EMPTY_HISTORY_TRUNCATION, {
    ...EMPTY_HISTORY_TRUNCATION,
    message_data: true,
  })).toEqual({
    ...EMPTY_HISTORY_TRUNCATION,
    message_data: true,
  });
  expect(mergeHistoryTruncation({
    ...EMPTY_HISTORY_TRUNCATION,
    runs: true,
  }, EMPTY_HISTORY_TRUNCATION).runs).toBe(true);
});
