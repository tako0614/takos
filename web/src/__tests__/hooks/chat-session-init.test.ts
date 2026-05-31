import { deepStrictEqual as assertEquals, strictEqual as assertStrictEquals } from "node:assert/strict";
import type {
  ChatSessionInitState,
} from "../../hooks/chat-session-init.ts";
import { test } from "bun:test";

import { nextChatSessionInitState } from "../../hooks/chat-session-init.ts";

test("nextChatSessionInitState - initializes on first load", () => {
  assertEquals(
    nextChatSessionInitState(undefined, "thread-1", null),
    {
      threadId: "thread-1",
      focusSequence: null,
    },
  );
});

test("nextChatSessionInitState - keeps previous state when focus clears on same thread", () => {
  const previous: ChatSessionInitState = {
    threadId: "thread-1",
    focusSequence: 42,
  };

  assertStrictEquals(
    nextChatSessionInitState(previous, "thread-1", null),
    previous,
  );
});

test("nextChatSessionInitState - advances when focus changes on same thread", () => {
  const previous: ChatSessionInitState = {
    threadId: "thread-1",
    focusSequence: 42,
  };

  assertEquals(
    nextChatSessionInitState(previous, "thread-1", 84),
    {
      threadId: "thread-1",
      focusSequence: 84,
    },
  );
});

test("nextChatSessionInitState - advances when thread changes", () => {
  const previous: ChatSessionInitState = {
    threadId: "thread-1",
    focusSequence: 42,
  };

  assertEquals(
    nextChatSessionInitState(previous, "thread-2", null),
    {
      threadId: "thread-2",
      focusSequence: null,
    },
  );
});
