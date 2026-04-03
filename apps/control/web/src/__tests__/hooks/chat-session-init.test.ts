import { assertEquals, assertStrictEquals } from "jsr:@std/assert";
import {
  type ChatSessionInitState,
  nextChatSessionInitState,
} from "../../hooks/chat-session-init.ts";

Deno.test("nextChatSessionInitState - initializes on first load", () => {
  assertEquals(
    nextChatSessionInitState(undefined, "thread-1", null),
    {
      threadId: "thread-1",
      focusSequence: null,
    },
  );
});

Deno.test("nextChatSessionInitState - keeps previous state when focus clears on same thread", () => {
  const previous: ChatSessionInitState = {
    threadId: "thread-1",
    focusSequence: 42,
  };

  assertStrictEquals(
    nextChatSessionInitState(previous, "thread-1", null),
    previous,
  );
});

Deno.test("nextChatSessionInitState - advances when focus changes on same thread", () => {
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

Deno.test("nextChatSessionInitState - advances when thread changes", () => {
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
